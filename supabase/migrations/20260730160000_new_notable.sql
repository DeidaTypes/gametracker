-- =====================================================================
-- New & Notable — three-lane notability gate
-- =====================================================================
-- RUN MANUALLY (Supabase SQL editor, or
--   supabase db query --linked -f supabase/migrations/20260730160000_new_notable.sql
-- ). Nothing in this file runs automatically.
--
-- ── The problem this replaces ───────────────────────────────────────────
-- Discover's "New & Notable" rail used to be date-only: any recent release
-- with a cover qualified, no quality/attention gate at all. Measured against
-- live IGDB (scripts/diagnose-new-notable.mjs), 17 of the 20 games on a
-- freshly-loaded rail had ZERO total_rating_count AND ZERO hypes — titles
-- like "Room 0" and "Ludus: A Gladiator Story" that nobody has rated,
-- reviewed, or expressed any interest in. "Notable" meant nothing.
--
-- ── The fix: three lanes, OR'd together ─────────────────────────────────
-- A recent game (released -180d..now, or anticipated now..+120d) qualifies
-- if it clears ANY ONE of three lanes — see supabase/functions/new-notable/
-- lanes.ts for the exact thresholds and the reasoning behind each number:
--
--   LANE A "aaa"          high total_rating_count (volume of attention),
--                         optionally reinforced by a recognized publisher
--   LANE B "indie"        high total_rating with a MODEST count — quality
--                         punching above its audience size, no count floor
--   LANE C "anticipated"  high hypes with few/zero ratings — buzz before
--                         reviews exist (covers both "about to release"
--                         and "just launched, too new to be rated yet")
--
-- Games clearing NONE of the three are excluded outright — that is the
-- actual fix. A game clearing exactly one lane is tagged with that lane so
-- the client can show a small "Popular" / "Acclaimed" / "Hyped" pill.
--
-- ── Why a cache table, not a live IGDB query ────────────────────────────
-- Same principle as drop_candidate_pool: classifying a game into a lane
-- needs total_rating, total_rating_count, hypes AND involved_companies —
-- four extra IGDB round-trip fields per game, times thousands of candidates
-- in the window, every time someone opens Explore. Instead the
-- new-notable Edge Function classifies once a day and writes the result
-- here; both the rail and its see-all page are then plain Postgres reads.
--
-- Tables:
--   1. new_notable_pool   every recent/anticipated game that cleared a lane
--   2. RLS                world-readable, engine-only writes
--   3. RPC get_new_notable()   taste-ordered rail read (order only)
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. new_notable_pool
-- ----------------------------------------------------------------------
-- One row per game that cleared ANY lane. NOT a mirror of recent IGDB
-- releases — a game that clears no lane is never written here at all, so
-- "is it notable?" is answered by row existence, not a flag to check.
--
-- `release_date` is a real timestamptz (not just a year) because the
-- see-all grid sorts newest-first at day granularity, and this window is
-- narrow enough (recent months) that a year alone would leave most rows
-- tied.
--
-- `rail_rank` is the engine's pre-taste curation for the LIMITED rail
-- (top games per lane, interleaved, re-sorted to release date desc) — NULL
-- for every pool row that didn't make that cut. The see-all grid ignores
-- this column entirely and reads the WHOLE pool ordered by release_date;
-- rail_rank exists purely so get_new_notable() has a small, pre-balanced
-- set to taste-reorder without re-deriving lane balance per request.
--
-- `lane_score` is the raw signal the lane was chosen on (total_rating_count
-- for aaa, total_rating for indie, hypes for anticipated) — comparable only
-- WITHIN a lane, used to pick the rail's top-N-per-lane. Not shown to users.
CREATE TABLE IF NOT EXISTS public.new_notable_pool (
  igdb_game_id            bigint PRIMARY KEY,
  name                    text,
  cover_image_id          text,
  release_date            timestamptz,
  total_rating            numeric,
  total_rating_count      integer,
  hypes                   integer,
  has_recognized_publisher boolean NOT NULL DEFAULT false,
  genre_ids               integer[] NOT NULL DEFAULT '{}',
  genre_names             text[]    NOT NULL DEFAULT '{}',
  lane                    text NOT NULL CHECK (lane IN ('aaa', 'indie', 'anticipated')),
  lane_score              numeric,
  rail_rank               integer,
  refreshed_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS new_notable_pool_release_idx
  ON public.new_notable_pool (release_date DESC);

CREATE INDEX IF NOT EXISTS new_notable_pool_rail_idx
  ON public.new_notable_pool (rail_rank)
  WHERE rail_rank IS NOT NULL;

CREATE INDEX IF NOT EXISTS new_notable_pool_lane_idx
  ON public.new_notable_pool (lane);

COMMENT ON TABLE public.new_notable_pool IS
  'Recent/anticipated games that cleared ANY of the three notability lanes (aaa / indie / anticipated) — see supabase/functions/new-notable/lanes.ts. Refreshed daily by the new-notable Edge Function. Explore reads only from here: no live IGDB call on view. A game clearing NO lane is simply absent from this table.';

COMMENT ON COLUMN public.new_notable_pool.rail_rank IS
  'Pre-taste order for the LIMITED rail (top-N per lane, interleaved, sorted by release_date). NULL = in the pool (visible on the see-all grid) but not curated into the rail. get_new_notable() reorders rail rows by viewer taste with this as the tiebreak.';

COMMENT ON COLUMN public.new_notable_pool.lane_score IS
  'The raw signal the lane decision was made on: total_rating_count (aaa), total_rating (indie), or hypes (anticipated). Comparable only within the same lane. QA/internal only, never rendered.';


-- ----------------------------------------------------------------------
-- 2. Row Level Security
-- ----------------------------------------------------------------------
-- Global, non-personal, IGDB-derived content — world-readable. Writes come
-- exclusively from the new-notable Edge Function under the service role
-- (bypasses RLS); no write policy exists, so every client is read-only.
ALTER TABLE public.new_notable_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS new_notable_pool_select_all ON public.new_notable_pool;
CREATE POLICY new_notable_pool_select_all ON public.new_notable_pool
  FOR SELECT USING (true);


-- ----------------------------------------------------------------------
-- 3. RPC get_new_notable(target uuid)
-- ----------------------------------------------------------------------
-- The rail's single read surface. Returns the curated rail set (rail_rank
-- IS NOT NULL), reordered by the viewer's B1 taste vector — ORDER ONLY,
-- exactly like get_active_themed_drop(): a genre the viewer has never
-- touched scores 0 and sorts last, but nothing is ever removed, so no lane
-- and no genre can be taste-filtered out of existence. Falls back to the
-- engine's own rail_rank (release-date-driven) when the viewer has no
-- taste vector yet.
--
-- The see-all grid does NOT call this RPC — it reads new_notable_pool
-- directly, ordered by release_date desc, because that surface is
-- intentionally NOT taste-ordered (task requirement: chronological, same
-- gate). See newNotableService.js.
--
-- SECURITY INVOKER: new_notable_pool is world-readable and
-- user_taste_vectors is read here only for `target`, which is auth.uid()
-- by default.
CREATE OR REPLACE FUNCTION public.get_new_notable(target uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tv    jsonb := '{}'::jsonb;
  games jsonb;
BEGIN
  IF target IS NOT NULL THEN
    SELECT COALESCE(genre_weights, '{}'::jsonb) INTO tv
    FROM public.user_taste_vectors WHERE user_id = target;
  END IF;
  tv := COALESCE(tv, '{}'::jsonb);

  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'taste_score')::numeric DESC, (g->>'rail_rank')::int ASC), '[]'::jsonb)
  INTO games
  FROM (
    SELECT jsonb_build_object(
      'igdb_game_id', p.igdb_game_id,
      'rail_rank',    p.rail_rank,
      'title',        p.name,
      'cover_image_id', p.cover_image_id,
      'release_date', p.release_date,
      'lane',         p.lane,
      'genre_names',  p.genre_names,
      'taste_score',  (
        SELECT COALESCE(SUM(COALESCE((tv ->> gn)::numeric, 0)), 0)
        FROM unnest(p.genre_names) AS gn
      )
    ) AS g
    FROM public.new_notable_pool p
    WHERE p.rail_rank IS NOT NULL
  ) sub;

  RETURN jsonb_build_object(
    'games',      games,
    'game_count', jsonb_array_length(games)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_new_notable(uuid) TO anon, authenticated;
