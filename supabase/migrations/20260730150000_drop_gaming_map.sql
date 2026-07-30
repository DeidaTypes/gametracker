-- =====================================================================
-- Drop "Your Gaming Map" — replaced by Themed Drops + New & Notable
-- =====================================================================
-- RUN MANUALLY (Supabase SQL editor, or
--   supabase db query --linked -f supabase/migrations/20260730150000_drop_gaming_map.sql
-- ). Nothing in this file runs automatically, same as the G2 migration it
-- reverses (20260730130000_gaming_map.sql).
--
-- The whole map feature is gone from the client (the section, the tiered
-- tiles, the genre detail grid, Venture Out) and from the nightly job
-- (supabase/functions/taste-engine/gamingMap.ts is deleted, and
-- taste-engine/index.ts no longer calls it). Nothing reads or writes any
-- of these tables anymore, so they are dropped rather than left to go
-- stale with no writer.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
-- The B1 behavioral taste engine survives intact: `user_taste_vectors`,
-- get_user_taste_vector() and get_taste_match() are untouched, and the
-- taste-engine function still computes and writes vectors on every run.
-- Themed Drops orders its shelves by that vector, so it has to stay.
-- `game_tags` also stays — it is the shared metadata cache the taste
-- engine itself depends on, not map storage.
--
-- Verified before writing this migration:
--   • get_gaming_map was the ONLY routine in the schema referencing any of
--     these tables (checked against pg_proc.prosrc and pg_views).
--   • every inbound foreign key to igdb_genres came from the three map
--     tables below, so nothing outside this set loses a reference.
--   • Themed Drops keeps its own completion times on
--     drop_candidate_pool.time_to_beat_seconds and fetches them itself, so
--     dropping the map's game_time_to_beat cache costs it nothing.
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. RPC
-- ----------------------------------------------------------------------
-- Dropped ahead of the tables so the DROP TABLEs below don't have to rely
-- on CASCADE to reach it.
DROP FUNCTION IF EXISTS public.get_gaming_map(uuid);


-- ----------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------
-- CASCADE carries each table's RLS policies and indexes with it. Ordered
-- children-first so the igdb_genres drop is not doing the cascading work.

-- Tier storage + its genre-resolution backfill queue.
DROP TABLE IF EXISTS public.user_gaming_map_meta CASCADE;
DROP TABLE IF EXISTS public.user_gaming_map      CASCADE;

-- Per-user Venture Out pools, then the global per-genre pools they were
-- derived from.
DROP TABLE IF EXISTS public.user_genre_pools     CASCADE;
DROP TABLE IF EXISTS public.genre_game_pools     CASCADE;

-- Completion-time cache. Added by the G2 migration purely to feed on-ramp
-- accessibility scoring, and gamingMap.ts was its only reader and writer.
DROP TABLE IF EXISTS public.game_time_to_beat    CASCADE;

-- The fixed 23-genre reference list. Created solely as the map's genre
-- spine and FK target; the three tables above were its only referents.
-- Themed Drops matches on raw IGDB genre ids and never joined to it.
DROP TABLE IF EXISTS public.igdb_genres          CASCADE;


-- ----------------------------------------------------------------------
-- 3. Stale documentation left in DB data
-- ----------------------------------------------------------------------
-- drop_filter_types.notes is surfaced to whoever composes a theme, so the
-- genre filter's note must stop pointing at a table that no longer exists.
-- The same text is corrected at its source in the themed-drops seed, whose
-- INSERT upserts on conflict — this UPDATE is only so an already-migrated
-- database gets the fix without re-running that whole migration.
UPDATE public.drop_filter_types
   SET notes = 'Formal IGDB genre ids, as carried on drop_candidate_pool.genre_ids. Densely populated: every game with any metadata has genres.'
 WHERE key = 'genre';
