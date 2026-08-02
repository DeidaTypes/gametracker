-- High-severity findings from the pre-production RLS audit.
--
-- DEPLOY COUPLING: sections 2 and 7 change what the API roles may read, and
-- three client files must ship with this migration or the app will break.
-- See the note above section 7.
--
-- Ordering matters. Section 1 must land before section 6: the blocked_users
-- read policy dropped there is currently the only reason the block half of
-- the visibility checks works at all.


-- ============================================================
-- 1. Private predicate helpers
-- ============================================================
--
-- Two problems share one root cause. RLS applies to tables referenced inside
-- a policy expression, and column privileges are checked for columns a policy
-- touches, so every visibility policy needed the caller to be able to read
-- both blocked_users and users.activity_privacy directly:
--
--   * the "did someone block me" half of each check only resolved because of
--     the blocked_users policy that lets a user list rows where they are the
--     blocked party -- the same policy that leaks the blocklist;
--   * users.activity_privacy could not be revoked from the API roles without
--     breaking six policies.
--
-- Moving both predicates into SECURITY DEFINER functions decouples
-- enforcement from what the caller can see. They live in `private` rather
-- than `public` so PostgREST cannot expose them as RPCs.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Bidirectional block test. Used by the DM insert check, where the sender
-- cannot see a blocked_users row naming them as the blocked party.
create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from blocked_users bu
    where (bu.blocker_id = a and bu.blocked_id = b)
       or (bu.blocker_id = b and bu.blocked_id = a)
  );
$$;

-- The full "may `viewer` see rows authored by `actor`" test: not blocked in
-- either direction, and the actor's privacy setting admits this viewer.
-- `viewer` is null for anonymous callers, which correctly fails every branch
-- except the 'everyone' one.
create or replace function private.actor_visible_to(actor uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select actor = viewer
     or (
       not exists (
         select 1
         from blocked_users bu
         where (bu.blocker_id = viewer and bu.blocked_id = actor)
            or (bu.blocker_id = actor and bu.blocked_id = viewer)
       )
       and exists (
         select 1
         from users u
         where u.id = actor
           and (
             u.activity_privacy = 'everyone'::activity_privacy_level
             or (
               u.activity_privacy = 'followers'::activity_privacy_level
               and exists (
                 select 1
                 from follows f
                 where f.follower_id = viewer
                   and f.followee_id = actor
               )
             )
           )
       )
     );
$$;

revoke all on function private.is_blocked_between(uuid, uuid) from public;
revoke all on function private.actor_visible_to(uuid, uuid) from public;
grant execute on function private.is_blocked_between(uuid, uuid) to anon, authenticated, service_role;
grant execute on function private.actor_visible_to(uuid, uuid) to anon, authenticated, service_role;


-- ============================================================
-- 2. Route all six visibility policies through the helper
-- ============================================================
-- reviews, game_trackers and play_sessions keep identical semantics.
--
-- activities, activity_events and user_goals gain the bidirectional block
-- check they were missing -- they had the privacy ladder but no block clause,
-- so a blocked user could still read the blocker's feed, events and goals.

drop policy if exists reviews_select_visible on public.reviews;
create policy reviews_select_visible on public.reviews
  for select
  using (private.actor_visible_to(user_id, auth.uid()));

drop policy if exists trackers_select_visible on public.game_trackers;
create policy trackers_select_visible on public.game_trackers
  for select
  using (private.actor_visible_to(user_id, auth.uid()));

-- Own rows stay visible regardless of ended_at; other people's sessions only
-- surface once finished, so an in-progress session never leaks.
drop policy if exists play_sessions_select_visible_to_followers on public.play_sessions;
create policy play_sessions_select_visible_to_followers on public.play_sessions
  for select
  using (
    auth.uid() = user_id
    or (
      ended_at is not null
      and private.actor_visible_to(user_id, auth.uid())
    )
  );

drop policy if exists activities_select_visible on public.activities;
create policy activities_select_visible on public.activities
  for select
  using (private.actor_visible_to(user_id, auth.uid()));

drop policy if exists activity_events_select_visible on public.activity_events;
create policy activity_events_select_visible on public.activity_events
  for select
  using (private.actor_visible_to(actor_user_id, auth.uid()));

drop policy if exists user_goals_select_visible on public.user_goals;
create policy user_goals_select_visible on public.user_goals
  for select
  using (private.actor_visible_to(user_id, auth.uid()));


-- ============================================================
-- 3. comments — inherit the visibility of the parent review
-- ============================================================
-- comments_select_all was USING (true), so comment bodies on a
-- followers-only author's review were readable by anyone, including
-- unauthenticated callers. Delegating to `reviews` tracks whatever
-- reviews_select_visible allows, with no duplicated privacy ladder to drift.
-- Authors keep access to their own comments regardless.

drop policy if exists comments_select_all on public.comments;
create policy comments_select_visible on public.comments
  for select
  using (
    auth.uid() = user_id
    or exists (select 1 from reviews r where r.id = comments.review_id)
  );

-- UPDATE had no WITH CHECK. Postgres reuses USING in that case, so this is a
-- clarity change rather than a behavioural one.
drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================
-- 4. direct_messages
-- ============================================================
-- SELECT was already correct (participants only) and is left alone.
--
-- The recipient needs to stamp read_at, but RLS is row-level, so the UPDATE
-- policy also let them rewrite `body` and `attachment` on a message they
-- received. Column privileges are the only way to scope that. markThreadAsRead()
-- in src/services/messageService.js is the sole UPDATE call site and writes
-- read_at alone, so no client change is required here.

revoke update on public.direct_messages from anon, authenticated;
grant update (read_at) on public.direct_messages to authenticated;

drop policy if exists dm_update_recipient on public.direct_messages;
create policy dm_update_recipient on public.direct_messages
  for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Sending was not block-aware.
drop policy if exists dm_insert_self on public.direct_messages;
create policy dm_insert_self on public.direct_messages
  for insert
  with check (
    auth.uid() = sender_id
    and not private.is_blocked_between(auth.uid(), direct_messages.recipient_id)
  );


-- ============================================================
-- 5. get_circle_streaks / get_taste_match — caller-supplied identity
-- ============================================================
-- Both took an identity as an argument and never compared it to auth.uid().
-- Because SECURITY DEFINER runs as the owner, RLS was bypassed, so any anon
-- caller could POST an arbitrary uuid and read that user's follow graph and
-- streaks, or score any two strangers against each other.
--
-- Signatures are unchanged so statsService.js and tasteEngineService.js need
-- no edits; the arguments are now required to match the caller.

create or replace function public.get_circle_streaks(viewer_id uuid)
returns table(user_id uuid, username text, avatar_url text, current_streak integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  WITH followed AS (
    SELECT f.followee_id
    FROM follows f
    WHERE f.follower_id = viewer_id
      AND viewer_id = auth.uid()
  ),
  opted_in AS (
    SELECT u.id, u.username, u.avatar_url
    FROM users u
    JOIN followed f ON f.followee_id = u.id
    WHERE u.streak_share_opt_in = true
  ),
  daily AS (
    SELECT
      a.user_id,
      (a.created_at AT TIME ZONE 'UTC')::date AS d
    FROM activities a
    JOIN opted_in oi ON oi.id = a.user_id
    WHERE a.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY a.user_id, (a.created_at AT TIME ZONE 'UTC')::date
  ),
  numbered AS (
    SELECT
      user_id,
      d,
      (d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d) * INTERVAL '1 day'))::date AS grp
    FROM daily
  ),
  islands AS (
    SELECT
      user_id,
      grp,
      COUNT(*)::integer AS len,
      MAX(d) AS last_day
    FROM numbered
    GROUP BY user_id, grp
  ),
  current_streaks AS (
    SELECT DISTINCT ON (user_id)
      user_id,
      len AS current_streak
    FROM islands
    WHERE last_day >= CURRENT_DATE - 1
    ORDER BY user_id, last_day DESC
  )
  SELECT
    oi.id    AS user_id,
    oi.username,
    oi.avatar_url,
    COALESCE(cs.current_streak, 0) AS current_streak
  FROM opted_in oi
  LEFT JOIN current_streaks cs ON cs.user_id = oi.id
  WHERE COALESCE(cs.current_streak, 0) > 0
  ORDER BY COALESCE(cs.current_streak, 0) DESC;
$function$;

revoke execute on function public.get_circle_streaks(uuid) from anon, public;
grant execute on function public.get_circle_streaks(uuid) to authenticated;

create or replace function public.get_taste_match(user_a uuid, user_b uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  MIN_SIGNAL        constant integer := 3;
  MIN_SHARED_GENRES constant integer := 2;

  va public.user_taste_vectors%ROWTYPE;
  vb public.user_taste_vectors%ROWTYPE;

  genre_dot   numeric := 0;
  theme_dot   numeric := 0;
  theme_a_ct  integer := 0;
  theme_b_ct  integer := 0;
  overall     numeric := 0;
  shared_ct   integer := 0;
  genres_json jsonb;
BEGIN
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'invalid_pair', 'genres', '[]'::jsonb);
  END IF;

  IF auth.uid() IS NULL OR auth.uid() NOT IN (user_a, user_b) THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'not_authorized', 'genres', '[]'::jsonb);
  END IF;

  SELECT * INTO va FROM public.user_taste_vectors WHERE user_id = user_a;
  SELECT * INTO vb FROM public.user_taste_vectors WHERE user_id = user_b;

  IF va.user_id IS NULL OR vb.user_id IS NULL
     OR va.signal_count < MIN_SIGNAL OR vb.signal_count < MIN_SIGNAL THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'insufficient_data', 'genres', '[]'::jsonb);
  END IF;

  -- Genre cosine = dot product over shared keys (vectors pre-normalized).
  SELECT
    COALESCE(SUM((a.value)::numeric * (b.value)::numeric), 0),
    COUNT(*)
  INTO genre_dot, shared_ct
  FROM jsonb_each_text(va.genre_weights) a
  JOIN jsonb_each_text(vb.genre_weights) b ON a.key = b.key;

  IF shared_ct < MIN_SHARED_GENRES THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'too_few_shared_genres', 'genres', '[]'::jsonb);
  END IF;

  -- Theme cosine (only blended when BOTH users have theme signal).
  SELECT COUNT(*) INTO theme_a_ct FROM jsonb_object_keys(va.theme_weights);
  SELECT COUNT(*) INTO theme_b_ct FROM jsonb_object_keys(vb.theme_weights);

  IF theme_a_ct > 0 AND theme_b_ct > 0 THEN
    SELECT COALESCE(SUM((a.value)::numeric * (b.value)::numeric), 0)
    INTO theme_dot
    FROM jsonb_each_text(va.theme_weights) a
    JOIN jsonb_each_text(vb.theme_weights) b ON a.key = b.key;

    overall := 0.75 * genre_dot + 0.25 * theme_dot;
  ELSE
    overall := genre_dot;
  END IF;

  overall := GREATEST(0, LEAST(1, overall));

  -- Per-genre breakdown: shared genres by combined strength sqrt(wa*wb),
  -- top 6, expressed 0-100.
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'strength')::numeric DESC), '[]'::jsonb)
  INTO genres_json
  FROM (
    SELECT jsonb_build_object(
             'genre', a.key,
             'strength', round(100 * sqrt((a.value)::numeric * (b.value)::numeric))
           ) AS g
    FROM jsonb_each_text(va.genre_weights) a
    JOIN jsonb_each_text(vb.genre_weights) b ON a.key = b.key
    ORDER BY sqrt((a.value)::numeric * (b.value)::numeric) DESC
    LIMIT 6
  ) sub;

  RETURN jsonb_build_object(
    'score',              round(overall * 100),
    'confidence',         round(LEAST(va.confidence, vb.confidence)::numeric, 2),
    'enough_data',        true,
    'shared_genre_count', shared_ct,
    'genres',             genres_json
  );
END;
$function$;

revoke execute on function public.get_taste_match(uuid, uuid) from anon, public;
grant execute on function public.get_taste_match(uuid, uuid) to authenticated;

-- Trigger and event-trigger bodies are never meant to be invoked over
-- PostgREST. They fire on their own and need no EXECUTE grant to API roles.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.fn_play_sessions_rollup() from anon, authenticated, public;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
revoke execute on function public.trg_fn_notify_comment() from anon, authenticated, public;
revoke execute on function public.trg_fn_notify_follow() from anon, authenticated, public;
revoke execute on function public.trg_fn_notify_friend_started() from anon, authenticated, public;
revoke execute on function public.trg_fn_notify_reaction() from anon, authenticated, public;


-- ============================================================
-- 6. blocked_users — stop disclosing the blocklist to the blocked party
-- ============================================================
-- Safe only after section 2. Enforcement no longer reads this table as the
-- caller, so blocking is once again one-way and invisible.
--
-- blockService.loadBlockedIds() still queries both directions with
-- .or(blocker_id.eq.X, blocked_id.eq.X). That query keeps working -- RLS just
-- returns the blocker-side rows -- so client-side filtering still hides people
-- the user blocked. People who blocked the user are now filtered server-side
-- by the six policies in section 2 instead.

drop policy if exists "Users can see if they are blocked" on public.blocked_users;


-- ============================================================
-- 7. users — keep profiles public, make privacy settings private
-- ============================================================
-- CLIENT CHANGES REQUIRED WITH THIS SECTION:
--   * src/services/auth.js          — two .select('*') calls on users must
--                                     name columns explicitly
--   * src/services/userService.js   — drop activity_privacy from the two
--                                     profile selects (it was fetched but
--                                     never read)
--   * src/services/userSettingsService.js — read own settings via the RPC below
--
-- RLS is row-level, so a policy cannot hide a column. Column privileges can,
-- and are now viable because section 2 moved the only policy reads of
-- activity_privacy into a definer function.

revoke select on public.users from anon, authenticated;
grant select (
  id,
  display_name,
  username,
  bio,
  avatar_url,
  genre_badge,
  platform_badge,
  created_at,
  updated_at,
  banner_url,
  favorite_games,
  streak_share_opt_in,
  showcase_badges,
  current_obsessions
) on public.users to anon, authenticated;

-- Column privileges are not row-aware, so revoking the two columns also cut
-- a user off from their own settings. This hands back exactly the caller's
-- own row and takes no arguments, so it cannot be turned into an oracle.
create or replace function public.get_my_settings()
returns table(activity_privacy activity_privacy_level, presence_opt_in boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.activity_privacy, u.presence_opt_in
  from users u
  where u.id = auth.uid();
$$;

revoke execute on function public.get_my_settings() from anon, public;
grant execute on function public.get_my_settings() to authenticated;
