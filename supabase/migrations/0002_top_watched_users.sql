-- =============================================================
-- Top Watched Pilots
--
-- Public, anonymous-readable aggregate of which Infinite Flight
-- usernames appear most often in user watchlists. Returned as a
-- security-definer function so anon callers cannot read raw
-- per-user rows (RLS still protects user_watchlist) but the
-- aggregated leaderboard is available to everyone.
-- =============================================================

create or replace function public.get_top_watched_users(p_limit int default 5)
returns table (
    watched_username text,
    watcher_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        watched_username,
        count(*)::bigint as watcher_count
    from public.user_watchlist
    where watched_username is not null
      and length(trim(watched_username)) > 0
    group by watched_username
    order by watcher_count desc, watched_username asc
    limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

grant execute on function public.get_top_watched_users(int) to anon, authenticated;
