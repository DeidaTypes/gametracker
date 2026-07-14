-- Home feed unification — close a blocked-users RLS gap on `activity_events`.
--
-- Gap found while broadening Home's feed to read `activity_events`
-- directly (list-adds, backlog-adds, finished/played, favorited — see
-- communityService.getHomeFeed): `activity_events_select_visible`
-- (supabase/activity_events.sql) already tiers reads by the actor's
-- `activity_privacy` setting (everyone / followers / me), but — unlike
-- the `reviews` / `game_trackers` SELECT policies closed in
-- 20260704221500_home_feed_reviews_trackers_rls.sql — it never excludes
-- blocked relationships at the RLS layer. Blocking was only ever enforced
-- client-side via `applyBlockFilter()` on every read in
-- activityEventsService.js / communityService.js, which a malicious or
-- buggy client could simply skip. Home now reads this table for
-- non-review event types, so the same defense-in-depth block exclusion
-- used elsewhere is added here too.
--
-- Result: unchanged from before, PLUS a reader can no longer see an
-- activity_events row authored by (or authoring against) a user they
-- have blocked or been blocked by, in either direction.
--
-- INSERT / DELETE policies (actor-only) are untouched.

DROP POLICY IF EXISTS activity_events_select_visible ON public.activity_events;

CREATE POLICY activity_events_select_visible ON public.activity_events
FOR SELECT
USING (
  auth.uid() = actor_user_id
  OR (
    NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = activity_events.actor_user_id)
         OR (b.blocker_id = activity_events.actor_user_id AND b.blocked_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = activity_events.actor_user_id
        AND (
          u.activity_privacy = 'everyone'::activity_privacy_level
          OR (
            u.activity_privacy = 'followers'::activity_privacy_level
            AND EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = auth.uid()
                AND f.followee_id = activity_events.actor_user_id
            )
          )
        )
    )
  )
);
