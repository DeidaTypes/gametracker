-- =====================================================================
-- Discover — Curated Collections
--
-- Adds admin-seeded "by Checkpoint" curated list support on top of the
-- existing `lists` table. Curated rows are inserted directly in the
-- Supabase SQL editor (or via the service role) — never through the
-- app's normal create/update-list flow.
--
-- is_curated / curator_label are guarded by a trigger so an authenticated
-- user can never self-promote their own list into the Collections shelf
-- by calling updateList()/createList() (or a raw PostgREST request) from
-- the client. Only the SQL editor (current_user = postgres) or a
-- service-role request (current_user = service_role) may set them.
--
-- list_saves already exists (see supabase/list_interactions.sql, applied
-- 2026-06-25 / Sprint 8 prompt 16A) — verified present on the live
-- project, so it is NOT recreated here. Collections' "saved by N" counts
-- read directly from that table.
-- =====================================================================

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS is_curated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS curator_label text;

COMMENT ON COLUMN lists.is_curated IS
  'True for admin-seeded "by Checkpoint" collections. Set only via SQL editor / service role — see lists_guard_curated_fields trigger.';
COMMENT ON COLUMN lists.curator_label IS
  'Display label for a curated list''s curator (e.g. "Checkpoint"). Ignored for non-curated lists — those show the owner''s name.';

-- Fast lookup for the Discover Collections curated pool.
CREATE INDEX IF NOT EXISTS lists_curated_idx
  ON lists (is_curated, created_at DESC)
  WHERE is_curated = true;

-- ── Guard: only the SQL editor / service role may set curated fields ───

CREATE OR REPLACE FUNCTION lists_guard_curated_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- PostgREST runs authenticated app requests as the `authenticated` /
  -- `anon` Postgres role. Manual SQL-editor work and service-role
  -- requests run as `postgres` / `supabase_admin` / `service_role`.
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_curated := false;
      NEW.curator_label := NULL;
    ELSE
      NEW.is_curated := OLD.is_curated;
      NEW.curator_label := OLD.curator_label;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lists_guard_curated_fields_trg ON lists;
CREATE TRIGGER lists_guard_curated_fields_trg
  BEFORE INSERT OR UPDATE ON lists
  FOR EACH ROW
  EXECUTE FUNCTION lists_guard_curated_fields();

-- =====================================================================
-- Seeding a curated collection (run manually, one row per list):
--
--   UPDATE lists
--      SET is_curated = true,
--          curator_label = 'Checkpoint'
--    WHERE id = '<list-uuid>';
--
-- The list must already be public and have at least one game, or it
-- won't qualify for the Collections shelf (see getCollections() in
-- src/services/listService.js).
-- =====================================================================
