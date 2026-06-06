-- =====================================================================
-- users-table columns for cross-device Settings sync — Sprint 7
-- =====================================================================
-- Adds three optional columns the Settings page best-effort syncs
-- to. The app is fully functional without this migration applied
-- (settings still persist in localStorage on the same device); this
-- file enables sync across devices for the same account.
--
-- Note: RLS on the `users` table is unchanged — only schema columns
-- are added. The Settings page's writes go through the existing
-- profile-update RLS policies (auth.uid() = id).
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS color_blind_mode text
    CHECK (color_blind_mode IN ('off', 'deutan', 'protan', 'tritan'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS message_privacy text
    CHECK (message_privacy IN ('everyone', 'follows', 'nobody'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activity_privacy text
    CHECK (activity_privacy IN ('everyone', 'followers', 'me'));
