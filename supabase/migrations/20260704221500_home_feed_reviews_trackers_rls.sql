-- Home feed (text-forward review card) — privacy + block aware reads on
-- `reviews` and `game_trackers`.
--
-- Gap being closed: both tables currently carry `USING (true)` SELECT
-- policies (reviews_select_all / trackers_select_all) — wide open to any
-- reader regardless of the author's `activity_privacy` setting, and with
-- no `blocked_users` enforcement at the RLS layer (blocking was only ever
-- applied client-side via applyBlockFilter(), which a malicious/buggy
-- client can simply skip).
--
-- This migration replaces those two SELECT policies with the same
-- everyone/followers/me privacy tiering already enforced on
-- `activity_events` (see supabase/activity_events.sql) and `activities` /
-- `user_goals` (see 20260702195009_profile_visitor_rls_fix.sql), plus a
-- blocked_users exclusion (both directions) that those tables don't
-- (yet) enforce at the RLS layer either.
--
-- Result: a reader can see a review/tracker row when:
--   1. they wrote it themselves, OR
--   2. neither party has blocked the other, AND either
--        a. the author's activity_privacy = 'everyone', OR
--        b. the author's activity_privacy = 'followers' AND the reader
--           follows the author
--   (activity_privacy = 'me' falls through to "author only", same as
--   activity_events_select_visible.)
--
-- INSERT / UPDATE / DELETE policies on both tables are untouched.

-- ── reviews ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS reviews_select_all ON public.reviews;

CREATE POLICY reviews_select_visible ON public.reviews
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = reviews.user_id)
         OR (b.blocker_id = reviews.user_id AND b.blocked_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = reviews.user_id
        AND (
          u.activity_privacy = 'everyone'::activity_privacy_level
          OR (
            u.activity_privacy = 'followers'::activity_privacy_level
            AND EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = auth.uid()
                AND f.followee_id = reviews.user_id
            )
          )
        )
    )
  )
);

-- ── game_trackers ────────────────────────────────────────────────────────
-- Same treatment — game_trackers.rating is the app's other rating surface
-- (finished-game ratings without a written review; getJustFinished()).
DROP POLICY IF EXISTS trackers_select_all ON public.game_trackers;

CREATE POLICY trackers_select_visible ON public.game_trackers
FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = game_trackers.user_id)
         OR (b.blocker_id = game_trackers.user_id AND b.blocked_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = game_trackers.user_id
        AND (
          u.activity_privacy = 'everyone'::activity_privacy_level
          OR (
            u.activity_privacy = 'followers'::activity_privacy_level
            AND EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = auth.uid()
                AND f.followee_id = game_trackers.user_id
            )
          )
        )
    )
  )
);
