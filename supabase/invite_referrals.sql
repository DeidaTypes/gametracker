-- Invite referral tracking.
--
-- One row per (inviter, invitee) pair. UNIQUE on invitee_id ensures
-- a single invitee cannot be claimed by multiple inviters (first writer
-- wins). The inviter_id FK is intentionally not restricted to "prior
-- existing users" — the inviter may have deleted their account.
--
-- Run once: Supabase SQL editor or `supabase db push`.

CREATE TABLE IF NOT EXISTS referrals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id    uuid        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  converted_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_inviter_id_idx
  ON referrals (inviter_id);

-- ── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Inviters read their own rows to compute their invite count.
CREATE POLICY "inviter can read own referrals"
  ON referrals FOR SELECT
  USING (auth.uid() = inviter_id);

-- The newly-signed-up user inserts their own conversion row.
-- inviter_id is supplied as data; RLS only enforces invitee_id.
CREATE POLICY "invitee can insert own referral"
  ON referrals FOR INSERT
  WITH CHECK (auth.uid() = invitee_id);
