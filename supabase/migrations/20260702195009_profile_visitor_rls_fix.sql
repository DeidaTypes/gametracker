-- Fix: visitor profiles were missing Challenge (yearly goal) data because
-- user_goals SELECT was owner-only, and the `activities` table backing the
-- Profile Activity tab predated the activity_privacy column and never
-- respected it (it was wide open regardless of privacy setting). This
-- migration makes both privacy-aware using the same everyone/followers/me
-- tiering already implemented for activity_events, and fixes a latent bug
-- in a redundant `lists` SELECT policy found during the audit.

-- ── user_goals: owner-only -> privacy-aware ─────────────────────────────
-- Write policies (insert/update/delete) are untouched -- still owner-only.
DROP POLICY IF EXISTS "user_goals: owner can read" ON public.user_goals;

CREATE POLICY user_goals_select_visible ON public.user_goals
FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = user_goals.user_id
      AND (
        u.activity_privacy = 'everyone'::activity_privacy_level
        OR (
          u.activity_privacy = 'followers'::activity_privacy_level
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = auth.uid()
              AND f.followee_id = user_goals.user_id
          )
        )
      )
  )
);

-- ── activities: unconditionally public -> privacy-aware ────────────────
-- Mirrors activity_events_select_visible so a user's activity_privacy
-- choice ('everyone' | 'followers' | 'me') actually applies to the
-- Profile Activity tab, not just the Discover circle feed.
DROP POLICY IF EXISTS activities_select_all ON public.activities;

CREATE POLICY activities_select_visible ON public.activities
FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = activities.user_id
      AND (
        u.activity_privacy = 'everyone'::activity_privacy_level
        OR (
          u.activity_privacy = 'followers'::activity_privacy_level
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = auth.uid()
              AND f.followee_id = activities.user_id
          )
        )
      )
  )
);

-- ── lists: fix a latent bug in a redundant collaborator-select policy ──
-- `lists_select` intended to also expose a private list to its
-- collaborators but self-referenced `lc.id` instead of `l.id`, so it
-- never actually matched. `lists_select_public_or_own` (unchanged)
-- already correctly covers is_public/own-row access; this replacement
-- restores intended collaborator visibility on the base `lists` row.
DROP POLICY IF EXISTS lists_select ON public.lists;

CREATE POLICY lists_select_collaborator ON public.lists
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.list_collaborators lc
    WHERE lc.list_id = lists.id AND lc.user_id = auth.uid()
  )
);
