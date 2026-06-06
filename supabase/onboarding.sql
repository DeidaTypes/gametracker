-- Sprint 7.6: First-time user onboarding flow
--
-- 1. Add onboarded_at column to track when a user first completed onboarding.
--    NULL  = new user who has not yet seen / completed the flow.
--    value = timestamp when they finished (or skipped) onboarding.
--
-- 2. Backfill existing users so they never see the onboarding screens.
--    The condition guards against accidental double-runs.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Backfill: treat every pre-existing row as already onboarded.
-- Only updates rows where the column is still NULL so a re-run is a no-op.
UPDATE users
SET onboarded_at = now()
WHERE onboarded_at IS NULL;
