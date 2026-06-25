-- Migration: streak_freeze_weekly_token
--
-- Adds `freeze_week` (TEXT, ISO week string 'YYYY-Www') to user_streaks so
-- the freeze token can reset once per calendar week instead of being a
-- one-time-lifetime counter.
--
-- Weekly refresh logic (enforced client-side in streakMilestoneService.js):
--   If freezes_remaining = 0 AND freeze_week != current ISO week,
--   set freezes_remaining = 1 before applying gap math.
--
-- When a freeze is consumed:
--   freezes_remaining → 0, freeze_week → current ISO week.
--
-- Existing rows get freeze_week = NULL (treated as "a past week" by the
-- client, so they immediately receive a fresh token on next activity).

ALTER TABLE user_streaks
  ADD COLUMN IF NOT EXISTS freeze_week TEXT;
