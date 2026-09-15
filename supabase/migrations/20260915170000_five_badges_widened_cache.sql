-- Make the five badges blocked on game facts live: Time Traveler, Early
-- Adopter, Short Stack, The Long Haul, Platform Nomad.
--
-- Unblocked by commit 7977dd4 (20260915153935_game_tags_release_ttb_platforms
-- .sql), which widened game_tags with first_release_date, platform_ids /
-- platform_names, and time_to_beat_normally_seconds /
-- time_to_beat_completely_seconds, then backfilled all 728 existing rows
-- from IGDB. No schema change here — this migration only replaces
-- recompute_my_badges() and backfill_my_badges(); it does not alter any
-- table.
--
-- COVERAGE (measured against this project's live data before writing this
-- migration — see chat self-check for the exact queries):
--   - first_release_date: 79/79 finished-game pairs (100%), 724/728 total
--     rows. Time Traveler needs no coverage caveat.
--   - platform_ids: 79/79 finished-game pairs (100%), 728/728 total rows.
--     Platform Nomad needs no coverage caveat.
--   - time_to_beat_completely_seconds: 53/79 finished-game pairs (67.1%),
--     401/728 total rows. Short Stack and The Long Haul's descriptions
--     (src/data/badges.js) say so explicitly — a user with unfinished
--     coverage should not think the badge is broken.
--   - time_to_beat_normally_seconds (56/79, 70.9%) is NEVER read by either
--     TTB badge — reference-only per the prompt; "completely" is the only
--     flavor that matches "completionist time" in both definitions.
--
-- ── THE 200-HOUR PLAUSIBILITY BOUND (required) ──────────────────────────
-- IGDB's time-to-beat is crowd-sourced and carries the same class of
-- implausible-value problem documented in
-- supabase/functions/themed-drops/pool.ts (TTB_MIN_PLAUSIBLE_SECONDS /
-- TTB_MAX_PLAUSIBLE_SECONDS, 15min-200h): endless/live-service games
-- (Star Citizen: 99,999h completely; League of Legends: 14,452h normally;
-- also WoW, Minecraft, GTA V, CS:GO, Fortnite) carry a "completely" or
-- "normally" figure that is really cumulative playtime or a data-entry
-- sentinel, not a completion time. Of this project's 728 cached rows, 43
-- have either flavor above 200h; scoped to just the completely-seconds
-- column that Short Stack/The Long Haul read, 40 of the 401 non-null rows
-- are excluded (see self-check item 2 for both counts and why they
-- differ). Nine of the 79 finished-game pairs carry one of these
-- implausible values.
--
-- private.plausible_ttb_seconds() below applies the identical bound
-- (900-720000 inclusive, matching pool.ts's constants exactly) to
-- time_to_beat_completely_seconds only, and ONLY for Short Stack / The
-- Long Haul. A value outside that range is treated as UNKNOWN — the same
-- "no recorded time" treatment pool.ts already gives it — never
-- estimated, clamped, or substituted from time_to_beat_normally_seconds.
-- This is why a user who finished GTA V (this project's test account
-- among them: IGDB records 532.9h completely, comfortably would clear The
-- Long Haul's 80h floor) does not get credit for it — see self-check item
-- 3.
--
-- ── FIVE DEFINITIONS (see src/data/badges.js for tiers/descriptions) ────
--   - Time Traveler: distinct release DECADES among completion events
--     (floor(extract(year from first_release_date) / 10)). Tiers 3/5/7.
--   - Early Adopter: games where the EARLIEST of {play_sessions.played_on,
--     reviews.created_at, the completion event's created_at} for that
--     game falls within 30 days (either direction — day precision, per
--     the prompt) of game_tags.first_release_date. Tiers 3/15/40. Scoped
--     to any game the user has a session/review/completion for, not only
--     finished games — "played or reviewed" is broader than Finisher's
--     completion-events-only rule on purpose.
--   - Short Stack: completion events with a plausible
--     time_to_beat_completely_seconds under 5 hours. Tiers 5/20/60.
--   - The Long Haul: completion events with a plausible
--     time_to_beat_completely_seconds over 80 hours. Tiers 1/3/8.
--   - Platform Nomad: distinct platform_ids among completion events.
--     Tiers 3/6/10.
--
-- COST NOTES (measured against this project's live data — see chat
-- self-check for the most expensive of the five):
--   - Time Traveler, Short Stack, The Long Haul, Platform Nomad: each is
--     the same "distinct igdb_game_id from activities, scoped to
--     user_id" subquery already used by Omnivore/Deep Cut, joined once to
--     game_tags (indexed on igdb_game_id, its primary key). Same cost
--     class as those two existing badges.
--   - Early Adopter is the most expensive of the five: a three-way UNION
--     ALL across play_sessions/reviews/activities (each already scoped to
--     `user_id = v_user_id` and index-served — idx_play_sessions_user_game,
--     idx_reviews_user_id, idx_activities_user_id), grouped once to find
--     the earliest timestamp per game, then joined to game_tags. Still a
--     handful of small per-user scans, not a full-table scan of any of the
--     three source tables.

-- ── 1. Plausibility-bound helper (private schema, matches the
--    pool.ts constants exactly) ──────────────────────────────────────────
create or replace function private.plausible_ttb_seconds(p_seconds integer)
returns integer
language sql
immutable
as $$
  -- 15 minutes to 200 hours, in seconds — identical bound to
  -- TTB_MIN_PLAUSIBLE_SECONDS / TTB_MAX_PLAUSIBLE_SECONDS in
  -- supabase/functions/themed-drops/pool.ts. A value outside this range
  -- is IGDB data-entry junk or a live-service/endless-game artifact, not
  -- a real completion time — treated as UNKNOWN (NULL), never clamped or
  -- estimated.
  select case
    when p_seconds is null then null
    when p_seconds < 900 then null       -- 15 * 60
    when p_seconds > 720000 then null    -- 200 * 3600
    else p_seconds
  end;
$$;

comment on function private.plausible_ttb_seconds(integer) is
  'Bounds a game_tags time-to-beat seconds value to 15min-200h, matching pool.ts''s TTB_MIN_PLAUSIBLE_SECONDS/TTB_MAX_PLAUSIBLE_SECONDS exactly. Out-of-range (endless/live-service games, IGDB data-entry sentinels like 99999h) returns NULL — treated as no recorded time, never as a very long game. Used by Short Stack / The Long Haul only; time_to_beat_normally_seconds is never passed through this function because those two badges never read that column.';

-- ── 2. recompute_my_badges() — add five new families ─────────────────────
--
-- Signature UNCHANGED (p_allow_completion_tier_drop boolean default
-- false) — that flag only ever applied to finisher/omnivore and still
-- only applies to those two; none of the five new families read
-- completion-tier-droppable state (Time Traveler/Short Stack/The Long
-- Haul/Platform Nomad DO read completion events for their game set, same
-- as Omnivore, but the prompt did not ask for tier-drop support on these
-- five and none of the existing call sites pass true except the
-- accidental-completion-removal path, which already recomputes
-- everything unconditionally afterward).
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

  -- Wave 3 -> live (20260915120000)
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

  -- Five badges on the widened game_tags cache (this migration)
  v_time_traveler numeric;
  v_early_adopter numeric;
  v_short_stack numeric;
  v_the_long_haul numeric;
  v_platform_nomad numeric;

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

  -- ── WAVE 3 -> LIVE (20260915120000) ──────────────────────────────────
  select count(*) into v_circle
    from public.follows f1
    join public.follows f2
      on f2.follower_id = f1.followee_id
     and f2.followee_id = f1.follower_id
   where f1.follower_id = v_user_id;

  select count(*) into v_conversationalist
    from public.review_comments rc
    join public.reviews r on r.id = rc.review_id
   where rc.user_id = v_user_id
     and length(trim(rc.body)) > 0
     and r.user_id <> v_user_id;

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

  select count(*) into v_curator
    from public.list_saves ls
    join public.lists l on l.id = ls.list_id
   where l.user_id = v_user_id
     and l.is_curated = false
     and ls.user_id <> v_user_id;

  select array_agg(follower_id) into v_follower_ids
    from public.follows where followee_id = v_user_id;

  select public.get_taste_match_batch(v_user_id, v_follower_ids) into v_taste_matches;

  select count(*) into v_tastemaker
    from jsonb_each(coalesce(v_taste_matches, '{}'::jsonb)) as t(follower_id, result)
   where (result->>'score') is not null
     and (result->>'score')::numeric > 70;

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

  select count(*) into v_weekender
    from public.play_sessions
   where user_id = v_user_id
     and played_on is not null
     and extract(dow from played_on) in (0, 6);

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

  -- ── FIVE BADGES ON THE WIDENED CACHE (this migration) ────────────────

  -- Time Traveler: distinct release decades among completion events.
  -- Coverage is 100% for this project's finished games (see migration
  -- header) — no plausibility bound needed, first_release_date has no
  -- equivalent of the time-to-beat sentinel problem.
  select count(distinct floor(extract(year from gt.first_release_date) / 10)) into v_time_traveler
    from (
      select distinct igdb_game_id from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
   where gt.first_release_date is not null;

  -- Early Adopter: games where the EARLIEST user interaction (a logged
  -- session, a review, or the completion event) falls within 30 days
  -- (either direction, day precision) of first_release_date. Deliberately
  -- broader than "finished games" — a session logged on a game still in
  -- Currently Playing still counts, matching "played or reviewed" in the
  -- badge definition, not "finished".
  with earliest_ts as (
    select igdb_game_id, min(ts) as ts
      from (
        select igdb_game_id, played_on::timestamptz as ts
          from public.play_sessions
         where user_id = v_user_id and played_on is not null
        union all
        select igdb_game_id, created_at as ts
          from public.reviews
         where user_id = v_user_id
        union all
        select igdb_game_id, created_at as ts
          from public.activities
         where user_id = v_user_id
           and activity_type = 'status_changed'
           and metadata->>'to_status' = 'played'
      ) t
     group by igdb_game_id
  )
  select count(*) into v_early_adopter
    from earliest_ts e
    join public.game_tags gt on gt.igdb_game_id = e.igdb_game_id
   where gt.first_release_date is not null
     and abs(extract(epoch from (e.ts - gt.first_release_date))) <= 30 * 86400;

  -- Short Stack: completion events with a PLAUSIBLE (15min-200h)
  -- time_to_beat_completely_seconds under 5 hours. Never reads
  -- time_to_beat_normally_seconds.
  select count(*) into v_short_stack
    from (
      select distinct igdb_game_id from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
   where private.plausible_ttb_seconds(gt.time_to_beat_completely_seconds) is not null
     and private.plausible_ttb_seconds(gt.time_to_beat_completely_seconds) < 5 * 3600;

  -- The Long Haul: completion events with a PLAUSIBLE (15min-200h)
  -- time_to_beat_completely_seconds over 80 hours. A game whose only
  -- recorded "completely" time is above the 200h ceiling (Star Citizen's
  -- 99999h, GTA V's 532.9h in this project's own data, etc.) is excluded
  -- here — private.plausible_ttb_seconds() returns NULL for it, so it
  -- can never satisfy the `is not null` check, regardless of how far
  -- above 80h the raw value is.
  select count(*) into v_the_long_haul
    from (
      select distinct igdb_game_id from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
   where private.plausible_ttb_seconds(gt.time_to_beat_completely_seconds) is not null
     and private.plausible_ttb_seconds(gt.time_to_beat_completely_seconds) > 80 * 3600;

  -- Platform Nomad: distinct platform_ids among completion events.
  -- unnest() on a NULL array (a game whose release_platform_fetched_at
  -- ran but returned no platforms is '{}', not NULL — see that column's
  -- comment) already yields zero rows, so no extra NULL guard is needed
  -- beyond mirroring Omnivore's join shape.
  select count(distinct platform) into v_platform_nomad
    from (
      select distinct igdb_game_id from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
    cross join lateral unnest(gt.platform_ids) as platform;

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
      ('deep-cut', v_deep_cut, private.badge_tier_for(v_deep_cut, 3, 12, 35)),
      ('time-traveler', v_time_traveler, private.badge_tier_for(v_time_traveler, 3, 5, 7)),
      ('early-adopter', v_early_adopter, private.badge_tier_for(v_early_adopter, 3, 15, 40)),
      ('short-stack', v_short_stack, private.badge_tier_for(v_short_stack, 5, 20, 60)),
      ('the-long-haul', v_the_long_haul, private.badge_tier_for(v_the_long_haul, 1, 3, 8)),
      ('platform-nomad', v_platform_nomad, private.badge_tier_for(v_platform_nomad, 3, 6, 10))
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

-- ── 3. backfill_my_badges() — a third, silent pass for the five ─────────
--
-- Catalogue version bumps 2 -> 3. Existing users are already at version
-- 0/1/2 depending on when their account was created. Reuses the exact
-- S16-4a mechanism (recompute, then stamp celebrated_at, then bump the
-- version marker) — five badges going live at once for existing users
-- (this project's "gentenstation" test account would jump straight to
-- gold-tier Platform Nomad, for instance) is exactly the celebration-storm
-- risk that mechanism exists to prevent.
--
-- Three starting points, so every existing user lands on version 3 in one
-- call regardless of where they started:
--   - v_version = 0 (never backfilled at all): everything in one pass —
--     unchanged branch from S16-4a.
--   - v_version = 1 (ran the S16-4a pass only): stamp BOTH the eleven
--     Wave-3-to-live families (20260915120000) AND these five — neither
--     pass has run for this user yet.
--   - v_version = 2 (ran both prior passes): stamp only these five.
--   - v_version >= 3: no-op (RPC returns immediately, same short-circuit
--     as before).
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

  -- Already acknowledged this catalogue (original twelve + the eleven +
  -- these five).
  if v_version >= 3 then
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
  elsif v_version = 1 then
    -- Ran the S16-4a pass only — the eleven Wave-3-to-live families AND
    -- these five are both new to this user.
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
             'weekender', 'perfect-month', 'deep-cut',
             'time-traveler', 'early-adopter', 'short-stack',
             'the-long-haul', 'platform-nomad'
           )
        returning ub.badge_id, ub.tier, ub.current_value
      )
      select badge_id, tier, current_value from stamped;
  else
    -- v_version = 2: already ran both prior passes. Only these five are
    -- new this round.
    return query
      with stamped as (
        update public.user_badges ub
           set celebrated_at = now()
         where ub.user_id = v_user_id
           and ub.tier is not null
           and ub.celebrated_at is null
           and ub.badge_id in (
             'time-traveler', 'early-adopter', 'short-stack',
             'the-long-haul', 'platform-nomad'
           )
        returning ub.badge_id, ub.tier, ub.current_value
      )
      select badge_id, tier, current_value from stamped;
  end if;

  update public.users u
     set badge_backfill_version = 3
   where u.id = v_user_id;
end;
$$;

revoke all on function public.backfill_my_badges() from public, anon;
grant execute on function public.backfill_my_badges() to authenticated;

comment on column public.users.badge_backfill_version is
  'Catalogue version of the one-time badge backfill. 0 = never run; 1 = S16-4a Wave 1 + promoted Wave 2 grants persisted with celebrated_at set; 2 = the eleven Wave-3-to-live families (20260915120000) also silently stamped; 3 = the five badges on the widened game_tags cache (this migration: Time Traveler, Early Adopter, Short Stack, The Long Haul, Platform Nomad) also silently stamped. Survives reinstall. Never decremented.';
