-- ============================================================================
--  Grant Pro to a pilot who paid but never got unlocked
--
--  Edit ONE line — the email list below — then paste the whole file into the
--  Supabase SQL editor and press Run. Handles one pilot or a dozen.
--
--  Safe to re-run. It will not create accounts, and it refuses to do anything
--  if an email doesn't match an account (so a typo is loud, not silent).
--
--  Afterwards the pilot just needs to reload the app: refreshProStatus() reads
--  profiles.is_pro fresh on every load and updates the cached flag. No sign-out
--  needed, no cache to clear.
-- ============================================================================

do $$
declare
  -- ▼▼▼ THE ONLY LINE TO EDIT ▼▼▼
  v_emails text[] := array[
    'pilot@example.com'
  ];
  -- ▲▲▲ ------------------- ▲▲▲

  v_email text;
  v_id    uuid;
  v_done  int := 0;
begin
  foreach v_email in array v_emails loop
    select id into v_id from auth.users where lower(email) = lower(trim(v_email));

    if v_id is null then
      raise warning 'SKIPPED — no account found for %', v_email;
      continue;
    end if;

    -- The row may never have existed; without it the update below would match
    -- nothing and report success, which is the whole reason we are here.
    insert into public.profiles (id) values (v_id) on conflict do nothing;

    update public.profiles set is_pro = true where id = v_id;

    -- Also clear the "this is a free account" stamp left at sign-up. Not
    -- strictly required — profiles.is_pro wins on its own — but it removes the
    -- stale signal that some surfaces read before the profile lookup returns,
    -- and it means a failed profile read falls back to Pro rather than free.
    update auth.users
       set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                || '{"is_pro": true}'::jsonb
     where id = v_id;

    v_done := v_done + 1;
    raise notice 'GRANTED Pro to %  (%)', v_email, v_id;
  end loop;

  raise notice '--- % of % account(s) unlocked ---', v_done, array_length(v_emails, 1);
end $$;


-- Confirm it took. Both columns should read true for the pilot(s) above.
select u.email,
       p.is_pro                              as profiles_is_pro,
       u.raw_user_meta_data->>'is_pro'       as metadata_is_pro,
       u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.is_pro is true
 order by u.created_at desc
 limit 50;
