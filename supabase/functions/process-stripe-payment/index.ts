// process-stripe-payment — verify a completed Stripe Checkout session and
// grant the Pro entitlement.
//
// Called by AuthUI.checkPaymentStatus() (authUI.js) when Stripe redirects back
// to `?payment=success&session_id=…`, for BOTH kinds of checkout:
//
//   • paid sign-up — a brand-new account. The client still holds the password
//     and calls signInWithPassword() once we return success.
//   • upgrade / renewal — an existing signed-in account moving off the free
//     tier. There is no new user to create; the existing one must be updated.
//
// The contract the client depends on:
//   request   { sessionId: string }
//   success   200 { success: true, is_pro: true, … }
//   failure   non-2xx or { error: string }   (the client treats either as fatal)
//
// What "granting Pro" means here — the app reads the entitlement from
// `profiles.is_pro === true` in four places (authUI.js, profileUI.js,
// flight.js, MobileDashboardUI.js). Writing anything else (a `has_paid`
// metadata flag, a subscriptions row on its own) leaves the account locked.
// We therefore write, in order of importance:
//   1. profiles.is_pro = true          — the flag every gate actually reads
//   2. user_metadata.is_pro = true     — clears the free-tier stamp that
//                                        signup-free.js applies, so the
//                                        `metaFree` fallback also resolves Pro
//   3. subscriptions row               — powers the billing card only
//
// Environment (Supabase → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY          — live secret key, must match the live
//                                publishable key the frontend ships
//   SUPABASE_URL               — injected by the platform
//   SUPABASE_SERVICE_ROLE_KEY  — injected by the platform
//
// NOTE: this verifies on the redirect, which only runs if the pilot actually
// lands back on the site. A closed tab after paying means no grant. A
// `checkout.session.completed` webhook is the durable path and should be added
// alongside this — it can call the same grantPro() below.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Stripe's REST API, called directly so the function stays dependency-light. */
async function stripe(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `Stripe request failed (${res.status}).`);
  }
  return body;
}

/**
 * Find an existing auth user by email. Checkout sessions carry an email but
 * not a user id unless create-stripe-checkout forwarded one, so this is the
 * fallback path — and the one the upgrade flow relies on.
 */
async function findUserByEmail(admin: any, email: string) {
  const target = email.trim().toLowerCase();
  const perPage = 200;

  // Bounded scan: enough for the current user base, and it stops early on the
  // last page. If this ever gets slow, pass the user id through Checkout
  // metadata in create-stripe-checkout and use the fast path above instead.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Could not look up the account: ${error.message}`);

    const users = data?.users ?? [];
    const hit = users.find((u: any) => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < perPage) break; // last page
  }
  return null;
}

/**
 * Apply the entitlement. Safe to call more than once — a pilot who reloads the
 * success URL, or a webhook racing the redirect, must not produce a second
 * account or a duplicate subscriptions row.
 */
async function grantPro(admin: any, userId: string, subscription: any, amountTotal: number | null) {
  // 1. The flag every gate reads. Upsert rather than update: a profiles row
  //    created by trigger may not exist yet for a fresh sign-up.
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, is_pro: true }, { onConflict: 'id' });

  if (profileError) {
    // This is the one failure that must be fatal — without it the pilot is
    // charged and still locked out, which is the bug this function exists to
    // prevent. Surfacing it lets the client show "contact support" instead of
    // a false success.
    throw new Error(`Could not apply the Pro entitlement: ${profileError.message}`);
  }

  // 2. Clear the free-tier stamp (signup-free.js sets is_pro:false). The
  //    client's fallback rule treats that stamp as authoritative proof of a
  //    free account, so a stale `false` keeps surfaces locked whenever the
  //    profiles lookup hiccups.
  const { error: metaError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { is_pro: true },
  });
  if (metaError) console.warn('[process-stripe-payment] metadata stamp failed:', metaError.message);

  // 3. Billing card data. Cosmetic — never fail the grant over it.
  if (subscription?.id) {
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const amount = subscription.items?.data?.[0]?.price?.unit_amount ?? amountTotal ?? null;

    const { error: subError } = await admin
      .from('subscriptions')
      .upsert({
        user_id: userId,
        stripe_subscription_id: subscription.id,
        status: subscription.status || 'active',
        plan_name: subscription.items?.data?.[0]?.price?.nickname || 'Pro Access',
        current_period_end: periodEnd,
        amount,
      }, { onConflict: 'user_id' });

    if (subError) console.warn('[process-stripe-payment] subscription row failed:', subError.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!STRIPE_SECRET_KEY) throw new Error('Stripe is not configured on the server.');

    // The client sends `sessionId`. The other spellings are accepted so a
    // mismatched caller fails loudly on payment verification rather than
    // silently on a destructuring typo.
    const body = await req.json().catch(() => ({}));
    const sessionId = body.sessionId || body.session_id || body.checkout_session_id;
    if (!sessionId) throw new Error('Missing Stripe checkout session id.');

    // 1. Retrieve the session, with the subscription inlined.
    const session = await stripe(
      `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`
    );

    // 2. Verify it was actually paid. `no_payment_required` covers a 100%
    //    coupon; anything else (unpaid / open / expired) is not a purchase.
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (session.status !== 'complete' || !paid) {
      throw new Error(`Payment was not completed. Status: ${session.status}/${session.payment_status}`);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 3. Resolve which account this purchase belongs to.
    //
    //    create-stripe-checkout puts its payload on `subscription_data.metadata`,
    //    which Stripe copies onto the SUBSCRIPTION — not onto the session. So
    //    the sign-up credentials live at `subscription.metadata.temp_password`,
    //    and reading `session.metadata` finds nothing.
    const subscription = session.subscription;
    const subMeta = subscription?.metadata ?? {};

    const email = (
      session.customer_details?.email ||
      session.customer_email ||
      subMeta.user_email ||
      session.metadata?.email ||
      ''
    ).trim();

    let userId: string | null =
      session.client_reference_id || subMeta.user_id || session.metadata?.user_id || null;

    if (!userId) {
      if (!email) throw new Error('Checkout session has no email or user id to match an account.');
      const existing = await findUserByEmail(admin, email);

      if (existing) {
        // Upgrade / renewal — the common path, and the one the old PayPal
        // implementation could not handle at all (createUser on an existing
        // account fails with "already registered").
        userId = existing.id;
      } else {
        // Paid sign-up: no account exists yet, because create-stripe-checkout
        // only stashes the credentials. Provision it confirmed; the client logs
        // in with the password it still holds in localStorage.
        const password = subMeta.temp_password || session.metadata?.password;
        if (!password) {
          throw new Error('Paid, but no account exists for this email and no credentials were supplied. Please contact support.');
        }
        const displayName = subMeta.user_name || session.metadata?.name || '';
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: displayName, name: displayName, is_pro: true },
        });
        if (createError) throw new Error(`Could not create your account: ${createError.message}`);
        userId = created.user.id;
      }
    }

    if (!userId) throw new Error('Could not resolve the account for this payment.');

    // 4. Grant.
    await grantPro(admin, userId, subscription, session.amount_total ?? null);

    // 5. The sign-up password rode to Stripe in plaintext metadata and has now
    //    served its purpose. Drop it so it isn't sitting in the dashboard for
    //    the life of the subscription. Best-effort — the grant already landed.
    if (subMeta.temp_password && subscription?.id) {
      try {
        await fetch(`https://api.stripe.com/v1/subscriptions/${subscription.id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'metadata[temp_password]=',
        });
      } catch (err) {
        console.warn('[process-stripe-payment] could not scrub temp_password:', (err as Error).message);
      }
    }

    return json(200, {
      success: true,
      is_pro: true,
      user_id: userId,
      email,
    });

  } catch (error) {
    console.error('[process-stripe-payment]', error);
    return json(400, { error: (error as Error).message });
  }
});
