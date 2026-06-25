-- =====================================================================
-- Sprint 16 — list_collaborators
--
-- Adds a collaboration model to custom lists:
--   • list_collaborators — who may co-edit a list (owner manages)
--   • list_games RLS updated — owner OR collaborator may add/remove/reorder
--   • lists RLS updated — collaborators can also see private lists they
--     have been added to
--
-- Run in the Supabase SQL editor (or via `supabase db query`) before
-- exercising the collaboration UI.
-- =====================================================================

-- ── list_collaborators ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS list_collaborators (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid        NOT NULL REFERENCES lists(id)  ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  invited_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(list_id, user_id)
);

CREATE INDEX IF NOT EXISTS list_collaborators_list_idx
  ON list_collaborators(list_id);

CREATE INDEX IF NOT EXISTS list_collaborators_user_idx
  ON list_collaborators(user_id);

ALTER TABLE list_collaborators ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the collaborator list for a given list
-- (needed to render avatar row and resolve canEdit on the client)
DROP POLICY IF EXISTS list_collaborators_select ON list_collaborators;
CREATE POLICY list_collaborators_select ON list_collaborators
  FOR SELECT USING (true);

-- Only the list owner can add collaborators
DROP POLICY IF EXISTS list_collaborators_insert ON list_collaborators;
CREATE POLICY list_collaborators_insert ON list_collaborators
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
  );

-- Only the list owner can remove collaborators
DROP POLICY IF EXISTS list_collaborators_delete ON list_collaborators;
CREATE POLICY list_collaborators_delete ON list_collaborators
  FOR DELETE USING (
    auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
  );

-- ── lists — extend read access to collaborators ───────────────────────
-- Private lists are already visible to their owner. Collaborators also
-- need to see a private list they have been invited to.

DROP POLICY IF EXISTS lists_select ON lists;
CREATE POLICY lists_select ON lists
  FOR SELECT USING (
    is_public = true
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM list_collaborators lc
      WHERE lc.list_id = id AND lc.user_id = auth.uid()
    )
  );

-- ── list_games — extend write access to collaborators ─────────────────
-- The existing owner-only write policies are replaced by policies that
-- allow both the list owner and any confirmed collaborator.

-- Drop legacy owner-only policy names (created in earlier migrations)
DROP POLICY IF EXISTS list_games_insert_via_own_list ON list_games;
DROP POLICY IF EXISTS list_games_delete_via_own_list ON list_games;
DROP POLICY IF EXISTS list_games_update_via_own_list ON list_games;
DROP POLICY IF EXISTS list_games_select_via_parent_list ON list_games;

-- SELECT: open to anyone who can see the parent list (mirrors lists_select)
DROP POLICY IF EXISTS list_games_select ON list_games;
CREATE POLICY list_games_select ON list_games
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (
          l.is_public = true
          OR l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM list_collaborators lc
            WHERE lc.list_id = l.id AND lc.user_id = auth.uid()
          )
        )
    )
  );

-- INSERT: owner or collaborator
DROP POLICY IF EXISTS list_games_insert ON list_games;
CREATE POLICY list_games_insert ON list_games
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (
          l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM list_collaborators lc
            WHERE lc.list_id = l.id AND lc.user_id = auth.uid()
          )
        )
    )
  );

-- UPDATE: owner or collaborator (needed for position reordering)
DROP POLICY IF EXISTS list_games_update ON list_games;
CREATE POLICY list_games_update ON list_games
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (
          l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM list_collaborators lc
            WHERE lc.list_id = l.id AND lc.user_id = auth.uid()
          )
        )
    )
  );

-- DELETE: owner or collaborator
DROP POLICY IF EXISTS list_games_delete ON list_games;
CREATE POLICY list_games_delete ON list_games
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = list_id
        AND (
          l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM list_collaborators lc
            WHERE lc.list_id = l.id AND lc.user_id = auth.uid()
          )
        )
    )
  );
