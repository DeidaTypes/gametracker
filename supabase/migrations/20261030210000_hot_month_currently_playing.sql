-- Hot Month: only games that were in Currently Playing count (Ry, Oct 30 2026).
-- Follows 20261030200000_thirty_new_badges.sql.
--
-- WHY: marking old favorites Played (onboarding, or logging history) put 5+
-- finishes in one month on day one, so a Hard badge came free. Now a finish
-- counts toward Hot Month only if that game was set to Currently Playing
-- before it was finished.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL Editor and press Run
-- once. One transaction. A guard checks the live recompute_my_badges() is the
-- 30-badge version; if not it STOPS and changes nothing. Re-running is safe.
--
-- WHAT IT DOES
--   1. Replaces recompute_my_badges() with the same function, only the Hot
--      Month query changed. Signature, grants and every other badge identical.
--   2. Clears every Hot Month row once (tier, celebrated_at; value 0) so it is
--      worked out again under the new rule. Pre-launch correction of a badge
--      that should not have been granted. Anyone who still qualifies earns it
--      again on their next recompute (and sees it unlock).
--   3. Runs the new recompute as theantifail inside the transaction.
--   4. Last grid: theantifail's Hot Month row. Send it to Claude.

begin;

do $guard$
declare
  v_def text;
  v_tier_rows int;
  v_single_rows int;
begin
  select p.prosrc into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_my_badges';
  if v_def is null then
    raise exception 'STOP (nothing was changed): recompute_my_badges() not found. Send Claude this message.';
  end if;
  select count(*) into v_tier_rows
    from regexp_matches(v_def, '\(''[a-z-]+'', v_[a-z_]+, private\.badge_tier_for\(', 'g');
  select count(*) into v_single_rows
    from regexp_matches(v_def, 'private\.badge_single_tier\(v_', 'g');
  if v_tier_rows <> 28 or v_single_rows <> 30 then
    raise exception 'STOP (nothing was changed): recompute_my_badges() has % tiered and % one-step rows, expected 28 and 30. Run 20261030200000 first, or send Claude this message.', v_tier_rows, v_single_rows;
  end if;
  if position('-- Hot Month: most games finished in one calendar month, each game' in v_def) = 0
     and position('-- Hot Month (patched 20261030210000)' in v_def) = 0 then
    raise exception 'STOP (nothing was changed): the Hot Month query on the server is not the one Claude expects. Send Claude this message.';
  end if;
end;
$guard$;

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

  -- Thirty new badges (20261030200000). Values that several badges share
  -- (library size, finishes, sessions, reviews with words, diary notes)
  -- reuse the variables above instead of re-querying.
  v_library_count numeric;
  v_top_four numeric;
  v_now_playing numeric;
  v_quick_judge numeric;
  v_mixtape numeric;
  v_party_up numeric;
  v_hat_trick numeric;
  v_speedrun numeric;
  v_off_the_shelf numeric;
  v_fan_mail numeric;
  v_good_vibes numeric;
  v_lifeline numeric;
  v_second_opinion numeric;
  v_window_shopper numeric;
  v_defend_your_picks numeric;
  v_list_cleared numeric;
  v_hot_month numeric;
  v_specialist numeric;
  v_kindred_spirit numeric;
  v_century numeric;
  v_fan_favorite numeric;
  v_report_card numeric;
  v_retro_run numeric;
  v_squad_goals numeric;
  v_followee_ids uuid[];
  v_followee_matches jsonb;
  -- The heart a Pulse post carries (EVENT_REACTION_EMOJI / ACTIVITY_LIKE_EMOJI
  -- in the client), plus the bare glyph some older rows may hold.
  v_hearts text[] := array[E'\u2764\uFE0F', E'\u2764'];

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

  -- ── THIRTY NEW BADGES (20261030200000) ───────────────────────────────
  -- One-step badges: earned (tier = 'bronze', the only tier they use) the
  -- moment the value reaches the target, via private.badge_single_tier().
  -- Same rules as every family above: completions come from completion
  -- events (activities to_status = 'played'), never from tracker status;
  -- a badge once earned is never taken away.

  -- Library size: Press Start (1), Starter Pack (5), Century Club (100).
  select count(*) into v_library_count
    from public.game_trackers where user_id = v_user_id;

  -- Top Four: favorites picked (4).
  select coalesce(jsonb_array_length(
           case when jsonb_typeof(u.favorite_games) = 'array' then u.favorite_games end), 0)
    into v_top_four
    from public.users u where u.id = v_user_id;

  -- Now Playing: games ever set to Currently Playing (1).
  select count(distinct igdb_game_id) into v_now_playing
    from public.activities
   where user_id = v_user_id
     and activity_type = 'status_changed'
     and metadata->>'to_status' = 'currently';

  -- Quick Judge: games rated with stars (5).
  select count(distinct igdb_game_id) into v_quick_judge
    from public.reviews
   where user_id = v_user_id and rating is not null and rating > 0;

  -- Mixtape: the most games on one list you own (3).
  select coalesce(max(n), 0) into v_mixtape
    from (
      select count(*) as n
        from public.list_games lg
        join public.lists l on l.id = lg.list_id
       where l.user_id = v_user_id
       group by lg.list_id
    ) t;

  -- Party Up: people you follow (3). Squad Goals: people following you (25).
  select count(*) into v_party_up
    from public.follows where follower_id = v_user_id;
  select count(*) into v_squad_goals
    from public.follows where followee_id = v_user_id;

  -- Hat Trick: most distinct session days in one Monday-to-Sunday week (3).
  select coalesce(max(days), 0) into v_hat_trick
    from (
      select count(distinct played_on) as days
        from public.play_sessions
       where user_id = v_user_id and played_on is not null
       group by date_trunc('week', played_on)
    ) t;

  -- Speedrun: games finished within 7 days of being set to Currently
  -- Playing (1).
  select count(distinct p.igdb_game_id) into v_speedrun
    from public.activities p
    join public.activities s
      on s.user_id = p.user_id
     and s.igdb_game_id = p.igdb_game_id
     and s.activity_type = 'status_changed'
     and s.metadata->>'to_status' = 'currently'
     and s.created_at < p.created_at
     and p.created_at - s.created_at <= interval '7 days'
   where p.user_id = v_user_id
     and p.activity_type = 'status_changed'
     and p.metadata->>'to_status' = 'played';

  -- Off the Shelf: a game that went into the Backlog, stayed there for 14+
  -- days (no other status change for it inside those 14 days), then was
  -- finished (1). Backlog entries come from both write paths: the status
  -- log (to_status = 'want') and the quick-add 'backlogged' event, which
  -- skips the status log.
  with backlogged as (
    select igdb_game_id::text as game, created_at
      from public.activities
     where user_id = v_user_id
       and activity_type = 'status_changed'
       and metadata->>'to_status' = 'want'
    union all
    select entity_id as game, created_at
      from public.activity_events
     where actor_user_id = v_user_id
       and type = 'backlogged'
       and entity_id is not null
  )
  select count(distinct p.igdb_game_id) into v_off_the_shelf
    from public.activities p
    join backlogged b
      on b.game = p.igdb_game_id::text
     and p.created_at >= b.created_at + interval '14 days'
   where p.user_id = v_user_id
     and p.activity_type = 'status_changed'
     and p.metadata->>'to_status' = 'played'
     and not exists (
       select 1 from public.activities x
        where x.user_id = v_user_id
          and x.igdb_game_id::text = b.game
          and x.activity_type = 'status_changed'
          and x.metadata->>'to_status' <> 'want'
          and x.created_at > b.created_at
          and x.created_at < b.created_at + interval '14 days'
     );

  -- Fan Mail: hearts other players gave your reviews and your Pulse posts
  -- (finishes, lists, starts...) and any list-level hearts (10).
  select
      (select count(*)
         from public.review_likes rl
         join public.reviews r on r.id = rl.review_id
        where r.user_id = v_user_id and rl.user_id <> v_user_id)
    + (select count(*)
         from public.activity_events ae
         join public.reactions rx
           on rx.target_type = 'activity' and rx.target_id = ae.id::text
        where ae.actor_user_id = v_user_id
          and rx.user_id <> v_user_id
          and rx.emoji = any(v_hearts))
    + (select count(*)
         from public.lists l
         join public.reactions rx
           on rx.target_type = 'list' and rx.target_id = l.id::text
        where l.user_id = v_user_id
          and rx.user_id <> v_user_id
          and rx.emoji = any(v_hearts))
    into v_fan_mail;

  -- Good Vibes: hearts you gave other players, same three places (25).
  select
      (select count(*)
         from public.review_likes rl
         join public.reviews r on r.id = rl.review_id
        where rl.user_id = v_user_id and r.user_id <> v_user_id)
    + (select count(*)
         from public.reactions rx
         join public.activity_events ae on ae.id::text = rx.target_id
        where rx.user_id = v_user_id
          and rx.target_type = 'activity'
          and ae.actor_user_id <> v_user_id
          and rx.emoji = any(v_hearts))
    + (select count(*)
         from public.reactions rx
         join public.lists l on l.id::text = rx.target_id
        where rx.user_id = v_user_id
          and rx.target_type = 'list'
          and l.user_id <> v_user_id
          and rx.emoji = any(v_hearts))
    into v_good_vibes;

  -- Lifeline: Q&A answers you wrote on other players' questions and that
  -- were not removed (3).
  select count(*) into v_lifeline
    from public.qa_answers a
    join public.qa_questions q on q.id = a.question_id
   where a.user_id = v_user_id
     and a.removed_at is null
     and q.user_id is distinct from v_user_id;

  -- Second Opinion: a review with words on a game someone you follow had
  -- already reviewed (1).
  select count(distinct mine.igdb_game_id) into v_second_opinion
    from public.reviews mine
   where mine.user_id = v_user_id
     and mine.body is not null and length(trim(mine.body)) > 0
     and exists (
       select 1
         from public.reviews theirs
         join public.follows f
           on f.followee_id = theirs.user_id
          and f.follower_id = v_user_id
        where theirs.igdb_game_id = mine.igdb_game_id
          and theirs.user_id <> v_user_id
          and theirs.created_at < mine.created_at
     );

  -- Window Shopper: distinct games swiped in Discover (50). One row per
  -- game in user_swipe_signals (the server mirror of the swipe deck).
  select count(*) into v_window_shopper
    from public.user_swipe_signals where user_id = v_user_id;

  -- Defend Your Picks: how many of your favorites you reviewed with words
  -- (4 = all of them).
  select count(*) into v_defend_your_picks
    from (
      select distinct fav->>'id' as game_id
        from public.users u
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(u.favorite_games) = 'array'
               then u.favorite_games else '[]'::jsonb end
        ) as fav
       where u.id = v_user_id
         and fav->>'id' is not null
    ) f
   where exists (
     select 1 from public.reviews r
      where r.user_id = v_user_id
        and r.igdb_game_id::text = f.game_id
        and r.body is not null and length(trim(r.body)) > 0
   );

  -- List Cleared: lists you own with 5+ games where every game has a
  -- completion event (1).
  select count(*) into v_list_cleared
    from (
      select lg.list_id,
             count(*) as total,
             count(*) filter (where exists (
               select 1 from public.activities a
                where a.user_id = v_user_id
                  and a.igdb_game_id = lg.igdb_game_id
                  and a.activity_type = 'status_changed'
                  and a.metadata->>'to_status' = 'played'
             )) as done
        from public.list_games lg
        join public.lists l on l.id = lg.list_id
       where l.user_id = v_user_id
       group by lg.list_id
    ) t
   where t.total >= 5 and t.done = t.total;

  -- Hot Month (patched 20261030210000): most games finished in one
  -- calendar month, counting only games that were in Currently Playing
  -- before that finish. Games logged as already finished (old favorites,
  -- onboarding) still count for Credits Roll / Specialist / Retro Run,
  -- not here. Each game once, in the month of its first such finish (5).
  -- Months are UTC.
  select coalesce(max(n), 0) into v_hot_month
    from (
      select count(*) as n
        from (
          select p.igdb_game_id, min(p.created_at) as first_done
            from public.activities p
           where p.user_id = v_user_id
             and p.activity_type = 'status_changed'
             and p.metadata->>'to_status' = 'played'
             and exists (
               select 1 from public.activities s
                where s.user_id = v_user_id
                  and s.igdb_game_id = p.igdb_game_id
                  and s.activity_type = 'status_changed'
                  and s.metadata->>'to_status' = 'currently'
                  and s.created_at < p.created_at
             )
           group by p.igdb_game_id
        ) f
       group by date_trunc('month', f.first_done)
    ) t;

  -- Specialist: most finished games in one genre (10).
  select coalesce(max(n), 0) into v_specialist
    from (
      select genre, count(distinct finished.igdb_game_id) as n
        from (
          select distinct igdb_game_id from public.activities
           where user_id = v_user_id
             and activity_type = 'status_changed'
             and metadata->>'to_status' = 'played'
        ) finished
        join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
        cross join lateral unnest(gt.genre_names) as genre
       group by genre
    ) t;

  -- Kindred Spirit: best taste match with someone you follow (90). Same
  -- engine and score field Tastemaker reads above.
  select array_agg(followee_id) into v_followee_ids
    from public.follows where follower_id = v_user_id;

  select public.get_taste_match_batch(v_user_id, v_followee_ids) into v_followee_matches;

  select coalesce(max((result->>'score')::numeric), 0) into v_kindred_spirit
    from jsonb_each(coalesce(v_followee_matches, '{}'::jsonb)) as t(followee_id, result)
   where jsonb_typeof(result) = 'object'
     and (result->>'score') is not null;

  -- Century: total hours across all logged sessions (100).
  select coalesce(sum(hours), 0) into v_century
    from public.play_sessions where user_id = v_user_id;

  -- Fan Favorite: most hearts other players gave one of your reviews (25).
  select coalesce(max(n), 0) into v_fan_favorite
    from (
      select count(*) as n
        from public.review_likes rl
        join public.reviews r on r.id = rl.review_id
       where r.user_id = v_user_id and rl.user_id <> v_user_id
       group by rl.review_id
    ) t;

  -- Report Card: a calendar year (UTC, by first finish) with 12+ finished
  -- games where every one has your star rating (12). The value shown is
  -- the best year's rated count, held at 11 until that year is complete,
  -- so the progress never reads 12 of 12 while a finish is still unrated.
  with first_done as (
    select igdb_game_id, min(created_at) as done_at
      from public.activities
     where user_id = v_user_id
       and activity_type = 'status_changed'
       and metadata->>'to_status' = 'played'
     group by igdb_game_id
  ),
  per_year as (
    select extract(year from fd.done_at) as yr,
           count(*) as finished,
           count(*) filter (where exists (
             select 1 from public.reviews r
              where r.user_id = v_user_id
                and r.igdb_game_id = fd.igdb_game_id
                and r.rating is not null and r.rating > 0
           )) as rated
      from first_done fd
     group by 1
  )
  select coalesce(max(
           case when rated = finished then finished else least(rated, 11) end
         ), 0)
    into v_report_card
    from per_year;

  -- Retro Run: finished games first released before 2000 (5).
  select count(*) into v_retro_run
    from (
      select distinct igdb_game_id from public.activities
       where user_id = v_user_id
         and activity_type = 'status_changed'
         and metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
   where gt.first_release_date is not null
     and gt.first_release_date < '2000-01-01'::timestamptz;

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
      ('platform-nomad', v_platform_nomad, private.badge_tier_for(v_platform_nomad, 3, 6, 10)),
      -- Thirty new one-step badges (20261030200000)
      ('press-start', coalesce(v_library_count, 0), private.badge_single_tier(v_library_count, 1)),
      ('starter-pack', coalesce(v_library_count, 0), private.badge_single_tier(v_library_count, 5)),
      ('top-four', coalesce(v_top_four, 0), private.badge_single_tier(v_top_four, 4)),
      ('now-playing', coalesce(v_now_playing, 0), private.badge_single_tier(v_now_playing, 1)),
      ('credits-roll', coalesce(v_finisher, 0), private.badge_single_tier(v_finisher, 1)),
      ('on-the-clock', coalesce(v_timekeeper, 0), private.badge_single_tier(v_timekeeper, 1)),
      ('quick-judge', coalesce(v_quick_judge, 0), private.badge_single_tier(v_quick_judge, 5)),
      ('hot-take', coalesce(v_critic, 0), private.badge_single_tier(v_critic, 1)),
      ('mixtape', coalesce(v_mixtape, 0), private.badge_single_tier(v_mixtape, 3)),
      ('party-up', coalesce(v_party_up, 0), private.badge_single_tier(v_party_up, 3)),
      ('hat-trick', coalesce(v_hat_trick, 0), private.badge_single_tier(v_hat_trick, 3)),
      ('speedrun', coalesce(v_speedrun, 0), private.badge_single_tier(v_speedrun, 1)),
      ('off-the-shelf', coalesce(v_off_the_shelf, 0), private.badge_single_tier(v_off_the_shelf, 1)),
      ('dear-diary', coalesce(v_chronicler, 0), private.badge_single_tier(v_chronicler, 5)),
      ('fan-mail', coalesce(v_fan_mail, 0), private.badge_single_tier(v_fan_mail, 10)),
      ('good-vibes', coalesce(v_good_vibes, 0), private.badge_single_tier(v_good_vibes, 25)),
      ('lifeline', coalesce(v_lifeline, 0), private.badge_single_tier(v_lifeline, 3)),
      ('second-opinion', coalesce(v_second_opinion, 0), private.badge_single_tier(v_second_opinion, 1)),
      ('window-shopper', coalesce(v_window_shopper, 0), private.badge_single_tier(v_window_shopper, 50)),
      ('defend-your-picks', coalesce(v_defend_your_picks, 0), private.badge_single_tier(v_defend_your_picks, 4)),
      ('list-cleared', coalesce(v_list_cleared, 0), private.badge_single_tier(v_list_cleared, 1)),
      ('hot-month', coalesce(v_hot_month, 0), private.badge_single_tier(v_hot_month, 5)),
      ('specialist', coalesce(v_specialist, 0), private.badge_single_tier(v_specialist, 10)),
      ('kindred-spirit', coalesce(v_kindred_spirit, 0), private.badge_single_tier(v_kindred_spirit, 90)),
      ('century', coalesce(v_century, 0), private.badge_single_tier(v_century, 100)),
      ('fan-favorite', coalesce(v_fan_favorite, 0), private.badge_single_tier(v_fan_favorite, 25)),
      ('report-card', coalesce(v_report_card, 0), private.badge_single_tier(v_report_card, 12)),
      ('century-club', coalesce(v_library_count, 0), private.badge_single_tier(v_library_count, 100)),
      ('retro-run', coalesce(v_retro_run, 0), private.badge_single_tier(v_retro_run, 5)),
      ('squad-goals', coalesce(v_squad_goals, 0), private.badge_single_tier(v_squad_goals, 25))
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

-- One-time: work Hot Month out again for everyone under the new rule.
update public.user_badges
   set tier = null, celebrated_at = null, current_value = 0
 where badge_id = 'hot-month';

do $selftest$
declare
  v_test uuid;
begin
  select id into v_test from public.users where username = 'theantifail';
  if v_test is null then
    raise exception 'STOP (nothing was changed): user theantifail not found for the self-test. Send Claude this message.';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_test::text, 'role', 'authenticated')::text, true);
  perform public.recompute_my_badges();
end;
$selftest$;

commit;

select ub.badge_id, ub.tier, ub.current_value, ub.celebrated_at
  from public.user_badges ub
  join public.users u on u.id = ub.user_id
 where u.username = 'theantifail' and ub.badge_id = 'hot-month';
