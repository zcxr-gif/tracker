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

`stripe-webhook` *(not in this repo)* now backs all of this up: Stripe calls it
directly on `checkout.session.completed`, `customer.subscription.updated` and
`customer.subscription.deleted`, and retries for days. Steps 3–6 above are
therefore a **speed-up**, not the grant — a pilot who pays and closes the tab
still gets Pro. The pending claim in `proAccess.js` stays because it is what
makes the answer arrive while they are still looking at the page.

## The same checkout, from the iOS app

The native app (`zcxr-gif/Inflight-IOS`) calls **create-stripe-checkout**
itself, with the signed-in pilot's access token — see `WebSubscription.swift`
and `ios-native/PRO.md` there. It sends the same arguments an upgrade sends
(`is_renew` with `user_id`), so nothing in this function is app-specific.

Two differences from the web flow, both on purpose:

- **`success_url` is `/app-return.html`**, a page whose only job is to bounce
  to `inflight://open`. It grants nothing and calls nothing — there is no
  signed-in Supabase session in that browser to grant with.
- **The grant is the webhook's**, entirely. The app asks `restore-pro-access`
  on its way back so the answer arrives while the paywall is still up, and
  re-reads `pro_entitlement()` on every foreground regardless.

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
