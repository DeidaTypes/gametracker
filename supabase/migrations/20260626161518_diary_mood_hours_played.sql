-- Migration: diary_mood_hours_played
-- Adds mood and hours_played columns to journal_entries.
-- These fields power cinematic diary entries and the Wrapped annual recap feed.

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS mood text
    CHECK (mood IN ('pumped','chill','frustrated','amazed','tired','in_love')),
  ADD COLUMN IF NOT EXISTS hours_played numeric(5,1)
    CHECK (hours_played >= 0 AND hours_played <= 999);

COMMENT ON COLUMN journal_entries.mood IS
  'How the user felt while playing: pumped | chill | frustrated | amazed | tired | in_love';

COMMENT ON COLUMN journal_entries.hours_played IS
  'Hours played in this session/since last entry. Used by Wrapped for annual totals.';
