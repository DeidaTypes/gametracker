-- =====================================================================
-- Sprint 8 (16A) — list_comments + list_saves
--
-- Run in the Supabase SQL editor before exercising the comments thread
-- or save action on ListDetail. The listInteractionService relies on
-- both tables, their indexes, and the RLS policies below.
--
-- list_comments — flat thread (no nested replies) of comments on a
--   custom list. Visible to anyone who can see the list.
--   Owner can moderate: DELETE policy lets the list owner remove any
--   comment on their list, not just their own.
--
-- list_saves — one row per (list, user) pair. Lets users bookmark a
--   public list. Distinct from is_pinned (profile pinning) and from
--   reactions (emoji reactions on lists). Unique constraint prevents
--   duplicate saves.
--
-- Blocked-user exclusion is enforced at the application layer via
-- applyBlockFilter / filterBlockedRows from blockService.js, matching
-- the same pattern used by review_comments.
-- =====================================================================

-- ── list_comments ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS list_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS list_comments_list_idx
  ON list_comments(list_id, created_at);

ALTER TABLE list_comments ENABLE ROW LEVEL SECURITY;

-- Readable when the parent list is visible to the current user
-- (public list, or the viewer owns the list).
DROP POLICY IF EXISTS list_comments_select ON list_comments;
CREATE POLICY list_comments_select ON list_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (l.is_public = true OR l.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS list_comments_insert ON list_comments;
CREATE POLICY list_comments_insert ON list_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS list_comments_update ON list_comments;
CREATE POLICY list_comments_update ON list_comments
  FOR UPDATE USING (auth.uid() = user_id);

-- Author may delete their own comment; list owner may delete any comment
-- (moderation).
DROP POLICY IF EXISTS list_comments_delete ON list_comments;
CREATE POLICY list_comments_delete ON list_comments
  FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id AND l.user_id = auth.uid()
    )
  );

-- ── list_saves ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS list_saves (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(list_id, user_id)
);

CREATE INDEX IF NOT EXISTS list_saves_list_idx ON list_saves(list_id);
CREATE INDEX IF NOT EXISTS list_saves_user_idx ON list_saves(user_id);

ALTER TABLE list_saves ENABLE ROW LEVEL SECURITY;

-- A user can always see their own save row; others can see saves on
-- any list that is visible to them (public or owned).
DROP POLICY IF EXISTS list_saves_select ON list_saves;
CREATE POLICY list_saves_select ON list_saves
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (l.is_public = true OR l.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS list_saves_insert ON list_saves;
CREATE POLICY list_saves_insert ON list_saves
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS list_saves_delete ON list_saves;
CREATE POLICY list_saves_delete ON list_saves
  FOR DELETE USING (auth.uid() = user_id);
