-- Thirty new badges: Easy, Medium and Hard (approved by Ry, Oct 30 2026).
-- Mockup: docs/design/checkpoint_badges_30.html
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor (project
-- kxypykesyicetabrksfs) and press Run once. It is one transaction:
--   1. A guard checks every table, column and value it reads, and that the
--      live recompute_my_badges() is the 28-family version from
--      20260915170000. If anything differs it STOPS with a message that
--      starts with "STOP (nothing was changed)" and changes nothing.
--   2. It adds two helpers, replaces recompute_my_badges() (the 28
--      existing families copied unchanged, plus the thirty) and
--      backfill_my_badges() (catalogue version 4), and fixes
--      badge_rarity() so it only counts players who actually earned a badge.
--   3. It runs the new recompute once as theantifail inside the same
--      transaction. Any error there rolls everything back.
--   4. The last result grid shows theantifail's thirty new rows. Send it
--      to Claude.
-- Re-running the file is safe.
--
-- DESIGN
--   - One row per badge in user_badges, like every family. The thirty are
--     one-step badges: tier = 'bronze' is the only tier they use and it
--     means "earned". The client never shows the word bronze for them
--     (kind: 'single' in src/data/badges.js).
--   - Completions are completion events (activities, to_status = 'played'),
--     never tracker status. Once earned, never taken away (same monotonic
--     upsert as every family).
--   - celebrated_at stays NULL on a fresh earn. The client shows the moment,
--     then stamps it with acknowledge_my_badge().
--   - Existing players: backfill_my_badges() version 4 stamps every one of
--     the thirty they already qualify for silently and returns them, so the
--     app shows one "already earned" summary instead of a pile of popups.

begin;

-- ── 1. Guard: nothing below runs unless the database looks exactly as the
--    repo says. ─────────────────────────────────────────────────────────────
do $guard$
declare
  r record;
  v_missing text := '';
  v_def text;
  v_overloads int;
  v_tier_rows int;
  v_single_rows int;
begin
  for r in
    select * from (values
      ('user_badges', 'tier'), ('user_badges', 'current_value'), ('user_badges', 'celebrated_at'),
      ('users', 'favorite_games'), ('users', 'badge_backfill_version'), ('users', 'username'),
      ('game_trackers', 'user_id'),
      ('activities', 'user_id'), ('activities', 'igdb_game_id'), ('activities', 'activity_type'),
      ('activities', 'metadata'), ('activities', 'created_at'),
      ('activity_events', 'id'), ('activity_events', 'actor_user_id'), ('activity_events', 'type'),
      ('activity_events', 'entity_id'), ('activity_events', 'created_at'),
      ('play_sessions', 'user_id'), ('play_sessions', 'hours'), ('play_sessions', 'played_on'),
      ('reviews', 'user_id'), ('reviews', 'rating'), ('reviews', 'body'),
      ('reviews', 'igdb_game_id'), ('reviews', 'created_at'),
      ('lists', 'id'), ('lists', 'user_id'),
      ('list_games', 'list_id'), ('list_games', 'igdb_game_id'),
      ('follows', 'follower_id'), ('follows', 'followee_id'),
      ('review_likes', 'review_id'), ('review_likes', 'user_id'),
      ('reactions', 'user_id'), ('reactions', 'target_type'), ('reactions', 'target_id'), ('reactions', 'emoji'),
      ('qa_answers', 'user_id'), ('qa_answers', 'question_id'), ('qa_answers', 'removed_at'),
      ('qa_questions', 'id'), ('qa_questions', 'user_id'),
      ('user_swipe_signals', 'user_id'),
      ('game_tags', 'igdb_game_id'), ('game_tags', 'genre_names'), ('game_tags', 'first_release_date')
    ) as t(tbl, col)
  loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name = r.col
    ) then
      v_missing := v_missing || r.tbl || '.' || r.col || ' ';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'STOP (nothing was changed): missing columns: %. Send Claude this message.', v_missing;
  end if;

  if (select c.data_type from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'users' and c.column_name = 'favorite_games') <> 'jsonb' then
    raise exception 'STOP (nothing was changed): users.favorite_games is not jsonb. Send Claude this message.';
  end if;

  if (select c.data_type from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'reactions' and c.column_name = 'target_id') <> 'text' then
    raise exception 'STOP (nothing was changed): reactions.target_id is not text. Send Claude this message.';
  end if;

  -- Values the new queries compare against. An enum label that does not
  -- exist would make every recompute fail, so check each one here.
  begin
    perform 1 from public.activity_events where false and type = 'backlogged';
    perform 1 from public.activities where false and activity_type = 'status_changed';
    perform 1 from public.reactions where false and target_type = 'activity';
    perform 1 from public.reactions where false and target_type = 'list';
  exception when others then
    raise exception 'STOP (nothing was changed): an event / reaction type is missing (%). Send Claude this message.', sqlerrm;
  end;

  if to_regprocedure('public.get_taste_match_batch(uuid, uuid[])') is null then
    raise exception 'STOP (nothing was changed): get_taste_match_batch(uuid, uuid[]) not found. Send Claude this message.';
  end if;
  if to_regprocedure('public.acknowledge_my_badge(text)') is null then
    raise exception 'STOP (nothing was changed): acknowledge_my_badge(text) not found. Send Claude this message.';
  end if;

  -- The live recompute must be the 28-family function from 20260915170000
  -- (or this file, already applied once).
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_my_badges';
  if v_overloads <> 1 then
    raise exception 'STOP (nothing was changed): % versions of recompute_my_badges() exist, expected 1. Send Claude this message.', v_overloads;
  end if;

  select p.prosrc into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_my_badges';

  select count(*) into v_tier_rows
    from regexp_matches(v_def, '\(''[a-z-]+'', v_[a-z_]+, private\.badge_tier_for\(', 'g');
  select count(*) into v_single_rows
    from regexp_matches(v_def, 'private\.badge_single_tier\(v_', 'g');

  if v_tier_rows <> 28 or v_single_rows not in (0, 30) then
    raise exception 'STOP (nothing was changed): recompute_my_badges() on the server has % tiered and % one-step rows, expected 28 and 0 (or 30 on a re-run). Send Claude this message.', v_tier_rows, v_single_rows;
  end if;
end;
$guard$;

-- ── 2. Helpers ─────────────────────────────────────────────────────────────
-- One-step badges: 'bronze' (= earned) once the value reaches the target.
create or replace function private.badge_single_tier(p_value numeric, p_target numeric)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when coalesce(p_value, 0) >= p_target then 'bronze' else null end;
$$;

comment on function private.badge_single_tier(numeric, numeric) is
  'One-step badges (20261030200000): bronze means earned. Same tier column and monotonic upsert as the tiered families.';

-- badge_rarity() counted every user_badges row, including the rows
-- recompute_my_badges() writes for badges nobody has earned yet (tier
-- NULL), so a locked badge read as held by everyone. Count a row only when
-- it is earned: a tier is set, or it is a pre-Sprint-16 row (those never
-- carry current_value and were only written once earned). Signature and
-- grants unchanged.
create or replace function public.badge_rarity()
returns table(
  badge_id     text,
  holder_count bigint,
  total_users  bigint,
  rarity_pct   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ub.badge_id,
    count(*)::bigint as holder_count,
    (select count(*) from users)::bigint as total_users,
    round(count(*) * 100.0 / nullif((select count(*) from users), 0), 1) as rarity_pct
  from user_badges ub
  where ub.tier is not null or ub.current_value is null
  group by ub.badge_id;
$$;


-- ── 3. recompute_my_badges(): the 28 families it computes today, unchanged,
--    plus the thirty. Signature unchanged. ─────────────────────────────
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

  -- Hot Month: most games finished in one calendar month, each game
  -- counted once, in the month it was first finished (5). Months are UTC.
  select coalesce(max(n), 0) into v_hot_month
    from (
      select count(*) as n
        from (
          select igdb_game_id, min(created_at) as first_done
            from public.activities
           where user_id = v_user_id
             and activity_type = 'status_changed'
             and metadata->>'to_status' = 'played'
           group by igdb_game_id
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

-- ── 4. backfill_my_badges(): catalogue version 4 ─────────────────────────
-- Same mechanism as every earlier pass: recompute, stamp celebrated_at on
-- the families that are new to this player, return them for the one
-- summary card, bump the marker. Return shape unchanged.
--   0     never backfilled: everything earned is new.
--   1     also the eleven (20260915120000), the five and the thirty.
--   2     also the five and the thirty.
--   3     the thirty.
--   >= 4  no-op.
create or replace function public.backfill_my_badges()
returns table(family_id text, granted_tier text, metric_value numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_version integer;
  v_eleven text[] := array[
    'circle', 'conversationalist', 'first-responder', 'curator',
    'tastemaker', 'years-work', 'comeback', 'veteran',
    'weekender', 'perfect-month', 'deep-cut'
  ];
  v_five text[] := array[
    'time-traveler', 'early-adopter', 'short-stack',
    'the-long-haul', 'platform-nomad'
  ];
  v_thirty text[] := array[
      'press-start',
      'starter-pack',
      'top-four',
      'now-playing',
      'credits-roll',
      'on-the-clock',
      'quick-judge',
      'hot-take',
      'mixtape',
      'party-up',
      'hat-trick',
      'speedrun',
      'off-the-shelf',
      'dear-diary',
      'fan-mail',
      'good-vibes',
      'lifeline',
      'second-opinion',
      'window-shopper',
      'defend-your-picks',
      'list-cleared',
      'hot-month',
      'specialist',
      'kindred-spirit',
      'century',
      'fan-favorite',
      'report-card',
      'century-club',
      'retro-run',
      'squad-goals'
    ];
  v_new text[];
begin
  if v_user_id is null then
    raise exception 'backfill_my_badges requires an authenticated user';
  end if;

  select coalesce(u.badge_backfill_version, 0) into v_version
    from public.users u
   where u.id = v_user_id;

  if v_version >= 4 then
    return;
  end if;

  perform public.recompute_my_badges();

  if v_version = 0 then
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
    v_new := case v_version
      when 1 then v_eleven || v_five || v_thirty
      when 2 then v_five || v_thirty
      else v_thirty
    end;
    return query
      with stamped as (
        update public.user_badges ub
           set celebrated_at = now()
         where ub.user_id = v_user_id
           and ub.tier is not null
           and ub.celebrated_at is null
           and ub.badge_id = any(v_new)
        returning ub.badge_id, ub.tier, ub.current_value
      )
      select badge_id, tier, current_value from stamped;
  end if;

  update public.users u
     set badge_backfill_version = 4
   where u.id = v_user_id;
end;
$$;

revoke all on function public.backfill_my_badges() from public, anon;
grant execute on function public.backfill_my_badges() to authenticated;

comment on column public.users.badge_backfill_version is
  'Catalogue version of the one-time badge backfill. 0 = never run; 1 = S16-4a; 2 = the eleven Wave-3-to-live families; 3 = the five on the widened game_tags cache; 4 = the thirty one-step badges (20261030200000). Survives reinstall. Never decremented.';

-- ── 5. Self-test: run the new recompute once as theantifail, inside this
--    transaction. Any error here rolls the whole file back. ───────────────
do $selftest$
declare
  v_test uuid;
begin
  select id into v_test from public.users where username = 'theantifail';
  if v_test is null then
    raise exception 'STOP (nothing was changed): user theantifail not found for the self-test. Send Claude this message.';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_test::text, 'role', 'authenticated')::text,
    true
  );
  perform public.recompute_my_badges();
end;
$selftest$;

commit;

-- ── 6. Result for Claude: theantifail's thirty rows (read-only). ────────
select ub.badge_id, ub.tier, ub.current_value, ub.celebrated_at
  from public.user_badges ub
  join public.users u on u.id = ub.user_id
 where u.username = 'theantifail'
   and ub.badge_id = any(array[
      'press-start',
      'starter-pack',
      'top-four',
      'now-playing',
      'credits-roll',
      'on-the-clock',
      'quick-judge',
      'hot-take',
      'mixtape',
      'party-up',
      'hat-trick',
      'speedrun',
      'off-the-shelf',
      'dear-diary',
      'fan-mail',
      'good-vibes',
      'lifeline',
      'second-opinion',
      'window-shopper',
      'defend-your-picks',
      'list-cleared',
      'hot-month',
      'specialist',
      'kindred-spirit',
      'century',
      'fan-favorite',
      'report-card',
      'century-club',
      'retro-run',
      'squad-goals'
    ])
 order by ub.tier nulls last, ub.badge_id;
