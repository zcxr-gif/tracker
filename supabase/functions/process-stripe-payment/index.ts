// process-stripe-payment — verify a completed Stripe Checkout session and
// grant the Pro entitlement.
//
// Replaces the PayPal implementation, which could not grant Pro to anyone:
// it read `subscriptionID` while the client sends `sessionId` (so it threw
// before any payment logic ran), verified against PayPal sandbox, wrote a
// `has_paid` metadata flag that nothing in the app reads, and only ever called
// createUser — so an existing account upgrading failed with "already
// registered".
//
// Called by AuthUI.checkPaymentStatus() (authUI.js) when Stripe redirects back
// to `?payment=success&session_id=…`, for BOTH kinds of checkout:
//
//   • paid sign-up — no account exists yet. create-stripe-checkout only stashes
//     the credentials in the subscription metadata; provisioning happens here.
//     The client still holds the password and calls signInWithPassword() once
//     we return success.
//   • upgrade / renewal — an existing free-tier account. Nothing to create; the
//     existing user must be updated in place.
//
// Contract the client depends on:
//   request   { sessionId: string }
//   success   200 { success: true, is_pro: true, … }
//   failure   non-2xx or { error: string }   (the client treats either as fatal)
//
// "Granting Pro" means, in order of importance:
//   1. profiles.is_pro = true       — the flag all four client gates read
//                                     (authUI.js:141, profileUI.js:1393,
//                                     flight.js:1772, MobileDashboardUI.js:459)
//   2. user_metadata.is_pro = true  — clears the free-tier stamp applied by
//                                     signup-free.js, so the client's fallback
//                                     rule also resolves Pro
//   3. subscriptions row            — powers the billing card only
//
// Both `profiles` and `subscriptions` must exist in the project. Neither is
// created by any code path here or in the app, so a project set up without them
// fails every upgrade with PostgREST's PGRST205 ("Could not find the table
// 'public.profiles' in the schema cache") — the payment succeeds and the pilot
// stays on the free tier. supabase/sql/fix-pro-entitlement.sql creates both.
//
// Environment (Supabase → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY          — live secret key, must pair with the pk_live_…
//                                the frontend ships in authUI.js
//   SUPABASE_URL               — injected by the platform
//   SUPABASE_SERVICE_ROLE_KEY  — injected by the platform
//
// NOTE: this verifies on the redirect, which only runs if the pilot actually
// lands back on the site. Pay and close the tab, and nothing grants Pro. A
// `checkout.session.completed` webhook is the durable path and should be added
// alongside this — it can call grantPro() below unchanged.

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
async function stripeGet(path: string): Promise<any> {
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
 * Does this error mean the table isn't in the database at all?
 *
 * PostgREST answers from a cached copy of the schema and reports a table it
 * cannot see as PGRST205; Postgres itself reports 42P01. Worth naming
 * explicitly, because "Could not find the table 'public.profiles' in the schema
 * cache" is otherwise a puzzling thing to read in a payment log — it is a
 * one-time setup fault, not a fault with the payment or the account.
 */
function isMissingTable(error: any): boolean {
  const code = String(error?.code ?? '');
  if (code === 'PGRST205' || code === '42P01') return true;
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('schema cache')
    || (message.includes('relation') && message.includes('does not exist'));
}

/**
 * Find an existing auth user by email — the fallback when the checkout carries
 * no user id (paid sign-up, or an upgrade started before the client began
 * sending one).
 */
async function findUserByEmail(admin: any, email: string) {
  const target = email.trim().toLowerCase();
  const perPage = 200;

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
 * success URL, or a webhook racing the redirect, must not double-provision.
 */
async function grantPro(admin: any, userId: string, subscription: any, amountTotal: number | null) {
  // 1. The flag every gate reads. Upsert, not update: for a fresh sign-up the
  //    profiles row may not have been created by trigger yet.
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, is_pro: true }, { onConflict: 'id' });

  if (profileError) {
    // The one failure that must be fatal — without this write the pilot is
    // charged and still locked out, which is the bug this function exists to
    // prevent. Surfacing it lets the client say "contact support" rather than
    // show a false success.
    //
    // A missing table is the same fatal outcome but a very different fix, and
    // nobody reading a payment log should have to work out that PGRST205 means
    // "run the setup SQL" — so say it here.
    if (isMissingTable(profileError)) {
      throw new Error(
        `Could not apply the Pro entitlement: the \`profiles\` table does not exist in this`
        + ` Supabase project, so there is nowhere to record it. Run`
        + ` supabase/sql/fix-pro-entitlement.sql, then re-run the pilot's claim.`
        + ` (${profileError.message})`
      );
    }
    throw new Error(`Could not apply the Pro entitlement: ${profileError.message}`);
  }

  // 2. Clear the free-tier stamp (signup-free.js writes is_pro:false). Read the
  //    existing metadata first and merge, so a display name set at sign-up
  //    survives the update.
  try {
    const { data: current } = await admin.auth.admin.getUserById(userId);
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...(current?.user?.user_metadata ?? {}), is_pro: true },
    });
  } catch (err) {
    console.warn('[process-stripe-payment] metadata stamp failed:', (err as Error).message);
  }

  // 3. Billing-card data. Cosmetic — never fail the grant over it.
  if (subscription?.id) {
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const price = subscription.items?.data?.[0]?.price;

    // The columns that have always existed — the fallback if the renewal
    // migration hasn't been run yet.
    const legacy: Record<string, unknown> = {
      user_id: userId,
      status: subscription.status || 'active',
      plan_name: price?.nickname || 'Pro Access',
      current_period_end: periodEnd,
      amount: price?.unit_amount ?? amountTotal ?? null,
    };

    // cancel_at_period_end decides whether the billing card reads
    // "Next payment" or "Access ends" against current_period_end.
    const full: Record<string, unknown> = {
      ...legacy,
      cancel_at_period_end: subscription.cancel_at_period_end === true,
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
      stripe_subscription_id: subscription.id,
    };

    let { error: subError } = await admin
      .from('subscriptions')
      .upsert(full, { onConflict: 'user_id' });

    // A missing column fails the whole statement, so fall back to the columns
    // we know are there rather than losing the billing card entirely. A missing
    // *table* is not worth a second attempt — it would fail identically.
    if (subError && !isMissingTable(subError)) {
      ({ error: subError } = await admin
        .from('subscriptions')
        .upsert(legacy, { onConflict: 'user_id' }));
    }
    if (subError) {
      console.warn('[process-stripe-payment] subscription row failed:', subError.message);
      if (isMissingTable(subError)) {
        console.warn('[process-stripe-payment] the `subscriptions` table does not exist —'
          + ' Pro is granted but the billing card will stay empty.'
          + ' supabase/sql/fix-pro-entitlement.sql creates it.');
      }
    }
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
    // silently on a destructuring typo — which is exactly how the PayPal
    // version failed.
    const body = await req.json().catch(() => ({}));
    const sessionId = body.sessionId || body.session_id || body.checkout_session_id;
    if (!sessionId) throw new Error('Missing Stripe checkout session id.');

    // 1. Retrieve the session with the subscription inlined.
    const session = await stripeGet(
      `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`
    );

    // 2. Verify it was actually paid. `no_payment_required` covers a full
    //    coupon and a subscription still inside its trial.
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (session.status !== 'complete' || !paid) {
      throw new Error(`Payment was not completed. Status: ${session.status}/${session.payment_status}`);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 3. Resolve which account this purchase belongs to.
    //
    //    create-stripe-checkout writes the same payload to two places: the
    //    SESSION's own metadata, and `subscription_data.metadata`, which Stripe
    //    copies onto the SUBSCRIPTION. Read both, because either can be the one
    //    that survives: the session is always here (we just retrieved it), while
    //    the subscription is only present if the expand resolved. The
    //    subscription wins where they overlap — it is where this data
    //    historically lived, and checkouts created before the session metadata
    //    was added still carry it only there.
    const subscription = session.subscription;
    const subMeta = { ...(session.metadata ?? {}), ...(subscription?.metadata ?? {}) };

    const email = (
      session.customer_details?.email ||
      session.customer_email ||
      subMeta.user_email ||
      ''
    ).trim();

    let userId: string | null = session.client_reference_id || subMeta.user_id || null;

    if (!userId) {
      if (!email) throw new Error('Checkout session has no email or user id to match an account.');
      const existing = await findUserByEmail(admin, email);

      if (existing) {
        // Upgrade / renewal — the path the PayPal version could not serve at
        // all, since createUser on an existing account fails outright.
        userId = existing.id;
      } else {
        // Paid sign-up: provision the account now, confirmed, so the client can
        // log in with the password it still holds in localStorage.
        //
        // `flow` says which kind of checkout this was outright. An upgrade that
        // reaches here has lost its account — creating a new one would strand
        // the pilot on a second, empty account while the one they paid from
        // stays free, so fail loudly instead.
        if (subMeta.flow === 'upgrade') {
          throw new Error('This was an upgrade, but the account it belongs to could not be found. Please contact support — your payment is safe.');
        }
        const password = subMeta.temp_password;
        if (!password) {
          throw new Error('Paid, but no account exists for this email and no credentials were supplied. Please contact support.');
        }
        const displayName = subMeta.user_name || '';
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
    //
    //    This is also why create-stripe-checkout keeps `temp_password` out of
    //    the session metadata: a completed Checkout Session cannot be edited,
    //    so a password copied there would be unscrubbable.
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

    return json(200, { success: true, is_pro: true, user_id: userId, email });

  } catch (error) {
    console.error('[process-stripe-payment]', error);
    return json(400, { error: (error as Error).message });
  }
});
