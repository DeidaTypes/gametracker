-- =====================================================================
-- blocked_users table — Sprint 7 Settings page
-- =====================================================================
-- Run this once in the Supabase SQL editor before the new block
-- entry points + content filters in the app are exercised.
--
-- The pair (blocker_id, blocked_id) is unique. The CHECK constraint
-- prevents a user from blocking themselves. Both FKs cascade on
-- account deletion so we never end up with orphan block rows.
--
-- RLS policies:
--   * SELECT: a user may only see rows where they are the blocker.
--   * INSERT: a user may only insert rows where they are the blocker.
--   * DELETE: a user may only delete rows where they are the blocker.
--   (no UPDATE — block rows are append-only / delete-only.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

CREATE INDEX IF NOT EXISTS block_blocker_idx ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS block_blocked_idx ON blocked_users(blocked_id);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS block_select_own ON blocked_users;
CREATE POLICY block_select_own ON blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS block_insert_self ON blocked_users;
CREATE POLICY block_insert_self ON blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS block_delete_own ON blocked_users;
CREATE POLICY block_delete_own ON blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);
