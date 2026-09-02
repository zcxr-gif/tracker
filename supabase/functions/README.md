# Supabase Edge Functions

These run on Supabase (Deno), not on Netlify, and are deployed separately from
the site:

```bash
supabase functions deploy create-stripe-checkout
```

They were previously untracked — the source lived only in the Supabase
dashboard. Keeping them here means a change to the payment flow can be reviewed
alongside the client code that calls it.

## The Pro entitlement flow

| Step | Where | What it does |
| --- | --- | --- |
| 1 | `profileUI.js` / `MobileDashboardUI.js` `_startProUpgrade()` | ensures a `profiles` row exists, records a pending-activation claim, calls **create-stripe-checkout** |
| 2 | **create-stripe-checkout** (here) | creates the Stripe customer + hosted Checkout session, stamping the account id on both |
| 3 | Stripe | takes the payment, redirects to `/?payment=success&session_id=…` |
| 4 | `authUI.js` `checkPaymentStatus()` | calls **process-stripe-payment** |
| 5 | **process-stripe-payment** *(not in this repo)* | verifies the session with Stripe and writes `profiles.is_pro = true` |
| 6 | `proAccess.js` `resolveAfterCheckout()` | confirms the stamp landed; if not, falls back to **restore-pro-access** and reports why |

`stripe-webhook` *(not in this repo)* is deployed to do exactly that — it
handles `checkout.session.completed`, `customer.subscription.updated` and
`customer.subscription.deleted`, and Stripe retries it for days. **It is not
currently receiving anything.**

Checked 2026-09-02 against the live project:

- No row in `public.subscriptions` has ever been written a second time. There
  are 19 rows going back to 2026-07-29, fifteen of them active monthly
  subscriptions — renewals have certainly happened, and none of them moved a
  row. Only a webhook writes a row twice; the redirect path writes once, at
  checkout.
- The function had no invocations at all in the available log window, while
  `create-stripe-checkout` and `restore-pro-access` both did.

That points at the endpoint not being registered in the Stripe dashboard
(Developers → Webhooks → `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`),
or `STRIPE_WEBHOOK_SECRET` not matching it. **Nothing in this repo can fix
that** — it is a dashboard change.

Until it is fixed, every grant still depends on the pilot's browser returning
to the success URL, which is why the pending claim in `proAccess.js` matters
and why `restore-pro-access` exists. Two things follow that are worth knowing:

- Renewals never refresh `current_period_end`, and cancellations never revoke.
- Eleven active rows carry a **NULL** `current_period_end`, which
  `pro_entitlement()` reads as "never expires" — so those accounts hold Pro
  regardless of whether they are still paying. A NULL there is the difference
  between a subscription and a permanent grant, so it is worth fixing rather
  than working around.

  The NULLs are **interleaved by date**, not split at one — so this is not an
  API version changing under the project on some day; it is per-write. The
  lead worth checking first: `process-stripe-payment` calls Stripe over raw
  `fetch` with only an `Authorization` header and **no `Stripe-Version`**, so
  it gets the account's *default* API version, while `restore-pro-access` and
  `stripe-webhook` go through the SDK pinned to `2024-12-18.acacia`. Stripe
  moved `current_period_end` off the subscription and onto the subscription
  *item* in `2025-03-31.basil`. If the account default is at or past that, the
  redirect path writes NULL and the SDK paths do not — which is the shape of
  the data. Unverified: confirming it needs the Stripe dashboard.

## The same checkout, from the iOS app

The native app (`zcxr-gif/Inflight-IOS`) calls **create-stripe-checkout**
itself, with the signed-in pilot's access token — see `WebSubscription.swift`
and `ios-native/PRO.md` there. It sends the same arguments an upgrade sends
(`is_renew` with `user_id`), so nothing in this function is app-specific.

Two differences from the web flow, both on purpose:

- **`success_url` is `/app-return.html`**, a page whose only job is to bounce
  to `inflight://open`. It grants nothing and calls nothing — there is no
  signed-in Supabase session in that browser to grant with.
- **The grant is `restore-pro-access`'s.** The app asks it on the way back,
  and again on every foreground until the checkout is accounted for — the
  claim is persisted, because iOS may kill the app while Safari has the
  screen. This is deliberately not written to depend on the webhook, given
  the above; if the endpoint is registered later it simply finds the row
  already there.

There is **no yearly price on Stripe**, so the app offers one plan and no
choice, and it never sends `trial_days`.

## Things worth knowing

**`profiles` rows are never created by this codebase.** `signup-free.js`
(Netlify) creates the auth user through the Auth Admin API and stops; every
other reference to `profiles` is a SELECT or an UPDATE. An
`UPDATE profiles SET is_pro = true WHERE id = …` against an account with no row
updates nothing and reports success. `proAccess.ensureProfileRow()` now creates
the row client-side before checkout, but the durable fix is a trigger:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Grants must stay server-side.** Nothing in the browser writes `is_pro`, and
row-level security should keep it that way — a client that can grant itself Pro
is a client that will. `proAccess.ensureProfileRow()` inserts only the `id`, so
an RLS policy can allow the insert while leaving `is_pro` server-write-only.

**Resolve accounts by id, not email.** Emails change and two Stripe customers
can share one. `create-stripe-checkout` stamps `metadata.supabase_user_id` on
the Stripe customer and puts `user_id` on both the session and the
subscription, so `process-stripe-payment` and `restore-pro-access` can look the
account up exactly.

**Trials and `status`.** A trialing subscription reports
`status: "trialing"`, not `"active"`. Any grant that checks for an active
subscription will refuse to unlock an account that just started a trial —
`create-stripe-checkout` therefore never applies a trial to an upgrade.
