-- ============================================================================
--  InFlight — Pro entitlement repair
--  Paste the whole file into the Supabase SQL editor and press Run.
--
--  Safe to run more than once: every step is idempotent, nothing is dropped,
--  and no existing Pro account is ever downgraded. It finishes by printing a
--  report so you can see what it found and what it changed.
--
--  What it does
--    1. Reports the current state of public.profiles.
--    2. Creates the profiles rows that were never created, for every existing
--       account. This is the suspected cause of paid upgrades not sticking:
--       `UPDATE profiles SET is_pro = true WHERE id = …` against an account
--       with no row updates nothing and reports success, so Stripe takes the
--       payment and the pilot stays on the free tier.
--    3. Installs a trigger so every future sign-up gets its row automatically.
--    4. Locks `is_pro` down to server-side writes only, while leaving the
--       columns the app legitimately writes (map_filters, etc.) alone.
--    5. Makes sure the row-level security policies the app needs exist.
--
--  What it does NOT do: grant Pro to anyone. Who has paid lives in Stripe, not
--  in Postgres. See the two optional blocks at the bottom for that.
-- ============================================================================


-- ── 1. Before ────────────────────────────────────────────────────────────────
do $$
declare
  v_missing bigint;
  v_users   bigint;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist — stop here and check the table name.';
  end if;

  select count(*) into v_users from auth.users;
  select count(*) into v_missing
    from auth.users u
    left join public.profiles p on p.id = u.id
   where p.id is null;

  raise notice '--- BEFORE -------------------------------------------------';
  raise notice 'accounts: %', v_users;
  raise notice 'accounts with NO profiles row: %   <-- upgrades for these could never stick', v_missing;
end $$;


-- ── 2. Backfill the missing rows ─────────────────────────────────────────────
-- Only the primary key is written, so this cannot disturb any existing data.
-- If profiles has other NOT NULL columns without defaults this will fail loudly
-- — add them to the insert list and re-run.
insert into public.profiles (id)
select u.id
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
on conflict do nothing;


-- ── 3. Keep it from happening again ──────────────────────────────────────────
-- Every new account gets its profiles row at sign-up, whichever route it came
-- in by (the app's free sign-up function, a paid checkout, or the dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id) values (new.id) on conflict do nothing;
  exception when others then
    -- A profiles row is important, but never important enough to fail a
    -- sign-up over. Log and let the account be created.
    raise warning 'handle_new_user: could not create profiles row for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 4. Make is_pro server-write-only ─────────────────────────────────────────
-- The app updates profiles from the browser (map_filters), so we can't simply
-- revoke UPDATE. Instead we drop the table-wide grant and hand back every
-- column except is_pro. Edge functions use the service_role key, which bypasses
-- this entirely, so the real grant path is unaffected.
--
-- Without this, anyone with a session could PATCH themselves to Pro.
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
       and column_name <> 'is_pro'
  loop
    execute format('grant update (%I) on public.profiles to authenticated', col);
  end loop;

  raise notice 'is_pro is now writable only by the service role.';
end $$;


-- ── 5. Row-level security ────────────────────────────────────────────────────
-- Adds only what's missing, and only under names of its own, so any policies
-- you already have are left exactly as they are.
alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='profiles' and cmd='SELECT') then
    create policy "inflight_profiles_select_own" on public.profiles
      for select to authenticated using (auth.uid() = id);
    raise notice 'added SELECT policy';
  end if;

  -- This is what lets the client create its own row before checkout
  -- (proAccess.ensureProfileRow). It can only insert its own id, and step 4
  -- means it still cannot set is_pro.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='profiles' and cmd='INSERT') then
    create policy "inflight_profiles_insert_own" on public.profiles
      for insert to authenticated with check (auth.uid() = id);
    raise notice 'added INSERT policy';
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='profiles' and cmd='UPDATE') then
    create policy "inflight_profiles_update_own" on public.profiles
      for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
    raise notice 'added UPDATE policy';
  end if;
end $$;


-- ── 6. Report ────────────────────────────────────────────────────────────────
select 'accounts'                        as check,
       count(*)::text                    as value,
       'total auth.users'                as note
  from auth.users
union all
select 'profiles rows',
       count(*)::text,
       'should now equal the row above'
  from public.profiles
union all
select 'still missing a row',
       count(*)::text,
       case when count(*) = 0 then 'good — every account has one'
            else 'profiles has other required columns; add them to step 2' end
  from auth.users u left join public.profiles p on p.id = u.id
 where p.id is null
union all
select 'is_pro = true',
       count(*)::text,
       'accounts currently unlocked'
  from public.profiles where is_pro is true
union all
select 'paid-looking but not Pro',
       count(*)::text,
       'signed up free, never unlocked — cross-check these against Stripe'
  from public.profiles p
  join auth.users u on u.id = p.id
 where coalesce(p.is_pro, false) = false
   and (u.raw_user_meta_data->>'is_pro') = 'false'
union all
select 'signup trigger',
       case when exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')
            then 'installed' else 'MISSING' end,
       'creates the profiles row for new accounts'
union all
select 'is_pro client-writable',
       case when has_column_privilege('authenticated', 'public.profiles', 'is_pro', 'UPDATE')
            then 'YES — still open' else 'no — server only' end,
       'should read: no — server only';


-- ============================================================================
--  OPTIONAL A — unlock specific pilots you know have paid
--
--  Export the paying customers from the Stripe dashboard (Customers → Export),
--  paste their emails below and run just this block. Case-insensitive, and it
--  never downgrades anyone.
-- ============================================================================
-- update public.profiles p
--    set is_pro = true
--   from auth.users u
--  where u.id = p.id
--    and lower(u.email) = any (array[
--      'pilot1@example.com',
--      'pilot2@example.com'
--    ]);


-- ============================================================================
--  OPTIONAL B — unlock everyone with a live Stripe subscription, automatically
--
--  Supabase's Stripe foreign-data wrapper lets Postgres query Stripe directly,
--  so this fixes every affected pilot in one statement instead of a copied
--  list. Four short steps; keep the key in Vault rather than inline.
--
--  Note the two things that look like they should work and don't:
--  CREATE FOREIGN DATA WRAPPER has no IF NOT EXISTS, and server options must
--  be string literals — you cannot feed them a sub-select, which is why the
--  key id is fetched in its own step and pasted in.
-- ============================================================================

--  B1 — enable the wrapper and store the key (run once)
-- create extension if not exists wrappers with schema extensions;
-- select vault.create_secret('sk_live_REPLACE_ME', 'stripe_key', 'Stripe secret key');

--  B2 — read the key id, then paste it into B3
-- select id from vault.secrets where name = 'stripe_key';

--  B3 — wire Stripe up as a foreign schema (skip the wrapper line if it exists)
-- create foreign data wrapper stripe_wrapper
--   handler extensions.stripe_fdw_handler
--   validator extensions.stripe_fdw_validator;
--
-- create server if not exists stripe_server
--   foreign data wrapper stripe_wrapper
--   options (api_key_id 'PASTE_THE_ID_FROM_B2');
--
-- create schema if not exists stripe;
-- import foreign schema stripe limit to ("customers", "subscriptions")
--   from server stripe_server into stripe;

--  B4 — look first, then unlock. `trialing` counts: a trial is a subscription,
--  and refusing it is how a pilot who just paid stays locked out.
-- select u.email, s.status, coalesce(p.is_pro, false) as is_pro_now
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   join stripe.customers c on lower(c.email) = lower(u.email)
--   join stripe.subscriptions s on s.customer = c.id
--  where s.status in ('active', 'trialing', 'past_due')
--    and coalesce(p.is_pro, false) = false;
--
-- update public.profiles p
--    set is_pro = true
--   from auth.users u, stripe.customers c, stripe.subscriptions s
--  where u.id = p.id
--    and lower(c.email) = lower(u.email)
--    and s.customer = c.id
--    and s.status in ('active', 'trialing', 'past_due')
--    and coalesce(p.is_pro, false) = false;
