-- Migration: vibe stamps + life context on reviews
-- Adds two nullable columns to the reviews table.
--   vibe_stamp   — one-tap qualitative label (mutually exclusive)
--   life_context — "when in your life" tag for Diary grouping
--
-- Both columns are nullable so existing rows are unaffected.
-- The CHECK constraints mirror the app-level enums in reviewService.js.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS vibe_stamp text
    CHECK (vibe_stamp IN ('masterpiece', 'underrated', 'mid', 'rage_quit', 'comfort')),
  ADD COLUMN IF NOT EXISTS life_context text
    CHECK (life_context IN ('childhood', 'teen_years', 'college', 'burnout', 'healing', 'traveling', 'new_chapter'));
