-- =====================================================================
-- Sprint 6 P3 — Pinned reviews on Profile
--
-- Run this in the Supabase SQL editor BEFORE shipping the Profile
-- Pinned section. The pinService relies on the table + RLS policies
-- below.
--
-- A user may pin up to 3 of THEIR OWN reviews to the top of their
-- Profile Reviews tab. Order matters — `position` is the 0-indexed
-- slot, and the UNIQUE(user_id, position) constraint enforces "one
-- review per slot".
-- =====================================================================

CREATE TABLE IF NOT EXISTS review_pins (
  user_id     uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  review_id   uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 0 AND 2),
  pinned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, review_id),
  UNIQUE (user_id, position)
);

-- Profile fetch path: "every pin owned by $userId, ordered by slot".
CREATE INDEX IF NOT EXISTS review_pins_user_position_idx
  ON review_pins(user_id, position);

ALTER TABLE review_pins ENABLE ROW LEVEL SECURITY;

-- Public read — anyone (including signed-out viewers) can see which
-- reviews a user has pinned to their profile.
DROP POLICY IF EXISTS pins_select_all ON review_pins;
CREATE POLICY pins_select_all ON review_pins
  FOR SELECT USING (true);

-- Only the signed-in user may insert a pin, and only for one of THEIR
-- OWN reviews. The EXISTS subquery against `reviews` is the server-
-- side enforcement of the "can only pin your own reviews" rule — the
-- application layer hides the menu option but RLS is the source of
-- truth.
DROP POLICY IF EXISTS pins_insert_own_review ON review_pins;
CREATE POLICY pins_insert_own_review ON review_pins
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM reviews
      WHERE id = review_id AND user_id = auth.uid()
    )
  );

-- Reorder path: the user can shuffle the position of their own pins.
DROP POLICY IF EXISTS pins_update_self ON review_pins;
CREATE POLICY pins_update_self ON review_pins
  FOR UPDATE USING (auth.uid() = user_id);

-- Unpin path: only the owner can delete their own pin row.
DROP POLICY IF EXISTS pins_delete_self ON review_pins;
CREATE POLICY pins_delete_self ON review_pins
  FOR DELETE USING (auth.uid() = user_id);
