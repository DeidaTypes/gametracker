-- =====================================================================
-- Pulse feed broadening — polymorphic comments on activity_events rows
--
-- review_comments today has a hard NOT NULL review_id FK, so only
-- reviews/ratings get a working comment thread. Every other Pulse card
-- type (logged session, finished/started a game, added to backlog,
-- added to a list) needs the identical like + comment affordance a
-- review card has. This migration widens review_comments to also
-- target an activity_events row, mirroring the same target_type-style
-- pattern `reactions` already uses for likes (see supabase/reactions.sql)
-- rather than inventing a parallel table.
--
-- Exactly one of (review_id, activity_event_id) is set per row — a
-- reply inherits its parent's target implicitly via parent_comment_id,
-- but still carries its own matching review_id/activity_event_id so
-- every existing query (`eq('review_id', ...)`) keeps working
-- unmodified for the review path.
-- =====================================================================

ALTER TABLE review_comments
  ALTER COLUMN review_id DROP NOT NULL;

ALTER TABLE review_comments
  ADD COLUMN IF NOT EXISTS activity_event_id uuid REFERENCES activity_events(id) ON DELETE CASCADE;

ALTER TABLE review_comments
  DROP CONSTRAINT IF EXISTS review_comments_one_target_chk;

ALTER TABLE review_comments
  ADD CONSTRAINT review_comments_one_target_chk
  CHECK (
    (review_id IS NOT NULL AND activity_event_id IS NULL)
    OR (review_id IS NULL AND activity_event_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS review_comments_activity_event_idx
  ON review_comments(activity_event_id, created_at);

-- RLS policies (review_comments_read / _insert_own / _update_own /
-- _delete_own) are already target-agnostic (auth.uid() = user_id, or
-- USING (true) for read) — no policy changes needed for the new column.

-- review_comments was never added to the realtime publication (only
-- the unused legacy `comments` table from an earlier draft was) — a
-- pre-existing gap that left comment realtime silently inert. Fixing
-- it here since the new activity-comments thread needs live updates
-- and this is the same table/mechanism.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE review_comments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
