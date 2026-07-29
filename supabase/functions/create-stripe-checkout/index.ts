// ─── Stripe Hosted Checkout Function ──────────────────────────────────────
// Optimized for Supabase Edge Functions (Deno)
//
// Creates the hosted Checkout session for both flows:
//   • paid sign-up — no account exists yet. The credentials ride along in the
//     subscription metadata so process-stripe-payment can provision the
//     account once Stripe confirms the payment.
//   • upgrade / renewal — the pilot is already signed in. `user_id` is passed
//     through as client_reference_id so the payment processor can resolve the
//     account exactly instead of scanning users by email.
//
// ── Why the metadata is built key by key ──────────────────────────────────
// On an upgrade the client sends neither `password` nor `name`, so the previous
// version put `temp_password: undefined` and `user_name: undefined` into the
// metadata object and left it to the Stripe SDK to drop them. Whether they are
// dropped or serialised as the *string* "undefined" decides how
// process-stripe-payment reads the checkout: a truthy `temp_password` looks
// exactly like a brand-new paid sign-up that needs an account provisioned,
// when what actually happened was an existing pilot upgrading. Building the
// object explicitly removes the ambiguity, and `flow` states the intent
// outright rather than leaving it to be inferred from which keys survived.
// ──────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Utility to return standardized JSON responses
 */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Stripe metadata values must be strings; anything absent is left out entirely. */
function putIfPresent(target: Record<string, string>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  const s = String(value).trim();
  if (!s || s === "undefined" || s === "null") return;
  target[key] = s.slice(0, 500); // Stripe caps metadata values at 500 chars
}

/**
 * Find the Stripe customer for this pilot.
 *
 * Prefers a customer already stamped with the Supabase user id, because email
 * is not a stable key: a pilot can change theirs, and two Stripe customers can
 * share one. Falls back to the email lookup for accounts created before the
 * id was recorded.
 */
async function findCustomer(email: string, userId?: string) {
  if (userId) {
    try {
      const found = await stripe.customers.search({
        query: `metadata['supabase_user_id']:'${userId}'`,
        limit: 1,
      });
      if (found.data[0]) return found.data[0];
    } catch (_) {
      // Search is eventually consistent and can be unavailable; the email
      // lookup below is the safety net.
    }
  }
  const byEmail = await stripe.customers.list({ email, limit: 1 });
  return byEmail.data[0] ?? null;
}

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      email, name, password, user_id, is_renew,
      success_url, cancel_url, trial_days, allow_promotion_codes,
    } = await req.json();

    if (!email) return jsonResponse({ error: "Email is required." }, 400);
    if (!PRICE_ID) return jsonResponse({ error: "Server configuration error: Missing PRICE_ID." }, 500);

    const isRenewal = is_renew === true || is_renew === "true";

    // An upgrade that arrives without the account id cannot be attributed once
    // the payment lands. Better to fail here, before any money moves, than to
    // take it and leave the pilot on the free tier.
    if (isRenewal && !user_id) {
      return jsonResponse({ error: "Upgrade is missing the account id. Please sign in again and retry." }, 400);
    }
    // Equally, a paid sign-up with no credentials cannot be provisioned.
    if (!isRenewal && !password) {
      return jsonResponse({ error: "Sign-up is missing the account credentials." }, 400);
    }

    // 1. Identify Customer and Check Trial Eligibility
    let customer = await findCustomer(email, user_id);
    let eligibleForTrial = false;

    if (!customer) {
      // Brand new customer -> definitely eligible for a trial
      const metadata: Record<string, string> = { source: "inflight_pro_signup" };
      putIfPresent(metadata, "supabase_user_id", user_id);
      customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata,
      });
      eligibleForTrial = true;
    } else {
      // Link an existing customer to the account if it was never stamped —
      // this is what lets restore-pro-access and any webhook resolve the
      // pilot without matching on an email that may have changed.
      if (user_id && customer.metadata?.supabase_user_id !== user_id) {
        try {
          await stripe.customers.update(customer.id, {
            metadata: { ...(customer.metadata ?? {}), supabase_user_id: String(user_id) },
          });
        } catch (_) { /* non-fatal: the session metadata still carries the id */ }
      }

      // Existing customer -> Check if they have ever had a subscription
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: "all", // Checks active, canceled, past_due, etc.
        limit: 1,
      });

      // If they have exactly 0 past or present subscriptions, they are eligible
      if (existingSubs.data.length === 0) {
        eligibleForTrial = true;
      }
    }
    const customerId = customer.id;

    // 2. Build URLs robustly. The client already appends the
    //    {CHECKOUT_SESSION_ID} placeholder — appending a second one produced
    //    `…&session_id=cs_x&session_id=cs_x` on every return trip.
    const origin = req.headers.get("origin") || "";
    const finalSuccessUrl = success_url || `${origin}/?payment=success`;
    let successWithSession = finalSuccessUrl;
    if (!finalSuccessUrl.includes("{CHECKOUT_SESSION_ID}")) {
      const separator = finalSuccessUrl.includes("?") ? "&" : "?";
      successWithSession = `${finalSuccessUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;
    }

    const finalCancelUrl = cancel_url || `${origin}/?payment=cancel`;

    // 3. Construct the metadata process-stripe-payment resolves the account
    //    from. Keys are only set when they carry a real value (see the note at
    //    the top of this file), and `flow` says which kind of checkout this is
    //    instead of leaving the processor to infer it from a missing password.
    const sharedMetadata: Record<string, string> = {};
    sharedMetadata.flow = isRenewal ? "upgrade" : "signup";
    putIfPresent(sharedMetadata, "user_email", email);
    putIfPresent(sharedMetadata, "user_id", user_id);
    putIfPresent(sharedMetadata, "user_name", name);
    // Credentials exist only for a brand-new paid sign-up; an upgrade must
    // never carry them, or the processor may try to create an account that is
    // already there instead of stamping the one that is.
    if (!isRenewal) putIfPresent(sharedMetadata, "temp_password", password);

    // The subscription carries everything, including the credentials.
    // process-stripe-payment blanks `temp_password` here once it has used it,
    // so the plaintext lives only for the few minutes between paying and
    // landing back on the site.
    const subscriptionData: Record<string, unknown> = { metadata: { ...sharedMetadata } };

    // The session carries everything EXCEPT the credentials. It exists so the
    // processor can resolve the account straight from the session it already
    // retrieved, without depending on the subscription expanding — resolving an
    // account needs `user_id`/`user_email`/`flow`, never a password. Copying
    // `temp_password` here as well would leave it in the Stripe dashboard
    // permanently: a completed Checkout Session cannot be edited, so there is
    // no scrub to match the one on the subscription.
    const sessionMetadata = { ...sharedMetadata };
    delete sessionMetadata.temp_password;

    // 4. Apply Trial ONLY if the user is verified as eligible. Never on an
    //    upgrade: a trialing subscription is `status: "trialing"`, not
    //    "active", so any grant that checks for an active subscription would
    //    refuse to unlock an account that had just paid.
    if (trial_days && eligibleForTrial && !isRenewal) {
      subscriptionData.trial_period_days = parseInt(trial_days, 10);
    }

    // 5. Create the Hosted Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      // Upgrades know exactly which account is paying. Sent through as the
      // session's own reference so the payment processor never has to guess
      // from an email.
      client_reference_id: user_id || undefined,
      // The account-resolution metadata on the session itself, so the processor
      // can resolve the account straight from the session it already retrieved
      // — without depending on the subscription expanding, which is the one
      // place this information used to live. Credentials are deliberately not
      // included; see where sessionMetadata is built.
      metadata: sessionMetadata,
      line_items: [
        {
          price: PRICE_ID,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: successWithSession,
      cancel_url: finalCancelUrl,
      subscription_data: subscriptionData,
      payment_method_collection: "always",
      // Let customers enter promo/discount codes on the hosted checkout page.
      // Defaults to true so codes are accepted unless the client explicitly opts out.
      allow_promotion_codes: allow_promotion_codes !== false,
    });

    return jsonResponse({ url: session.url });

  } catch (err) {
    console.error("Stripe Checkout Error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      500
    );
  }
});
