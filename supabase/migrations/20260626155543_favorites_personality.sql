-- Sprint 8: Favorites personality
-- Adds current_obsessions JSONB column to users.
-- The why field inside favorite_games entries is stored in the existing
-- favorite_games JSONB column; no schema change is needed for that field
-- since JSONB is schemaless and the column already exists.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_obsessions jsonb DEFAULT '[]'::jsonb;
