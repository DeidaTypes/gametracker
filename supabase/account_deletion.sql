-- =====================================================================
-- Account deletion — Sprint 7.5
--
-- Implements soft-delete for Apple guideline compliance (apps with
-- in-app account creation must offer in-app deletion).
--
-- Strategy: mark deleted_at + scrub PII immediately; a separate
-- Supabase scheduled Edge Function (Sprint 8) hard-deletes rows older
-- than 30 days.
--
-- Run this in the Supabase SQL editor in order:
--   1. Schema changes (ALTER TABLE)
--   2. Updated RLS policies
-- =====================================================================

-- ─── 1. Schema ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

-- ─── 2. RLS — users table ─────────────────────────────────────────
-- Only expose rows that are not soft-deleted.
-- (Drop & recreate so re-runs are idempotent.)

DROP POLICY IF EXISTS users_select_public       ON users;
CREATE POLICY users_select_public ON users
  FOR SELECT USING (deleted_at IS NULL);

-- Owner can still read their own row even while deletion is pending so
-- the app can detect the pending state and show the recovery prompt.
DROP POLICY IF EXISTS users_select_own          ON users;
CREATE POLICY users_select_own ON users
  FOR SELECT USING (auth.uid() = id);

-- Only the owner may update their own non-deleted row. The
-- delete-account Edge Function runs as service_role and bypasses RLS.
DROP POLICY IF EXISTS users_update_own          ON users;
CREATE POLICY users_update_own ON users
  FOR UPDATE USING (auth.uid() = id AND deleted_at IS NULL);

-- Insert is used only by the sign-up flow.
DROP POLICY IF EXISTS users_insert_self         ON users;
CREATE POLICY users_insert_self ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ─── 3. RLS — reviews ─────────────────────────────────────────────
-- Reviews from deleted users stay (anonymised to "[deleted user]")
-- so other users' threads remain intact.  No change needed here —
-- the display_name in the users JOIN will already show "[deleted]"
-- once the Edge Function scrubs the PII.

-- ─── 4. RLS — comments ────────────────────────────────────────────
-- The Edge Function hard-deletes comments on account deletion, so
-- no comment rows survive to break the constraint. No policy change
-- needed — existing policies remain.

-- ─── 5. RLS — direct_messages ─────────────────────────────────────
-- The Edge Function hard-deletes all DMs. No policy change needed.

-- ─── 6. RLS — follows ─────────────────────────────────────────────
-- The Edge Function deletes follow rows. Existing policies remain.

-- ─── 7. RLS — likes ───────────────────────────────────────────────
-- The Edge Function deletes like rows. Existing policies remain.

-- ─── 8. Restoration function ──────────────────────────────────────
-- A lightweight RPC the client calls to restore a pending-deletion
-- account within the 30-day window.
CREATE OR REPLACE FUNCTION restore_deleted_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE users
  SET deleted_at = NULL, deletion_reason = NULL
  WHERE id = auth.uid()
    AND deleted_at IS NOT NULL
    AND deleted_at > now() - INTERVAL '30 days';
END;
$$;

-- Grant execute to authenticated users so the JS client can call it
-- via supabase.rpc('restore_deleted_account').
GRANT EXECUTE ON FUNCTION restore_deleted_account() TO authenticated;
