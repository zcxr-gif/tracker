-- ============================================================================
--  InFlight — "your window, seen by others"
--  Paste the whole file into the Supabase SQL editor and press Run.
--
--  Safe to run more than once. No data is dropped (pilot_window_style is
--  dropped and recreated to add a column to its result), and the existing profile
--  functions the iOS app calls (pilot_profile_card, pilot_profile_by_if_username)
--  are NOT changed: the window style is served by its own function, so no
--  existing decoder sees a new column.
--
--  ── What a pilot can set ───────────────────────────────────────────────────
--    window_theme    free. One of the painted presets (the banner presets'
--                    names). Tints the window everyone else sees for this
--                    pilot's flight.
--    window_color    Pro. A custom window colour.
--    window_bg_path  Pro. A photo behind the window, in the pilot-banners
--                    bucket, written only by the profile-image function
--                    (kind 'window'), exactly like a photo banner.
--    window_bg_dim   How strongly the window colour is laid over that photo.
--    window_flair    Pro. The shimmer on the pilot card. On by default; the
--                    pilot can turn it off. (The web map no longer draws a
--                    glow for it.)
--    window_flair_style Pro. Which flair animation plays on the banner:
--                    shine, glow, aurora, sparkle or drift, optionally followed
--                    by a shine ('glow+shine', …). Null plays shine. See
--                    pilotFlair.js.
--    window_pro_badge Pro. A PRO mark by the pilot's name on their flight
--                    window. OFF by default — only the pilot can turn it on.
--
--  ── Pro lapses ─────────────────────────────────────────────────────────────
--  Same rule as the photo banner: the Pro values stay in the row, but
--  pilot_window_style() stops serving them while the owner is not Pro, and
--  they come back the day the subscription does.
-- ============================================================================

-- MARK: columns
alter table public.pilot_profiles
  add column if not exists window_theme   text,
  add column if not exists window_color   text,
  add column if not exists window_bg_path text,
  add column if not exists window_bg_dim  smallint not null default 60,
  add column if not exists window_flair   boolean  not null default true,
  add column if not exists window_pro_badge boolean not null default false,
  add column if not exists window_flair_style text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pilot_profiles_window_theme_check') then
    alter table public.pilot_profiles add constraint pilot_profiles_window_theme_check
      check (window_theme is null or window_theme in ('dusk', 'dawn', 'flight_level', 'night', 'desert', 'ocean'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pilot_profiles_window_color_shape') then
    alter table public.pilot_profiles add constraint pilot_profiles_window_color_shape
      check (window_color is null or window_color ~ '^#[0-9a-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pilot_profiles_window_flair_style_check') then
    alter table public.pilot_profiles add constraint pilot_profiles_window_flair_style_check
      check (window_flair_style is null or window_flair_style in (
        'shine', 'glow', 'aurora', 'sparkle', 'drift',
        'glow+shine', 'aurora+shine', 'sparkle+shine', 'drift+shine'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pilot_profiles_window_bg_dim_range') then
    alter table public.pilot_profiles add constraint pilot_profiles_window_bg_dim_range
      check (window_bg_dim between 20 and 90);
  end if;
end $$;

-- MARK: write guard
-- Its own trigger rather than another branch in pilot_profiles_guard, so the
-- main guard (shared with the iOS app) is left exactly as it is. Runs after
-- it (triggers fire in name order), and before the check constraints, so the
-- normalising here is what the constraints see.
create or replace function public.pilot_profiles_window_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.window_theme := nullif(lower(btrim(coalesce(new.window_theme, ''))), '');
  new.window_color := nullif(lower(btrim(coalesce(new.window_color, ''))), '');
  new.window_bg_dim := greatest(20, least(90, coalesce(new.window_bg_dim, 60)));

  -- A Pro value may be SET only by a Pro account. Clearing one is always
  -- allowed, so a lapsed pilot can still take their photo down.
  if auth.uid() is not null
     and ((tg_op = 'INSERT' and (new.window_color is not null or new.window_bg_path is not null))
       or (tg_op = 'UPDATE' and ((new.window_color is distinct from old.window_color and new.window_color is not null)
                              or (new.window_bg_path is distinct from old.window_bg_path and new.window_bg_path is not null)))) then
    if not public.is_pro_account(new.user_id) then
      raise exception 'A custom window colour and window photo are part of Inflight Pro.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $function$;

drop trigger if exists pilot_profiles_window_guard on public.pilot_profiles;
create trigger pilot_profiles_window_guard
  before insert or update on public.pilot_profiles
  for each row execute function public.pilot_profiles_window_guard();

-- MARK: what a viewer is served
-- The flight window knows the Infinite Flight username on the aircraft, so it
-- looks up by that, with the same visibility rule as every other profile read.
-- Dropped first: Postgres can't add a column to a function's result in place
-- (window_pro_badge and window_flair_style were added after it was first created).
drop function if exists public.pilot_window_style(text);
create or replace function public.pilot_window_style(p_username text)
returns table(handle text, is_pro boolean, window_theme text, window_color text,
              window_bg_path text, window_bg_dim smallint, window_flair boolean, accent text,
              window_pro_badge boolean, window_flair_style text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_p public.pilot_profiles%rowtype;
  v_pro boolean;
begin
  select * into v_p
    from public.pilot_profiles p
   where lower(p.if_username) = lower(btrim(coalesce(p_username, '')))
     and p.is_public
     and p.moderation_state = 'ok'
   order by p.created_at asc
   limit 1;

  if not found or not public.pilot_profile_visible(v_p, auth.uid()) then
    return;
  end if;

  v_pro := public.is_pro_account(v_p.user_id);

  return query select
    v_p.handle,
    v_pro,
    v_p.window_theme,
    case when v_pro then v_p.window_color else null end,
    case when v_pro then v_p.window_bg_path else null end,
    v_p.window_bg_dim,
    v_pro and v_p.window_flair,
    case when v_pro then v_p.accent else null end,
    v_pro and v_p.window_pro_badge,
    case when v_pro then v_p.window_flair_style else null end;
end $function$;

grant execute on function public.pilot_window_style(text) to anon, authenticated;

-- Which aircraft get the map glow: one call for the whole map instead of one
-- per aircraft. The web map no longer draws the glow; kept for other clients. Only Pro pilots with flair on, and only profiles this viewer
-- may see at all.
create or replace function public.pilot_flair_usernames()
returns setof text
language sql
stable security definer
set search_path to 'public'
as $function$
  select lower(p.if_username)
    from public.pilot_profiles p
   where p.if_username is not null
     and p.window_flair
     and p.is_public
     and p.moderation_state = 'ok'
     and public.pilot_profile_visible(p, auth.uid())
     and public.is_pro_account(p.user_id)
   limit 5000;
$function$;

grant execute on function public.pilot_flair_usernames() to anon, authenticated;

-- MARK: moderation — the window photo is a third picture kind
alter table public.pilot_content_actions drop constraint if exists pilot_content_actions_kind_check;
alter table public.pilot_content_actions add constraint pilot_content_actions_kind_check
  check (kind = any (array['avatar'::text, 'banner'::text, 'window'::text]));

create or replace function public.admin_pilot_takedown(p_user_id uuid, p_kind text, p_category text DEFAULT 'other'::text, p_note text DEFAULT NULL::text, p_removed_by text DEFAULT NULL::text, p_warn_level text DEFAULT NULL::text, p_warn_reason text DEFAULT NULL::text, p_block_uploads boolean DEFAULT false, p_block_days integer DEFAULT NULL::integer)
 RETURNS TABLE(removed_bucket text, removed_path text, warning_id uuid, action_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bucket text;
  v_path text;
  v_handle text;
  v_warning uuid;
  v_action uuid;
  v_until timestamptz;
  v_reason text;
begin
  if p_kind not in ('avatar', 'banner', 'window') then
    raise exception 'kind must be avatar, banner or window' using errcode = 'check_violation';
  end if;

  -- The window photo lives in the banners bucket, beside the photo banner.
  v_bucket := case p_kind when 'avatar' then 'pilot-avatars' else 'pilot-banners' end;

  /* Read the path, THEN clear it -- and hold the row across both.
   *
   * `update ... returning` cannot be used to learn what was removed: RETURNING
   * hands back the NEW row, whose path is null by definition, and the record
   * would store a null for the one field that says which picture this was.
   *
   * `for update` is what makes the read-then-write safe. Two moderators
   * pressing the button at the same moment would otherwise both read the path,
   * both delete the object, and both write a record for one removal. The
   * second now waits here, re-reads after the first commits, finds null, and
   * is told the truth.
   */
  select case p_kind when 'avatar' then p.avatar_path
                     when 'banner' then p.banner_path
                     else p.window_bg_path end,
         p.handle
    into v_path, v_handle
    from public.pilot_profiles p
   where p.user_id = p_user_id
   for update;

  if not found then
    raise exception 'No such profile.' using errcode = 'no_data_found';
  end if;

  if v_path is null then
    raise exception 'That picture has already been removed.' using errcode = 'no_data_found';
  end if;

  update public.pilot_profiles
     set avatar_path    = case when p_kind = 'avatar' then null else avatar_path end,
         banner_path    = case when p_kind = 'banner' then null else banner_path end,
         window_bg_path = case when p_kind = 'window' then null else window_bg_path end
   where user_id = p_user_id;

  -- MARK: the warning, issued in the same transaction
  if p_warn_level is not null then
    if p_block_uploads and p_block_days is not null then
      v_until := now() + make_interval(days => greatest(1, least(p_block_days, 365)));
    end if;

    v_reason := nullif(btrim(coalesce(p_warn_reason, '')), '');
    if v_reason is null then
      -- A warning with no words is a warning nobody can act on. Composed from
      -- what is known rather than left blank.
      v_reason := 'We removed the '
               || case p_kind when 'window' then 'window photo' else p_kind end
               || ' from your profile because it did not meet our '
               || 'safe-for-work rules. Please choose a different picture.';
    end if;

    insert into public.pilot_warnings
      (user_id, level, reason, category, upload_block, upload_block_until, issued_by)
    values
      (p_user_id, p_warn_level, v_reason, nullif(p_category, 'other'),
       coalesce(p_block_uploads, false),
       case when coalesce(p_block_uploads, false) then v_until else null end,
       p_removed_by)
    returning id into v_warning;
  end if;

  insert into public.pilot_content_actions
    (user_id, handle, kind, storage_bucket, storage_path,
     category, note, removed_by, warning_id)
  values
    (p_user_id, v_handle, p_kind, v_bucket, v_path,
     coalesce(p_category, 'other'), nullif(btrim(coalesce(p_note, '')), ''),
     p_removed_by, v_warning)
  returning id into v_action;

  return query select v_bucket, v_path, v_warning, v_action;
end $function$;

create or replace function public.admin_pilot_uploads(p_limit integer DEFAULT 200, p_offset integer DEFAULT 0, p_only_flagged boolean DEFAULT false)
 RETURNS TABLE(user_id uuid, handle text, display_name text, kind text, storage_bucket text, storage_path text, moderation_state text, is_public boolean, autohidden boolean, open_reports integer, prior_takedowns integer, restricted boolean, restricted_until timestamp with time zone, changed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pictures as (
    select p.user_id, p.handle, p.display_name, 'avatar' as kind,
           'pilot-avatars' as bucket, p.avatar_path as path,
           p.moderation_state, p.is_public, p.updated_at
      from public.pilot_profiles p
     where p.avatar_path is not null
    union all
    select p.user_id, p.handle, p.display_name, 'banner',
           'pilot-banners', p.banner_path,
           p.moderation_state, p.is_public, p.updated_at
      from public.pilot_profiles p
     where p.banner_path is not null
    union all
    select p.user_id, p.handle, p.display_name, 'window',
           'pilot-banners', p.window_bg_path,
           p.moderation_state, p.is_public, p.updated_at
      from public.pilot_profiles p
     where p.window_bg_path is not null
  ),
  counted as (
    select
      pic.*,
      public.profile_is_autohidden(pic.user_id) as autohidden,
      (select count(*)::integer from public.profile_reports r
        where r.profile_id = pic.user_id and r.resolved_at is null) as open_reports,
      (select count(*)::integer from public.pilot_content_actions a
        where a.user_id = pic.user_id) as prior_takedowns,
      (select until from public.pilot_upload_restriction(pic.user_id)) as restricted_until,
      exists (select 1 from public.pilot_upload_restriction(pic.user_id)) as restricted
      from pictures pic
  )
  select c.user_id, c.handle, c.display_name, c.kind, c.bucket, c.path,
         c.moderation_state, c.is_public, c.autohidden,
         c.open_reports, c.prior_takedowns,
         c.restricted, c.restricted_until, c.updated_at
    from counted c
   -- "Anything somebody has already flagged" -- reported, auto-hidden, hidden
   -- by a moderator, previously taken down, or currently restricted. The
   -- queue you work when you do not have all day for the whole feed.
   where not p_only_flagged
      or c.open_reports > 0
      or c.autohidden
      or c.moderation_state <> 'ok'
      or c.prior_takedowns > 0
      or c.restricted
   order by c.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

-- MARK: report
select 'window columns' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'pilot_profiles'
                            and column_name = 'window_bg_path')
            then 'ok' else 'MISSING' end as result
union all
select 'pilot_window_style()',
       case when to_regprocedure('public.pilot_window_style(text)') is not null then 'ok' else 'MISSING' end
union all
select 'pilot_flair_usernames()',
       case when to_regprocedure('public.pilot_flair_usernames()') is not null then 'ok' else 'MISSING' end;
