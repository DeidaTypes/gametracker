-- =====================================================================
-- Sprint 6 P1 — Threaded comments on reviews
--
-- Run this in the Supabase SQL editor BEFORE shipping the
-- /reviews/:id/comments page. The commentService relies on the table,
-- indexes, and RLS policies below.
--
-- One level of nesting only: a comment can have replies, replies cannot
-- have their own replies (enforced at the application layer; the schema
-- itself permits arbitrary depth via the self-referential FK).
-- =====================================================================

CREATE TABLE IF NOT EXISTS comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_review_idx
  ON comments(review_id, created_at);

CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON comments(parent_comment_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Public read — anyone (including signed-out viewers) can browse comments.
DROP POLICY IF EXISTS comments_select_all ON comments;
CREATE POLICY comments_select_all ON comments
  FOR SELECT USING (true);

-- Only authenticated users may insert, and only as themselves.
DROP POLICY IF EXISTS comments_insert_self ON comments;
CREATE POLICY comments_insert_self ON comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only the author may edit / delete their own comment.
DROP POLICY IF EXISTS comments_update_own ON comments;
CREATE POLICY comments_update_own ON comments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS comments_delete_own ON comments;
CREATE POLICY comments_delete_own ON comments
  FOR DELETE USING (auth.uid() = user_id);

-- Add the table to the realtime publication so the
-- /reviews/:id/comments page can subscribe to live INSERTs. Wrapped in
-- a DO block so re-runs don't error when the table is already added.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE comments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
