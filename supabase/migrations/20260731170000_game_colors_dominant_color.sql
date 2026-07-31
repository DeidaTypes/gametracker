-- =====================================================================
-- Game colors — cached dominant/accent color per game, extracted once
-- =====================================================================
-- The Finish splash (CompletionCelebration) tints its eyebrow, cover
-- glow, and Done button with the color extracted from a game's cover
-- art. Extraction (canvas histogram, src/services/colorExtract.js) runs
-- client-side and is somewhat expensive (image decode + pixel scan), so
-- this table caches the result ONCE per game — shared across every user,
-- since the same cover art always produces the same color. The first
-- user to finish a game triggers the extraction and writes this row;
-- every subsequent finish (by anyone) reads the cached value instead of
-- re-extracting.
--
-- Stored as a "R G B" space-separated triple (matches the app's existing
-- --dominant-rgb CSS convention — see ReviewCard.css) rather than a hex
-- string, so it can feed straight into rgb()/rgba() without parsing.
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.game_colors (
  igdb_game_id   bigint PRIMARY KEY,
  dominant_color text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_colors IS
  'Cached dominant/accent color per game (igdb_game_id), extracted once from cover art and shared across all users. Written on first finish of a game whose color is null; read (never re-extracted) on every subsequent finish. dominant_color is a "R G B" space-separated triple.';

-- ----------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------
-- Not user-scoped data — every row is a deterministic function of a
-- game's cover art, so any authenticated user may read or cache a color.
ALTER TABLE public.game_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_colors_select_authenticated ON public.game_colors;
CREATE POLICY game_colors_select_authenticated ON public.game_colors
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS game_colors_insert_authenticated ON public.game_colors;
CREATE POLICY game_colors_insert_authenticated ON public.game_colors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS game_colors_update_authenticated ON public.game_colors;
CREATE POLICY game_colors_update_authenticated ON public.game_colors
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
