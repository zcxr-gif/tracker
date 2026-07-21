-- ===========================================================================
-- Crew Center — Supabase install pack
-- ===========================================================================
-- Run this ONCE in your VA's Supabase project: SQL Editor -> New query -> Run.
-- It is idempotent — safe to re-run.
--
-- schema_version: 1
--
-- SECURITY: the anon key you give the crew center is PUBLIC by design. Every
-- protection below is Row Level Security (RLS) plus SECURITY DEFINER guard
-- triggers. NEVER put your service_role key into the crew center. Have this
-- pack security-reviewed before real pilots rely on it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Versioning
-- ---------------------------------------------------------------------------
create table if not exists public.schema_meta (
  id      int primary key default 1,
  version int not null default 1,
  check (id = 1)
);
insert into public.schema_meta (id, version) values (1, 1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.ranks (
  id         bigint generated always as identity primary key,
  name       text not null,
  min_hours  numeric not null default 0,
  sort_order int not null default 0,
  color      text,
  created_at timestamptz not null default now()
);

create table if not exists public.hubs (
  id         bigint generated always as identity primary key,
  icao       text not null,
  name       text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pilots (
  id            bigint generated always as identity primary key,
  user_id       uuid unique references auth.users(id) on delete cascade,
  callsign      text,
  display_name  text,
  rank_id       bigint references public.ranks(id) on delete set null,
  hub_id        bigint references public.hubs(id) on delete set null,
  role          text not null default 'pilot'
                  check (role in ('owner','staff','pilot')),
  status        text not null default 'pending'
                  check (status in ('pending','active','inactive')),
  total_minutes bigint not null default 0,
  joined_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table if not exists public.routes (
  id           bigint generated always as identity primary key,
  flight_number text,
  dep_icao     text,
  arr_icao     text,
  aircraft     text,
  distance_nm  numeric,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.pireps (
  id            bigint generated always as identity primary key,
  pilot_id      bigint references public.pilots(id) on delete cascade,
  route_id      bigint references public.routes(id) on delete set null,
  callsign      text,
  dep_icao      text,
  arr_icao      text,
  aircraft      text,
  flight_minutes int,
  landing_rate  int,
  source        text not null default 'manual'
                  check (source in ('manual','auto')),
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  raw           jsonb,
  filed_at      timestamptz not null default now()
);

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  title       text not null,
  description text,
  banner_url  text,
  dep_icao    text,
  arr_icao    text,
  starts_at   timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.invite_tokens (
  token          uuid primary key default gen_random_uuid(),
  note           text,
  uses_remaining int not null default 1,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);

-- Singleton, public-readable site configuration (theme + block layout).
create table if not exists public.site_config (
  id          int primary key default 1,
  va_name     text,
  va_slug     text,
  logo_url    text,
  signup_mode text not null default 'open'
                check (signup_mode in ('open','invite','closed')),
  theme       jsonb not null default '{}'::jsonb,
  layout      jsonb not null default '{}'::jsonb,
  blocks      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  check (id = 1)
);
insert into public.site_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Role helper — resolves the caller's crew-center role (active pilots only)
-- ---------------------------------------------------------------------------
create or replace function public.cc_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.pilots
  where user_id = auth.uid() and status = 'active'
  limit 1;
$$;
grant execute on function public.cc_role() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guard triggers (defense-in-depth: clamp privileged columns)
-- ---------------------------------------------------------------------------

-- First pilot on a fresh DB becomes the owner; everyone else is a pending pilot.
create or replace function public.cc_before_insert_pilot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  if (select count(*) from public.pilots) = 0 then
    new.role := 'owner';
    new.status := 'active';
  else
    new.role := 'pilot';           -- never trust a client-supplied role
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists cc_before_insert_pilot on public.pilots;
create trigger cc_before_insert_pilot before insert on public.pilots
  for each row execute function public.cc_before_insert_pilot();

-- Non-staff may edit only cosmetic fields on their own row.
create or replace function public.cc_before_update_pilot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.cc_role() in ('owner','staff') then
    return new;                    -- staff may change anything
  end if;
  new.role          := old.role;
  new.status        := old.status;
  new.total_minutes := old.total_minutes;
  new.rank_id       := old.rank_id;
  return new;
end $$;
drop trigger if exists cc_before_update_pilot on public.pilots;
create trigger cc_before_update_pilot before update on public.pilots
  for each row execute function public.cc_before_update_pilot();

-- A pilot cannot self-approve a PIREP.
create or replace function public.cc_before_insert_pirep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.cc_role() not in ('owner','staff') then
    new.status := 'pending';
    new.source := 'manual';
  end if;
  return new;
end $$;
drop trigger if exists cc_before_insert_pirep on public.pireps;
create trigger cc_before_insert_pirep before insert on public.pireps
  for each row execute function public.cc_before_insert_pirep();

-- Roll approved flight time up into the pilot's total.
create or replace function public.cc_after_update_pirep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved'
     and new.flight_minutes is not null and new.pilot_id is not null then
    update public.pilots
       set total_minutes = total_minutes + new.flight_minutes
     where id = new.pilot_id;
  end if;
  return new;
end $$;
drop trigger if exists cc_after_update_pirep on public.pireps;
create trigger cc_after_update_pirep after update on public.pireps
  for each row execute function public.cc_after_update_pirep();

-- ---------------------------------------------------------------------------
-- cc_join — the ONE way to become a pilot (keeps invite tokens private and
-- signup gating server-side). Direct inserts into pilots are denied by RLS.
-- ---------------------------------------------------------------------------
create or replace function public.cc_join(
  p_callsign     text default null,
  p_display_name text default null,
  p_token        uuid default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_mode text; v_pid bigint; v_uses int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.pilots where user_id = auth.uid()) then
    raise exception 'already a member';
  end if;

  -- The very first member (the owner) is always allowed to bootstrap.
  if (select count(*) from public.pilots) > 0 then
    select signup_mode into v_mode from public.site_config where id = 1;
    if v_mode = 'closed' then
      raise exception 'signups are closed';
    elsif v_mode = 'invite' then
      if p_token is null then raise exception 'an invite is required'; end if;
      update public.invite_tokens
         set uses_remaining = uses_remaining - 1
       where token = p_token and uses_remaining > 0
       returning uses_remaining into v_uses;
      if v_uses is null then raise exception 'invalid or spent invite'; end if;
    end if;
  end if;

  insert into public.pilots (user_id, callsign, display_name)
       values (auth.uid(), p_callsign, p_display_name)
    returning id into v_pid;
  return v_pid;
end $$;
grant execute on function public.cc_join(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.schema_meta   enable row level security;
alter table public.site_config   enable row level security;
alter table public.ranks         enable row level security;
alter table public.hubs          enable row level security;
alter table public.routes        enable row level security;
alter table public.events        enable row level security;
alter table public.pilots        enable row level security;
alter table public.pireps        enable row level security;
alter table public.invite_tokens enable row level security;

-- Public-read reference data ------------------------------------------------
drop policy if exists cc_meta_read on public.schema_meta;
create policy cc_meta_read on public.schema_meta for select using (true);

drop policy if exists cc_cfg_read on public.site_config;
create policy cc_cfg_read on public.site_config for select using (true);
drop policy if exists cc_cfg_write on public.site_config;
create policy cc_cfg_write on public.site_config for update
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

-- ranks / hubs / routes / events: public read, staff write
drop policy if exists cc_ranks_read on public.ranks;
create policy cc_ranks_read on public.ranks for select using (true);
drop policy if exists cc_ranks_write on public.ranks;
create policy cc_ranks_write on public.ranks for all
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

drop policy if exists cc_hubs_read on public.hubs;
create policy cc_hubs_read on public.hubs for select using (true);
drop policy if exists cc_hubs_write on public.hubs;
create policy cc_hubs_write on public.hubs for all
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

drop policy if exists cc_routes_read on public.routes;
create policy cc_routes_read on public.routes for select using (true);
drop policy if exists cc_routes_write on public.routes;
create policy cc_routes_write on public.routes for all
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

drop policy if exists cc_events_read on public.events;
create policy cc_events_read on public.events for select using (true);
drop policy if exists cc_events_write on public.events;
create policy cc_events_write on public.events for all
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

-- pilots: public sees the active roster; you always see your own row; staff see all
drop policy if exists cc_pilots_read on public.pilots;
create policy cc_pilots_read on public.pilots for select using (
  status = 'active'
  or user_id = auth.uid()
  or public.cc_role() in ('owner','staff')
);
-- No INSERT policy on purpose: joining goes through cc_join() only.
drop policy if exists cc_pilots_update on public.pilots;
create policy cc_pilots_update on public.pilots for update using (
  user_id = auth.uid() or public.cc_role() in ('owner','staff')
) with check (
  user_id = auth.uid() or public.cc_role() in ('owner','staff')
);
drop policy if exists cc_pilots_delete on public.pilots;
create policy cc_pilots_delete on public.pilots for delete
  using (public.cc_role() in ('owner','staff'));

-- pireps: approved are public; you see your own; staff see all
drop policy if exists cc_pireps_read on public.pireps;
create policy cc_pireps_read on public.pireps for select using (
  status = 'approved'
  or public.cc_role() in ('owner','staff')
  or pilot_id in (select id from public.pilots where user_id = auth.uid())
);
drop policy if exists cc_pireps_insert on public.pireps;
create policy cc_pireps_insert on public.pireps for insert to authenticated
  with check (
    pilot_id in (select id from public.pilots where user_id = auth.uid())
  );
drop policy if exists cc_pireps_update on public.pireps;
create policy cc_pireps_update on public.pireps for update
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

-- invite_tokens: staff only (never exposed to the anon client; cc_join reads them
-- as SECURITY DEFINER).
drop policy if exists cc_invites_all on public.invite_tokens;
create policy cc_invites_all on public.invite_tokens for all
  using (public.cc_role() in ('owner','staff'))
  with check (public.cc_role() in ('owner','staff'));

-- ===========================================================================
-- Done. Grab your Project URL and anon (public) key from
-- Supabase -> Project Settings -> API, and paste them into the crew-center
-- onboarding wizard.
-- ===========================================================================
