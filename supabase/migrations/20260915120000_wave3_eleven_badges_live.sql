-- Make the eleven deferred Wave 3 badges live: Circle, Conversationalist,
-- First Responder, Curator, Tastemaker, Year's Work, Comeback, Veteran,
-- Weekender, Perfect Month, Deep Cut.
--
-- A read-only diagnosis (see chat report) confirmed all eleven are
-- computable TODAY from existing tables — no schema change, no new
-- column, no new write path. This migration only replaces two existing
-- functions (recompute_my_badges, backfill_my_badges); it does not
-- alter any table.
--
-- WHAT THE DIAGNOSIS CORRECTED (carried over verbatim from the prompt,
-- not re-derived here):
--   - Conversationalist must read the LIVE `review_comments` table, not
--     the dead `comments` table (0 rows, unused by commentService.js).
--   - Deep Cut must read `game_tags.total_rating_count` (79/79 finished
--     games in this project have a row), not
--     drop_candidate_pool.popularity_* (Drops-pool-scoped, incomplete).
--   - Weekender and Perfect Month are NOT blocked by the noon-UTC
--     session-clock bug — both read `play_sessions.played_on` (a plain
--     date), never `started_at`.
--   - Session badges must never read `activities` for counts:
--     `ensureActivityForDay` inserts activity_type='session_logged',
--     which the activities_activity_type_check constraint rejects —
--     those rows never exist. All eleven below that touch sessions read
--     `play_sessions` directly.
--
-- ── 1. recompute_my_badges() — add eleven new families ──────────────────
--
-- Signature UNCHANGED from 20260914210000_allow_completion_tier_drop.sql
-- (p_allow_completion_tier_drop boolean default false) — that flag only
-- ever applied to finisher/omnivore and still only applies to those two;
-- none of the eleven new families read completion-tier-droppable state.
--
-- COST NOTES (measured against this project's live data — see chat
-- self-check for EXPLAIN ANALYZE output):
--   - Circle, Comeback, Deep Cut, Weekender, Perfect Month, Year's Work,
--     Curator: single indexed scan(s) scoped to user_id = v_user_id,
--     same shape/cost class as the existing twelve. Sub-millisecond on
--     this project's data; still cheap at realistic personal-history
--     scale (a few thousand rows per table for a power user).
--   - Veteran: bounded by `greatest(0, full account years)` — at most a
--     handful of EXISTS probes against play_sessions per user, each
--     scoped to user_id. Cheap.
--   - Conversationalist / First Responder: the two that touch
--     review_comments. Conversationalist is a single indexed join
--     scoped to `rc.user_id = v_user_id`. First Responder is the most
--     expensive of the eleven — see the comment directly above its
--     query below for why, and how it is scoped to avoid a full-table
--     scan of review_comments.
--   - Tastemaker: cost is bounded by the user's FOLLOWER COUNT (one
--     get_taste_match() call per follower via the existing
--     get_taste_match_batch()), not by history size. Each call is a
--     small jsonb_each_text join over genre_weights (a handful of
--     keys). Fine at normal follower counts; a user with an unusually
--     large follower count (thousands) would see this scale linearly —
--     flagged, not solved, here, since this project's data has single
--     digit followers per user.
create or replace function public.recompute_my_badges(p_allow_completion_tier_drop boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_timekeeper numeric;
  v_marathoner numeric;
  v_devoted numeric;
  v_critic numeric;
  v_chronicler numeric;
  v_finisher numeric;
  v_kept_the_fire numeric;
  v_honest numeric;
  v_full_picture numeric;
  v_omnivore numeric;
  v_regular numeric;
  v_resonant numeric;

  -- Wave 3 -> live (this migration)
  v_circle numeric;
  v_conversationalist numeric;
  v_first_responder numeric;
  v_curator numeric;
  v_tastemaker numeric;
  v_years_work numeric;
  v_comeback numeric;
  v_veteran numeric;
  v_weekender numeric;
  v_perfect_month numeric;
  v_deep_cut numeric;

  v_created_at timestamptz;
  v_full_years int;
  v_follower_ids uuid[];
  v_taste_matches jsonb;
begin
  if v_user_id is null then
    raise exception 'recompute_my_badges requires an authenticated user';
  end if;

  -- WAVE 1 -------------------------------------------------------------
  select count(*) into v_timekeeper
    from public.play_sessions where user_id = v_user_id;

  select coalesce(max(hours), 0) into v_marathoner
    from public.play_sessions where user_id = v_user_id;

  select coalesce(max(hours_played), 0) into v_devoted
    from public.game_trackers where user_id = v_user_id;

  select count(*) into v_critic
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  select count(*) into v_chronicler
    from public.journal_entries
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  select count(distinct igdb_game_id) into v_finisher
    from public.activities
    where user_id = v_user_id
      and activity_type = 'status_changed'
      and metadata->>'to_status' = 'played';

  select coalesce(highest_streak_milestone, 0) into v_kept_the_fire
    from public.users where id = v_user_id;

  -- WAVE 2 ---------------------------------------------------------------
  select count(*) into v_honest
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0
      and rating < 3;

  select count(*) into v_full_picture
    from public.journal_entries
    where user_id = v_user_id
      and mood is not null and hours_played is not null
      and body is not null and length(trim(body)) > 0;

  select count(distinct genre) into v_omnivore
    from (
      select distinct a.igdb_game_id
      from public.activities a
      where a.user_id = v_user_id
        and a.activity_type = 'status_changed'
        and a.metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
    cross join lateral unnest(gt.genre_names) as genre;

  select count(distinct date_trunc('month', played_on)) into v_regular
    from public.play_sessions
    where user_id = v_user_id and played_on is not null;

  select count(*) into v_resonant
    from public.review_likes rl
    join public.reviews r on r.id = rl.review_id
    where r.user_id = v_user_id;

  -- ── WAVE 3 -> LIVE (this migration) ──────────────────────────────────

  -- Circle: mutual follows. Self-join on the (follower_id, followee_id)
  -- primary key — both legs are index-served.
  select count(*) into v_circle
    from public.follows f1
    join public.follows f2
      on f2.follower_id = f1.followee_id
     and f2.followee_id = f1.follower_id
   where f1.follower_id = v_user_id;

  -- Conversationalist: comments YOU left on OTHER PEOPLE'S reviews.
  -- Scoped to review_id (not activity_event_id) on purpose — the
  -- family name and description are specifically "reviews", and
  -- review_comments is polymorphic (it also carries pulse/activity-event
  -- comments). Excludes comments on your own review via the join
  -- predicate rather than a post-filter.
  select count(*) into v_conversationalist
    from public.review_comments rc
    join public.reviews r on r.id = rc.review_id
   where rc.user_id = v_user_id
     and length(trim(rc.body)) > 0
     and r.user_id <> v_user_id;

  -- First Responder: first comment (by created_at) on a review OR a
  -- pulse item (activity_event), excluding your own targets. Naively
  -- this needs "the earliest comment per target, across the WHOLE
  -- table" — a full scan of review_comments for every user's recompute.
  -- Scoped down instead to only the targets YOU have ever commented on
  -- (a small, per-user set) via the `target_id in (select ... where
  -- user_id = v_user_id)` filters below, then ranks comments only
  -- within that set. This is still the most expensive of the eleven
  -- (a window function over however many comments exist on your
  -- targets, vs. every other badge's flat indexed count) — see the
  -- chat self-check for a measured EXPLAIN ANALYZE.
  with my_targets as (
    select distinct review_id, activity_event_id
      from public.review_comments
     where user_id = v_user_id
  ),
  ranked as (
    select
      rc.review_id,
      rc.activity_event_id,
      rc.user_id,
      row_number() over (
        partition by rc.review_id, rc.activity_event_id
        order by rc.created_at asc
      ) as rn
    from public.review_comments rc
    where (rc.review_id is not null and rc.review_id in (select review_id from my_targets where review_id is not null))
       or (rc.activity_event_id is not null and rc.activity_event_id in (select activity_event_id from my_targets where activity_event_id is not null))
  )
  select count(*) into v_first_responder
    from ranked
    left join public.reviews r on r.id = ranked.review_id
    left join public.activity_events ae on ae.id = ranked.activity_event_id
   where ranked.rn = 1
     and ranked.user_id = v_user_id
     and coalesce(r.user_id, ae.actor_user_id) <> v_user_id;

  -- Curator: saves on lists YOU created, excluding app-curated lists and
  -- self-saves.
  select count(*) into v_curator
    from public.list_saves ls
    join public.lists l on l.id = ls.list_id
   where l.user_id = v_user_id
     and l.is_curated = false
     and ls.user_id <> v_user_id;

  -- Tastemaker: followers whose taste match with you is ABOVE 70%.
  -- Reuses get_taste_match_batch() (the same function ProfileTasteDNA /
  -- rivalry surfaces already call) rather than a new similarity
  -- function. A follower with no taste vector (or too little signal)
  -- comes back with score = null from get_taste_match() and is
  -- excluded by the `is not null` check — never defaulted to a pass.
  select array_agg(follower_id) into v_follower_ids
    from public.follows where followee_id = v_user_id;

  select public.get_taste_match_batch(v_user_id, v_follower_ids) into v_taste_matches;

  select count(*) into v_tastemaker
    from jsonb_each(coalesce(v_taste_matches, '{}'::jsonb)) as t(follower_id, result)
   where (result->>'score') is not null
     and (result->>'score')::numeric > 70;

  -- Year's Work: annual challenges completed, lifetime. Per user_goals
  -- row, reconstruct the ORIGINAL tier-1 target from
  -- `target - (tier - 1) * TIER_INCREMENT` (TIER_INCREMENT = 15, per
  -- goalService.js) and compare against a live recount of that year's
  -- distinct finished games — the same activities-based count
  -- goalService.js's countFinishedThisYear() uses. Chosen over
  -- goal_reached_at/the tier column alone because goal_reached_at is
  -- only stamped by a client-side call (getGoalProgress) that may not
  -- have run yet for a given year, and this recount is self-consistent
  -- regardless of whether that client call ever fired. A row whose tier
  -- has already escalated past 1 will also satisfy this recount by
  -- construction (escalation only ever happens after the prior target
  -- was met), so this one formula covers both "still on tier 1" and
  -- "already escalated" rows without a branch.
  select count(*) into v_years_work
    from public.user_goals g
   where g.user_id = v_user_id
     and (
       select count(distinct a.igdb_game_id)
         from public.activities a
        where a.user_id = v_user_id
          and a.activity_type = 'status_changed'
          and a.metadata->>'to_status' = 'played'
          and extract(year from a.created_at) = g.year
     ) >= (g.target - (g.tier - 1) * 15);

  -- Comeback: distinct games dropped, then later marked played again.
  select count(distinct d.igdb_game_id) into v_comeback
    from (
      select igdb_game_id, created_at
        from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'dropped'
    ) d
    join (
      select igdb_game_id, created_at
        from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) p
      on p.igdb_game_id = d.igdb_game_id
     and p.created_at > d.created_at;

  -- Veteran: account age in full years (anchored on users.created_at),
  -- counted only for account-anniversary years with >= 1 logged session
  -- (play_sessions.played_on). A year with zero activity does not
  -- count, and no calendar year before the account's first year is
  -- considered.
  select created_at into v_created_at from public.users where id = v_user_id;
  v_full_years := greatest(0, floor(extract(epoch from (now() - v_created_at)) / (365.25 * 86400))::int);

  select count(*) into v_veteran
    from generate_series(1, v_full_years) as year_num
   where exists (
     select 1 from public.play_sessions ps
      where ps.user_id = v_user_id
        and ps.played_on is not null
        and ps.played_on >= (v_created_at + ((year_num - 1) * interval '1 year'))::date
        and ps.played_on <  (v_created_at + (year_num * interval '1 year'))::date
   );

  -- Weekender: sessions logged on a Saturday or Sunday, by played_on
  -- (never started_at — see the noon-UTC note at the top of this file).
  -- Rows with played_on null (the live-timer path) are excluded — see
  -- chat self-check for how many that is on this project's data.
  select count(*) into v_weekender
    from public.play_sessions
   where user_id = v_user_id
     and played_on is not null
     and extract(dow from played_on) in (0, 6);

  -- Perfect Month: calendar months where a session was logged on every
  -- single day of that month.
  select count(*) into v_perfect_month
    from (
      select date_trunc('month', played_on) as month,
             count(distinct played_on) as days_logged,
             extract(day from (date_trunc('month', played_on) + interval '1 month' - interval '1 day'))::int as days_in_month
        from public.play_sessions
       where user_id = v_user_id and played_on is not null
       group by date_trunc('month', played_on)
    ) months
   where days_logged = days_in_month;

  -- Deep Cut: finished games with a low (or absent) IGDB rating count.
  -- NULL total_rating_count (no game_tags row cached at all) is treated
  -- as qualifying — an uncached game is, if anything, MORE obscure, not
  -- less, so defaulting it to "does not qualify" would be the wrong
  -- direction of error.
  select count(*) into v_deep_cut
    from (
      select distinct a.igdb_game_id
        from public.activities a
       where a.user_id = v_user_id
         and a.activity_type = 'status_changed'
         and a.metadata->>'to_status' = 'played'
    ) finished
    left join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
   where gt.total_rating_count is null or gt.total_rating_count < 50;

  -- Upsert every computed badge. Tier is monotonic (GREATEST by rank) —
  -- current_value always reflects the live count, but a tier already
  -- reached can never be taken away by a later drop in the raw count
  -- (finisher/omnivore excepted, via p_allow_completion_tier_drop).
  with computed(badge_id, value, new_tier) as (
    values
      ('timekeeper', v_timekeeper, private.badge_tier_for(v_timekeeper, 25, 150, 500)),
      ('marathoner', v_marathoner, private.badge_tier_for(v_marathoner, 4, 8, 12)),
      ('devoted', v_devoted, private.badge_tier_for(v_devoted, 50, 150, 400)),
      ('critic', v_critic, private.badge_tier_for(v_critic, 10, 50, 200)),
      ('chronicler', v_chronicler, private.badge_tier_for(v_chronicler, 15, 75, 250)),
      ('finisher', v_finisher, private.badge_tier_for(v_finisher, 10, 50, 150)),
      ('kept-the-fire', v_kept_the_fire, private.badge_tier_for(v_kept_the_fire, 7, 30, 100)),
      ('honest', v_honest, private.badge_tier_for(v_honest, 5, 20, 60)),
      ('full-picture', v_full_picture, private.badge_tier_for(v_full_picture, 10, 50, 150)),
      ('omnivore', v_omnivore, private.badge_tier_for(v_omnivore, 5, 12, 20)),
      ('regular', v_regular, private.badge_tier_for(v_regular, 3, 12, 24)),
      ('resonant', v_resonant, private.badge_tier_for(v_resonant, 25, 150, 500)),
      ('circle', v_circle, private.badge_tier_for(v_circle, 3, 15, 50)),
      ('conversationalist', v_conversationalist, private.badge_tier_for(v_conversationalist, 10, 50, 200)),
      ('first-responder', v_first_responder, private.badge_tier_for(v_first_responder, 5, 25, 100)),
      ('curator', v_curator, private.badge_tier_for(v_curator, 5, 25, 100)),
      ('tastemaker', v_tastemaker, private.badge_tier_for(v_tastemaker, 3, 15, 50)),
      ('years-work', v_years_work, private.badge_tier_for(v_years_work, 1, 2, 3)),
      ('comeback', v_comeback, private.badge_tier_for(v_comeback, 1, 5, 15)),
      ('veteran', v_veteran, private.badge_tier_for(v_veteran, 1, 2, 3)),
      ('weekender', v_weekender, private.badge_tier_for(v_weekender, 10, 50, 150)),
      ('perfect-month', v_perfect_month, private.badge_tier_for(v_perfect_month, 1, 3, 12)),
      ('deep-cut', v_deep_cut, private.badge_tier_for(v_deep_cut, 3, 12, 35))
  )
  insert into public.user_badges (user_id, badge_id, tier, current_value, earned_at)
  select v_user_id, badge_id, new_tier, value, now()
  from computed
  on conflict (user_id, badge_id) do update
    set current_value = excluded.current_value,
        tier = case
          when p_allow_completion_tier_drop
            and public.user_badges.badge_id in ('finisher', 'omnivore')
            then excluded.tier
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then excluded.tier
          else public.user_badges.tier
        end,
        earned_at = case
          when p_allow_completion_tier_drop
            and public.user_badges.badge_id in ('finisher', 'omnivore')
            then case
              when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
                then now()
              else public.user_badges.earned_at
            end
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then now()
          else public.user_badges.earned_at
        end;
end;
$$;

revoke all on function public.recompute_my_badges(boolean) from public, anon;
grant execute on function public.recompute_my_badges(boolean) to authenticated;

-- ── 2. backfill_my_badges() — a second, silent pass for the eleven ──────
--
-- Catalogue version bumps 1 -> 2. Existing users are already at version
-- 1 (S16-4a: Wave 1 + promoted Wave 2). This function now runs a SECOND
-- silent pass for exactly the eleven newly-live families so a user who
-- already qualifies for one of them (e.g. this project's test account
-- already has a Comeback pair) does not get a celebration storm on next
-- launch — it reuses the exact same mechanism (recompute, then stamp
-- celebrated_at, then bump the version marker) rather than introducing
-- a new one.
--
-- Version-0 users (never backfilled at all) still get everything in one
-- pass, same as before this migration.
--
-- Deliberately does NOT re-stamp every tiered family for a version-1
-- user — only the eleven new ones. A version-1 user who has a genuinely
-- new, not-yet-celebrated tier-up on one of the ORIGINAL twelve (earned
-- through normal play since their last backfill, simply not opened the
-- app to see the toast yet) must still get that celebration from
-- useBadgeUnlockWatcher; sweeping it into this silent pass would
-- swallow it.
--
-- RETURN QUERY now returns only the rows THIS call's UPDATE actually
-- stamped (via a data-modifying CTE + RETURNING), not every tiered
-- family the user has ever earned. Returning everything (the original
-- v1 behavior, only ever exercised once per user) would otherwise make
-- BadgeBackfillSummary re-show a version-1 user's already-seen bronze
-- Timekeeper etc. as if newly granted during the version-2 pass.
drop function if exists public.backfill_my_badges();

create or replace function public.backfill_my_badges()
returns table(family_id text, granted_tier text, metric_value numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_version integer;
begin
  if v_user_id is null then
    raise exception 'backfill_my_badges requires an authenticated user';
  end if;

  select coalesce(u.badge_backfill_version, 0) into v_version
    from public.users u
   where u.id = v_user_id;

  -- Already acknowledged this catalogue (original twelve + these eleven).
  if v_version >= 2 then
    return;
  end if;

  -- Compute current earned tiers via the unchanged (this migration's)
  -- recompute_my_badges().
  perform public.recompute_my_badges();

  if v_version = 0 then
    -- Never backfilled at all — everything earned is new to this user.
    return query
      with stamped as (
        update public.user_badges ub
           set celebrated_at = now()
         where ub.user_id = v_user_id
           and ub.tier is not null
           and ub.celebrated_at is null
        returning ub.badge_id, ub.tier, ub.current_value
      )
      select badge_id, tier, current_value from stamped;
  else
    -- v_version = 1: already ran the S16-4a pass for the original
    -- twelve. Only these eleven are new this round.
    return query
      with stamped as (
        update public.user_badges ub
           set celebrated_at = now()
         where ub.user_id = v_user_id
           and ub.tier is not null
           and ub.celebrated_at is null
           and ub.badge_id in (
             'circle', 'conversationalist', 'first-responder', 'curator',
             'tastemaker', 'years-work', 'comeback', 'veteran',
             'weekender', 'perfect-month', 'deep-cut'
           )
        returning ub.badge_id, ub.tier, ub.current_value
      )
      select badge_id, tier, current_value from stamped;
  end if;

  update public.users u
     set badge_backfill_version = 2
   where u.id = v_user_id;
end;
$$;

revoke all on function public.backfill_my_badges() from public, anon;
grant execute on function public.backfill_my_badges() to authenticated;

comment on column public.users.badge_backfill_version is
  'Catalogue version of the one-time badge backfill. 0 = never run; 1 = S16-4a Wave 1 + promoted Wave 2 grants persisted with celebrated_at set; 2 = the eleven Wave-3-to-live families (this migration) also silently stamped. Survives reinstall. Never decremented.';
