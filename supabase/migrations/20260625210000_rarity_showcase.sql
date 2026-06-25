-- Migration: badge rarity + showcase
-- Adds server-side badge holder tracking (for rarity %) and a
-- showcase_badges column so users can pin 3 badges on their profile.

-- ── 1. user_badges ────────────────────────────────────────────────────────
-- Persists each user's earned badge IDs so badge_rarity() can count
-- holders across all users.  The client (useBadgeUnlockWatcher) upserts
-- here whenever a badge is newly detected.

CREATE TABLE IF NOT EXISTS user_badges (
  user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  text        NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read counts (needed to compute rarity %).
CREATE POLICY "user_badges_select_all"
  ON user_badges FOR SELECT USING (true);

-- Users may only insert / delete their own rows.
CREATE POLICY "user_badges_insert_own"
  ON user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_badges_delete_own"
  ON user_badges FOR DELETE USING (auth.uid() = user_id);

-- ── 2. showcase_badges column on users ───────────────────────────────────
-- Ordered array of up to 3 badge IDs that appear in the "Showcase"
-- section at the top of a user's profile.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS showcase_badges text[] NOT NULL DEFAULT '{}';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS showcase_badges_max_3;

ALTER TABLE users
  ADD CONSTRAINT showcase_badges_max_3
  CHECK (array_length(showcase_badges, 1) IS NULL OR array_length(showcase_badges, 1) <= 3);

-- ── 3. badge_rarity() function ───────────────────────────────────────────
-- Returns per-badge holder counts and rarity percentages for display in
-- BadgeDetailModal and the UserBadgesPage grid.

CREATE OR REPLACE FUNCTION badge_rarity()
RETURNS TABLE(
  badge_id     text,
  holder_count bigint,
  total_users  bigint,
  rarity_pct   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ub.badge_id,
    COUNT(*)::bigint                                                          AS holder_count,
    (SELECT COUNT(*) FROM users)::bigint                                      AS total_users,
    ROUND(
      COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM users), 0),
      1
    )                                                                         AS rarity_pct
  FROM user_badges ub
  GROUP BY ub.badge_id;
$$;

GRANT EXECUTE ON FUNCTION badge_rarity() TO authenticated, anon;
