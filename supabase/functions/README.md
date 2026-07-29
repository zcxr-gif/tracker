# Supabase Edge Functions

These run on Supabase (Deno), not on Netlify, and are deployed separately from
the site:

```bash
supabase functions deploy create-stripe-checkout
```

They were previously untracked — the source lived only in the Supabase
dashboard. Keeping them here means a change to the payment flow can be reviewed
alongside the client code that calls it.

## Before any of this works: the `profiles` table

The entitlement lives in `public.profiles`, and **no code in this repository
creates that table** — not the client, not the edge functions, not the SQL that
runs at sign-up. If the Supabase project was set up without it, every upgrade
fails the same way: Stripe takes the payment, `process-stripe-payment` cannot
write the grant, and the pilot comes back to a locked app with

```
[process-stripe-payment] Error: Could not apply the Pro entitlement:
Could not find the table 'public.profiles' in the schema cache
```

in the function logs. That message is PostgREST's PGRST205 — the table is not
there, so the API has nothing to expose.

Fix it once by running [`../sql/fix-pro-entitlement.sql`](../sql/fix-pro-entitlement.sql)
in the Supabase SQL editor. It creates the table (and any column the app needs
that is missing), backfills a row for every existing account, installs the
sign-up trigger, sets the row-level security up so `is_pro` is server-write-only,
and reloads the schema cache. It is idempotent and never downgrades anyone.

Pilots who already paid while the table was missing are still paid customers at
Stripe: after the table exists, their pending claim resolves on the next app
load, or you can unlock them by hand with
[`../sql/grant-pro-to-user.sql`](../sql/grant-pro-to-user.sql).

## The Pro entitlement flow

| Step | Where | What it does |
| --- | --- | --- |
| 1 | `profileUI.js` / `MobileDashboardUI.js` `_startProUpgrade()` | ensures a `profiles` row exists, records a pending-activation claim, calls **create-stripe-checkout** |
| 2 | **create-stripe-checkout** (here) | creates the Stripe customer + hosted Checkout session, stamping the account id on both |
| 3 | Stripe | takes the payment, redirects to `/?payment=success&session_id=…` |
| 4 | `authUI.js` `checkPaymentStatus()` | calls **process-stripe-payment** |
| 5 | **process-stripe-payment** *(not in this repo)* | verifies the session with Stripe and writes `profiles.is_pro = true` |
| 6 | `proAccess.js` `resolveAfterCheckout()` | confirms the stamp landed; if not, falls back to **restore-pro-access** and reports why |

There is **no Stripe webhook**. Every grant depends on the pilot's browser
returning to the success URL, which is why `proAccess.js` keeps a pending claim
and retries on later loads. A webhook on `checkout.session.completed` /
`customer.subscription.updated` would make the grant independent of the browser
entirely, and is the right long-term fix.

## Things worth knowing

**`profiles` rows are never created by this codebase either.** `signup-free.js`
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
