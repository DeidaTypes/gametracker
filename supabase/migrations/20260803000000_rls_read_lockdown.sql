-- RLS read lockdown — closes the read breaches found by the pentest.
--
-- MANUAL RUN. Review, then apply the 20260803* set in filename order. Depends on
-- private.is_blocked_between / private.actor_visible_to from
-- 20260801010205_rls_high_severity_fixes.sql, which must be applied first.
--
-- Three things change per table:
--   1. SELECT is restricted to `authenticated`. Only `reviews` and the public
--      profile columns on `users` stay reachable with the bundled anon key (see
--      20260803000100 for the profile view). Everything else previously answered
--      a request carrying nothing but the client-bundle anon key.
--   2. Tables that are private to their owner get an ownership check instead of
--      USING (true).
--   3. Every remaining content surface gets the bidirectional block check that
--      only reviews / game_trackers / play_sessions had.
--
-- Write and ownership policies are deliberately untouched. The one exception is
-- the reactions SELECT block clause, called out inline, and it TIGHTENS an
-- existing check rather than relaxing it.


-- ============================================================
-- 1. journal_entries — private to its author
-- ============================================================
-- Was: journal_read  FOR SELECT  USING (true)
--
-- The highest-severity finding. `true` meant a caller holding only the anon key
-- got a user's real private notes back verbatim. Its sibling game_journal has
-- always used the ownership check; this makes the two agree. Journal content is
-- never public, never anon, and is not shared with followers.

drop policy if exists journal_read on public.journal_entries;

create policy journal_select_own on public.journal_entries
  for select
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================
-- 2. user_taste_vectors — private to its owner
-- ============================================================
-- Was: user_taste_vectors_select_auth  USING (auth.role() = 'authenticated')
--
-- Any signed-in user could read every other user's taste vector. Cross-user
-- comparison still works: get_taste_match() is SECURITY DEFINER and now checks
-- that the caller is one of the two people being compared.

drop policy if exists user_taste_vectors_select_auth on public.user_taste_vectors;

create policy user_taste_vectors_select_own on public.user_taste_vectors
  for select
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================
-- 3. list_saves — private to its owner, counts via a definer function
-- ============================================================
-- Was: list_saves_select  USING (own OR the list is public OR the list is mine)
--
-- "Which lists this person saved" is a private signal, but the UI needs public
-- save COUNTS (list tiles, and the Community collections ranking). Rows go
-- owner-only and the aggregate moves into a definer function that returns only
-- counts, never identities.

drop policy if exists list_saves_select on public.list_saves;

create policy list_saves_select_own on public.list_saves
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Counts only. Takes the list ids the caller already knows about and returns a
-- bare tally per list, so it cannot be used to enumerate who saved what.
create or replace function public.get_list_save_counts(p_list_ids uuid[])
returns table(list_id uuid, save_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select ls.list_id, count(*)::integer as save_count
  from list_saves ls
  where ls.list_id = any(p_list_ids)
  group by ls.list_id;
$$;

revoke execute on function public.get_list_save_counts(uuid[]) from anon, public;
grant execute on function public.get_list_save_counts(uuid[]) to authenticated;


-- ============================================================
-- 4. Feed surfaces — require auth
-- ============================================================
-- The privacy ladder and block check already live in actor_visible_to(); these
-- only add the `authenticated` requirement. Anonymous callers were reaching all
-- of these through the anon key (activity_events alone returned 75 rows).

drop policy if exists activities_select_visible on public.activities;
create policy activities_select_visible on public.activities
  for select
  to authenticated
  using (private.actor_visible_to(user_id, auth.uid()));

drop policy if exists activity_events_select_visible on public.activity_events;
create policy activity_events_select_visible on public.activity_events
  for select
  to authenticated
  using (private.actor_visible_to(actor_user_id, auth.uid()));

drop policy if exists trackers_select_visible on public.game_trackers;
create policy trackers_select_visible on public.game_trackers
  for select
  to authenticated
  using (private.actor_visible_to(user_id, auth.uid()));

drop policy if exists user_goals_select_visible on public.user_goals;
create policy user_goals_select_visible on public.user_goals
  for select
  to authenticated
  using (private.actor_visible_to(user_id, auth.uid()));

-- Own sessions stay visible regardless of ended_at; other people's only surface
-- once finished, so an in-progress session never leaks.
drop policy if exists play_sessions_select_visible_to_followers on public.play_sessions;
create policy play_sessions_select_visible_to_followers on public.play_sessions
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or (
      ended_at is not null
      and private.actor_visible_to(user_id, auth.uid())
    )
  );

-- `reviews` is deliberately NOT touched here: reviews_select_visible stays
-- reachable by anon so shared review links work for logged-out visitors. It
-- already routes through actor_visible_to(), so the author's privacy setting and
-- the block check both apply.


-- ============================================================
-- 5. Owner-only tables — require auth
-- ============================================================
-- Semantics unchanged (all were already ownership-checked); this only stops anon
-- from reaching them at all.

drop policy if exists game_journal_select_own on public.game_journal;
create policy game_journal_select_own on public.game_journal
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists user_swipe_signals_select_own on public.user_swipe_signals;
create policy user_swipe_signals_select_own on public.user_swipe_signals
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists dm_select_participant on public.direct_messages;
create policy dm_select_participant on public.direct_messages
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "users can select own play_sessions" on public.play_sessions;
create policy "users can select own play_sessions" on public.play_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================
-- 6. lists — the list's own privacy setting, plus auth and blocks
-- ============================================================
-- List privacy is modelled as a single boolean column, lists.is_public. There is
-- no per-viewer ACL and no "followers only" tier; collaborators get access
-- through list_collaborators instead. That model is kept as-is and now also
-- requires a session and honours blocks.

drop policy if exists lists_select_public_or_own on public.lists;
create policy lists_select_public_or_own on public.lists
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      is_public = true
      and not private.is_blocked_between(auth.uid(), user_id)
    )
  );

drop policy if exists lists_select_collaborator on public.lists;
create policy lists_select_collaborator on public.lists
  for select
  to authenticated
  using (
    not private.is_blocked_between(auth.uid(), user_id)
    and exists (
      select 1
      from list_collaborators lc
      where lc.list_id = lists.id
        and lc.user_id = auth.uid()
    )
  );

-- list_games and list_comments reach `lists` through an EXISTS, which is itself
-- subject to the policies above, so both inherit the privacy and block gates.
drop policy if exists list_games_select on public.list_games;
create policy list_games_select on public.list_games
  for select
  to authenticated
  using (exists (select 1 from lists l where l.id = list_games.list_id));

drop policy if exists list_comments_select on public.list_comments;
create policy list_comments_select on public.list_comments
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or (
      not private.is_blocked_between(auth.uid(), list_comments.user_id)
      and exists (select 1 from lists l where l.id = list_comments.list_id)
    )
  );

-- Was USING (true) — the full collaborator graph of every list, public or not.
drop policy if exists list_collaborators_select on public.list_collaborators;
create policy list_collaborators_select on public.list_collaborators
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from lists l where l.id = list_collaborators.list_id)
  );


-- ============================================================
-- 7. Social interaction surfaces — require auth + block check
-- ============================================================
-- Every one of these was USING (true). The block clause mirrors the one
-- reviews / game_trackers / play_sessions already had, via the definer helper so
-- it does not depend on the caller being able to read blocked_users.

drop policy if exists follows_select_all on public.follows;
create policy follows_select_visible on public.follows
  for select
  to authenticated
  using (
    not private.is_blocked_between(auth.uid(), follower_id)
    and not private.is_blocked_between(auth.uid(), followee_id)
  );

drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible on public.comments
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or (
      not private.is_blocked_between(auth.uid(), comments.user_id)
      and exists (select 1 from reviews r where r.id = comments.review_id)
    )
  );

drop policy if exists review_comments_read on public.review_comments;
create policy review_comments_select_visible on public.review_comments
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), review_comments.user_id)
  );

drop policy if exists likes_select_all on public.likes;
create policy likes_select_visible on public.likes
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), likes.user_id)
  );

drop policy if exists review_likes_read on public.review_likes;
create policy review_likes_select_visible on public.review_likes
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), review_likes.user_id)
  );

drop policy if exists comment_likes_read on public.comment_likes;
create policy comment_likes_select_visible on public.comment_likes
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), comment_likes.user_id)
  );

drop policy if exists pins_select_all on public.review_pins;
create policy pins_select_visible on public.review_pins
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), review_pins.user_id)
  );

drop policy if exists user_badges_select_all on public.user_badges;
create policy user_badges_select_visible on public.user_badges
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), user_badges.user_id)
  );

drop policy if exists user_streaks_read on public.user_streaks;
create policy user_streaks_select_visible on public.user_streaks
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), user_streaks.user_id)
  );

-- reactions already had a block clause, but it read blocked_users directly as
-- the caller. 20260801010205 removed the policy that let a user see rows naming
-- them as the blocked party, so that inline check silently lost the "they
-- blocked me" direction. Routing it through the definer helper restores it.
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or not private.is_blocked_between(auth.uid(), reactions.user_id)
  );


-- ============================================================
-- 8. Reference / catalog tables — require auth
-- ============================================================
-- No owner and nothing sensitive in them, but the decision is that only profiles
-- and reviews answer an unauthenticated request. A logged-out visitor on a
-- shared review link needs neither: game_title and game_image are denormalised
-- onto `reviews`.

drop policy if exists game_tags_select_all on public.game_tags;
create policy game_tags_select_all on public.game_tags
  for select to authenticated using (true);

drop policy if exists featured_games_read on public.featured_games;
create policy featured_games_read on public.featured_games
  for select to authenticated using (true);

drop policy if exists new_notable_pool_select_all on public.new_notable_pool;
create policy new_notable_pool_select_all on public.new_notable_pool
  for select to authenticated using (true);

drop policy if exists drop_candidate_pool_select_all on public.drop_candidate_pool;
create policy drop_candidate_pool_select_all on public.drop_candidate_pool
  for select to authenticated using (true);

drop policy if exists drop_filter_types_select_all on public.drop_filter_types;
create policy drop_filter_types_select_all on public.drop_filter_types
  for select to authenticated using (true);

drop policy if exists drop_games_select_all on public.drop_games;
create policy drop_games_select_all on public.drop_games
  for select to authenticated using (true);

drop policy if exists drop_history_select_all on public.drop_history;
create policy drop_history_select_all on public.drop_history
  for select to authenticated using (true);

drop policy if exists drop_schedule_select_all on public.drop_schedule;
create policy drop_schedule_select_all on public.drop_schedule
  for select to authenticated using (true);

drop policy if exists drop_themes_select_all on public.drop_themes;
create policy drop_themes_select_all on public.drop_themes
  for select to authenticated using (true);
