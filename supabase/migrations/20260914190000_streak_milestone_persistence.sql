-- Migration: streak milestone persistence (S16-2)
--
-- Moves "which streak milestones has this user reached, and have they been
-- celebrated yet" from localStorage (S16-1's gt:milestone-seen:v1:{userId}:
-- {milestone} key) to the server, so the state survives reinstall/relaunch
-- and is readable cross-device and by other users (for profile flair).
--
-- DECISION (S16-2 task 6): a milestone celebrates ONCE PER USER, EVER — not
-- once per crossing. `reached_at` is written the first time current_streak
-- crosses a tier and is NEVER cleared or re-written on a later reset +
-- re-cross of the same tier (rows are inserted with ON CONFLICT DO NOTHING
-- from the client — see recordStreakMilestoneProgress in
-- streakMilestoneService.js). So a user who drops from day 8 back to day 0
-- and climbs back through day 7 (Ember) a second time is NOT re-congratulated
-- — getPendingCelebrations only ever returns rows with celebrated_at IS NULL.

CREATE TABLE IF NOT EXISTS user_streak_milestones (
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_days integer     NOT NULL,
  reached_at     timestamptz NOT NULL DEFAULT now(),
  celebrated_at  timestamptz,
  PRIMARY KEY (user_id, milestone_days)
);

ALTER TABLE user_streak_milestones ENABLE ROW LEVEL SECURITY;

-- Readable by everyone (authenticated) — Profile flair (task 5) and the
-- review/Pulse author badge need to read OTHER users' reached milestones.
-- Same public-read shape as user_badges_select_all.
CREATE POLICY "user_streak_milestones_select_all"
  ON user_streak_milestones FOR SELECT USING (true);

-- Users may only write their own rows.
CREATE POLICY "user_streak_milestones_insert_own"
  ON user_streak_milestones FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_streak_milestones_update_own"
  ON user_streak_milestones FOR UPDATE USING (auth.uid() = user_id);

-- Denormalized cache of the highest milestone ever reached (independent of
-- the CURRENT streak, which can drop below it) — the flair source for
-- reviews/Pulse. Kept in sync by recordStreakMilestoneProgress() whenever a
-- new high is recorded, so those surfaces read it straight off the SAME
-- `users!..._fkey(...)` embed they already select, with no extra join.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS highest_streak_milestone integer;
