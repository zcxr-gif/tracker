-- ============================================================================
--  InFlight — real entitlement, and cloud preferences for Pro
--  Paste the whole file into the Supabase SQL editor and press Run.
--
--  Safe to run more than once. Nothing is dropped, and — this is the important
--  part — NOBODY WHO HAS PRO TODAY LOSES IT. The file finishes by printing a
--  report of what it found and what it changed.
--
--  ── The problem ────────────────────────────────────────────────────────────
--  The app decides Pro like this:
--
--      isPro = profiles.is_pro === true ? true : !metaFree
--
--  which reads as "a signed-in account is Pro unless we explicitly stamped it
--  free". That is backwards. An account nobody stamped — a sign-up that
--  predates the free-stamp, an invite, anything created by a path that forgot
--  — is Pro forever, and no cancellation can take it away: stripe-webhook's
--  revokePro() has to stamp user_metadata.is_pro = false purely to work around
--  this rule, and that only reaches accounts that went through Stripe.
--
--  So a cancelled subscription does not reliably lock the app, which is the
--  thing this fixes.
--
--  ── The rule this installs ─────────────────────────────────────────────────
--  One function, public.pro_entitlement(), is the single answer. In order:
--
--    1. a live subscription        (active/trialing inside its paid period, or
--                                   cancelled but paid through a period that
--                                   has not run out yet)
--    2. a subscription in dunning  (past_due, inside a grace window — Stripe is
--                                   still retrying the card, and pulling Pro
--                                   mid-retry punishes a pilot whose payment is
--                                   about to go through)
--    3. profiles.is_pro = true     (manual grants, staff, comped accounts)
--    4. profiles.legacy_pro = true (grandfathered — see below)
--    5. otherwise: free.
--
--  A subscription that has ENDED beats profiles.is_pro. That is the lock: if
--  the webhook is ever missed, an expired period still closes the account.
--
--  ── Who is grandfathered ───────────────────────────────────────────────────
--  Existing users are not kicked out. Step 3 sets legacy_pro on exactly the
--  accounts that are receiving Pro under the old rule TODAY — the ones never
--  stamped free — and only those that have never had a subscription. Accounts
--  that pay are governed by Stripe, as they should be; accounts stamped free
--  stay free (they are not receiving Pro now, and grandfathering them would be
--  granting Pro, not preserving it).
--
--  From this point on, a new account needs a subscription. The hole is closed
--  going forward without taking anything away from anyone.
--
--  ── Preferences ────────────────────────────────────────────────────────────
--  Step 5 adds the two columns the preference sync writes. See
--  preferenceSync.js for the allowlist of what is actually stored — no tokens,
--  no caches, no entitlement.
-- ============================================================================


-- ── 1. Before ────────────────────────────────────────────────────────────────
do $$
declare
  v_users bigint; v_stamped_free bigint; v_unstamped bigint; v_subs bigint;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist — run fix-pro-entitlement.sql first.';
  end if;

  select count(*) into v_users from auth.users;
  select count(*) into v_stamped_free from auth.users
   where raw_user_meta_data->>'is_pro' = 'false';
  select count(*) into v_unstamped from auth.users
   where coalesce(raw_user_meta_data->>'is_pro', 'true') <> 'false';
  select count(distinct user_id) into v_subs from public.subscriptions;

  raise notice '--- BEFORE -------------------------------------------------';
  raise notice 'accounts:                                   %', v_users;
  raise notice 'explicitly stamped free (already locked):   %', v_stamped_free;
  raise notice 'getting Pro under the old rule:             %', v_unstamped;
  raise notice 'accounts with a subscription row:           %', v_subs;
end $$;


-- ── 2. The grandfather flag ──────────────────────────────────────────────────
alter table public.profiles
  add column if not exists legacy_pro boolean not null default false;

comment on column public.profiles.legacy_pro is
  'Grandfathered Pro. Set once, by entitlement-and-preferences.sql, for the '
  'accounts that were receiving Pro under the old "signed in unless stamped '
  'free" rule. Never set for new accounts — they need a subscription. Not '
  'writable from the client (see the RLS step below).';


-- ── 3. Backfill it — nobody currently on Pro loses it ────────────────────────
-- Deliberately excludes anyone with a subscription row: their entitlement
-- follows Stripe, and grandfathering a paying account would mean cancelling
-- never locked it.
update public.profiles p
   set legacy_pro = true
  from auth.users u
 where u.id = p.id
   and p.legacy_pro is distinct from true
   and coalesce(u.raw_user_meta_data->>'is_pro', 'true') <> 'false'
   and not exists (select 1 from public.subscriptions s where s.user_id = p.id);


-- ── 4. The single answer ─────────────────────────────────────────────────────
-- security definer so it can read subscriptions and profiles regardless of the
-- caller's policies, but it only ever reports on auth.uid() — the caller's own
-- account — so it cannot be used to read anybody else's entitlement.
create or replace function public.pro_entitlement()
returns table (
  is_pro               boolean,
  source               text,
  status               text,
  until                timestamptz,
  cancel_at_period_end boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_sub   public.subscriptions%rowtype;
  v_prof  public.profiles%rowtype;
  -- Stripe retries a failed card for up to about two weeks. Matching that
  -- keeps the app from locking someone whose payment is still in flight.
  v_grace interval := interval '14 days';
begin
  if v_uid is null then
    return query select false, 'signed-out'::text, null::text, null::timestamptz, false;
    return;
  end if;

  select * into v_prof from public.profiles where id = v_uid;
  select * into v_sub  from public.subscriptions
   where user_id = v_uid
   order by updated_at desc
   limit 1;

  if v_sub.user_id is not null then
    -- Live: paid up, and inside the period that was paid for.
    --
    -- 'canceled' is included deliberately. Stripe's own convention is to leave
    -- a cancelling subscription 'active' with cancel_at_period_end until the
    -- period runs out, but process-stripe-payment writes 'canceled' the moment
    -- the cancellation webhook lands — while current_period_end is still in
    -- the future. Reading only the status there would pull the app off a pilot
    -- who has paid through the end of the month, which is the one thing the
    -- billing card promises will not happen. A cancelled row with NO period end
    -- is not covered: there is no paid period to honour, so it has ended.
    if (v_sub.status in ('active', 'trialing')
        and (v_sub.current_period_end is null or v_sub.current_period_end > now()))
       or (v_sub.status = 'canceled'
        and v_sub.current_period_end is not null
        and v_sub.current_period_end > now()) then
      return query select true, 'subscription'::text, v_sub.status,
                          v_sub.current_period_end, v_sub.cancel_at_period_end;
      return;
    end if;

    -- Dunning. Stripe is still trying the card; do not pull the app yet.
    if v_sub.status = 'past_due'
       and (v_sub.current_period_end is null or v_sub.current_period_end > now() - v_grace) then
      return query select true, 'grace'::text, v_sub.status,
                          v_sub.current_period_end, v_sub.cancel_at_period_end;
      return;
    end if;

    -- Ended. This is the lock, and it deliberately beats profiles.is_pro: if
    -- the webhook was missed, the expired period still closes the account.
    -- A grandfathered account falls back to what it had before it ever paid.
    if coalesce(v_prof.legacy_pro, false) then
      return query select true, 'legacy'::text, v_sub.status,
                          v_sub.current_period_end, v_sub.cancel_at_period_end;
      return;
    end if;

    return query select false, 'expired'::text, v_sub.status,
                        v_sub.current_period_end, v_sub.cancel_at_period_end;
    return;
  end if;

  -- No subscription row at all: a manual grant, or a grandfathered account.
  if coalesce(v_prof.is_pro, false) then
    return query select true, 'profile'::text, null::text, null::timestamptz, false;
    return;
  end if;
  if coalesce(v_prof.legacy_pro, false) then
    return query select true, 'legacy'::text, null::text, null::timestamptz, false;
    return;
  end if;

  return query select false, 'free'::text, null::text, null::timestamptz, false;
end $$;

revoke all on function public.pro_entitlement() from public;
grant execute on function public.pro_entitlement() to authenticated;

comment on function public.pro_entitlement() is
  'The single answer to "is the calling pilot Pro?", derived from their '
  'subscription first and their profile second. An ended subscription beats '
  'profiles.is_pro so a missed webhook cannot leave an account unlocked.';


-- ── 5. Cloud preferences (Pro) ───────────────────────────────────────────────
-- One JSON blob rather than a column per setting: the app adds settings often,
-- and a schema change per checkbox is how sync silently stops covering half of
-- them. The allowlist of what may go in here lives in preferenceSync.js.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.user_preferences
  add column if not exists preferences jsonb,
  add column if not exists preferences_updated_at timestamptz;

comment on column public.user_preferences.preferences is
  'Allowlisted client preferences (theme, accent, units, playback defaults, …) '
  'for Pro accounts. Never credentials, caches or entitlement — see the '
  'SYNCED_KEYS table in preferenceSync.js.';
comment on column public.user_preferences.preferences_updated_at is
  'When the client last wrote the blob. Used to decide whether the device or '
  'the cloud is newer, so opening a second device does not clobber the first.';

alter table public.user_preferences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'user_preferences_select_own'
  ) then
    create policy user_preferences_select_own on public.user_preferences
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'user_preferences_upsert_own'
  ) then
    create policy user_preferences_upsert_own on public.user_preferences
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'user_preferences_update_own'
  ) then
    create policy user_preferences_update_own on public.user_preferences
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;


-- ── 6. Keep legacy_pro out of the client's reach ─────────────────────────────
-- Same mechanism fix-pro-entitlement.sql uses for is_pro: column-level grants,
-- not a policy with a subquery (a policy on profiles that reads profiles
-- recurses). Re-run rather than extended, because a column added AFTER the
-- table-wide UPDATE grant was revoked has no grant of its own — so this both
-- closes legacy_pro and hands back anything else added since.
--
-- legacy_pro is an entitlement. A client that can set its own is a client that
-- will. Edge functions use the service role and bypass all of this.
do $$
declare
  col text;
begin
  revoke update on public.profiles from authenticated, anon;

  for col in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name not in ('is_pro', 'legacy_pro')
  loop
    execute format('grant update (%I) on public.profiles to authenticated', col);
  end loop;

  raise notice 'is_pro and legacy_pro are writable only by the service role.';
end $$;


-- ── 7. After ─────────────────────────────────────────────────────────────────
do $$
declare
  v_legacy bigint; v_paid bigint; v_free bigint;
begin
  select count(*) into v_legacy from public.profiles where legacy_pro;
  select count(distinct user_id) into v_paid from public.subscriptions
   where status in ('active', 'trialing');
  select count(*) into v_free from public.profiles p
   where not coalesce(p.legacy_pro, false)
     and not coalesce(p.is_pro, false)
     and not exists (select 1 from public.subscriptions s where s.user_id = p.id);

  raise notice '--- AFTER --------------------------------------------------';
  raise notice 'grandfathered (keep Pro, no subscription): %', v_legacy;
  raise notice 'live subscriptions:                        %', v_paid;
  raise notice 'free accounts:                             %', v_free;
  raise notice '';
  raise notice 'Nobody was downgraded. Every account created from now on needs';
  raise notice 'a subscription, and a cancelled one now locks the app when its';
  raise notice 'paid period ends.';
end $$;

select 'legacy_pro client-writable' as check,
       case when has_column_privilege('authenticated', 'public.profiles', 'legacy_pro', 'UPDATE')
            then 'YES — still open' else 'no — server only' end as value,
       'should read: no — server only' as note
union all
select 'pro_entitlement()',
       case when to_regprocedure('public.pro_entitlement()') is null
            then 'MISSING' else 'installed' end,
       'the single answer the app reads'
union all
select 'preferences columns',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'user_preferences'
                            and column_name = 'preferences')
            then 'installed' else 'MISSING' end,
       'cloud preference sync for Pro';
