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

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, name, password, user_id, success_url, cancel_url, trial_days, allow_promotion_codes } = await req.json();

    if (!email) return jsonResponse({ error: "Email is required." }, 400);
    if (!PRICE_ID) return jsonResponse({ error: "Server configuration error: Missing PRICE_ID." }, 500);

    // 1. Identify Customer and Check Trial Eligibility
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data[0]?.id;
    let eligibleForTrial = false;

    if (!customerId) {
      // Brand new customer -> definitely eligible for a trial
      const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata: { source: "inflight_pro_signup" },
      });
      customerId = customer.id;
      eligibleForTrial = true;
    } else {
      // Existing customer -> Check if they have ever had a subscription
      const existingSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all", // Checks active, canceled, past_due, etc.
        limit: 1,
      });

      // If they have exactly 0 past or present subscriptions, they are eligible
      if (existingSubs.data.length === 0) {
        eligibleForTrial = true;
      }
    }

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

    // 3. Construct Subscription Data dynamically.
    //    process-stripe-payment reads this metadata off the expanded
    //    subscription to resolve (or provision) the account, so `user_email`
    //    must always be present — it is the fallback when Stripe's
    //    customer_details come back empty.
    const subscriptionData: any = {
      metadata: {
        temp_password: password,
        user_name: name,
        user_email: email,
        user_id: user_id || undefined,
      },
    };

    // 4. Apply Trial ONLY if the user is verified as eligible
    if (trial_days && eligibleForTrial) {
      subscriptionData.trial_period_days = parseInt(trial_days, 10);
    }

    // 5. Create the Hosted Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      // Upgrades know exactly which account is paying. Sent through as the
      // session's own reference so the payment processor never has to guess
      // from an email.
      client_reference_id: user_id || undefined,
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
