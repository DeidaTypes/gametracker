-- =====================================================================
-- Reactions — cross-surface emoji reaction layer
-- Surfaces: review, list, activity, comment
-- =====================================================================
-- Idempotent: safe to re-run. Every DDL statement is guarded with
-- IF NOT EXISTS or a DO-block that catches duplicate_object.

-- ----------------------------------------------------------------------
-- 1. reaction_target_type enum
-- ----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE reaction_target_type AS ENUM ('review', 'list', 'activity', 'comment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------
-- 2. reactions table
-- ----------------------------------------------------------------------
-- target_id is text to carry UUIDs (reviews, lists, comments) and
-- opaque activity event IDs without polymorphic FK gymnastics.
-- emoji is validated to ≤8 bytes to cover any standard emoji glyph.
-- The composite UNIQUE key ensures one reaction per user/target/emoji.

CREATE TABLE IF NOT EXISTS reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type reaction_target_type NOT NULL,
  target_id   text NOT NULL,
  emoji       text NOT NULL CHECK (char_length(emoji) <= 8),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id, emoji)
);

-- Hot path: fetch all reactions for a specific target
CREATE INDEX IF NOT EXISTS reactions_target_idx
  ON reactions (target_type, target_id);

-- Hot path: "did I already react?" per-user check
CREATE INDEX IF NOT EXISTS reactions_user_target_idx
  ON reactions (user_id, target_type, target_id);

-- ----------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated readers, exclude blocked-user reactions
DROP POLICY IF EXISTS reactions_select ON reactions;
CREATE POLICY reactions_select ON reactions
  FOR SELECT
  TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM blocked_users
      WHERE (blocker_id = auth.uid() AND blocked_id = reactions.user_id)
         OR (blocked_id = auth.uid() AND blocker_id = reactions.user_id)
    )
  );

-- INSERT: own rows only, cannot react to blocked-user content
DROP POLICY IF EXISTS reactions_insert ON reactions;
CREATE POLICY reactions_insert ON reactions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM blocked_users
      WHERE (blocker_id = auth.uid() AND blocked_id = user_id)
         OR (blocked_id = auth.uid() AND blocker_id = user_id)
    )
  );

-- DELETE: own rows only (toggling off)
DROP POLICY IF EXISTS reactions_delete ON reactions;
CREATE POLICY reactions_delete ON reactions
  FOR DELETE
  USING (auth.uid() = user_id);
