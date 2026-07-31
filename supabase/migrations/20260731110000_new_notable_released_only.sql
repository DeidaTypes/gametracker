-- =====================================================================
-- New & Notable — RELEASED games only, two-lane notability gate
-- =====================================================================
-- RUN MANUALLY (Supabase SQL editor, or
--   supabase db query --linked -f supabase/migrations/20260731110000_new_notable_released_only.sql
-- ). Nothing in this file runs automatically.
--
-- Supersedes the lane model in 20260730160000_new_notable.sql. The table,
-- its indexes and its RLS policy are unchanged; this migration narrows what
-- may live in it.
--
-- ── The problem this fixes ──────────────────────────────────────────────
-- The previous gate had a third lane, "anticipated", fed by a 120-day
-- LOOKAHEAD window: high `hypes` with no ratings yet. It worked exactly as
-- designed, and the design was wrong. Measured against the live cache
-- immediately before this change:
--
--   pool rows 130  (aaa 17, indie 40, anticipated 73)
--   42 of 130 pool rows were NOT YET RELEASED
--   8 of the 24 curated rail slots were NOT YET RELEASED — and because the
--     rail sorts by release date desc, those 8 were the FIRST 8 the user
--     saw: Grand Theft Auto VI (releases 2026-11-19), Marvel's Wolverine,
--     Phantom Blade 0, Control Resonant, Onimusha: Way of the Sword, The
--     Blood of Dawnwalker, Resonance: A Plague Tale Legacy, Beast of
--     Reincarnation.
--
-- A section called "New & Notable" whose first eight covers are games
-- nobody can play is a release calendar, not a discovery rail. Anticipation
-- no longer qualifies anything.
--
-- ── The new rule ────────────────────────────────────────────────────────
-- Two independent gates, in order (see supabase/functions/new-notable/
-- lanes.ts for the thresholds and the measurements behind them):
--
--   1. RELEASE GATE (hard)  first_release_date in the PAST, and a
--                           game_status that isn't Alpha/Beta/Cancelled/
--                           Rumored. No future dates, ever.
--   2. NOTABILITY GATE      then Lane A or Lane B, OR'd:
--        LANE A "aaa"    volume of attention — total_rating_count >= 30, or
--                        a recognized publisher with >= 10, or (for a game
--                        released in the last 21 days, too new to have
--                        ratings) real hypes with no bad early rating.
--        LANE B "indie"  quality over volume — total_rating >= 80 with a
--                        modest-but-real count (>= 3). No high count
--                        requirement: that is what wrongly excluded good
--                        indies.
--
-- `follows` is not used anywhere: IGDB never populates it (0 of 4310 games
-- in the measured window), so a follows-based rule would match nothing.
--
-- Measured after (released 90-day window, 4310 games past the release gate):
--   LANE A 12   LANE B 13   total 25   unreleased survivors 0
--
-- ── What this migration does ────────────────────────────────────────────
--   1. evict every row that the new gate would never write again
--   2. narrow the `lane` CHECK to the two surviving lanes
--   3. make "every pool row is a released game with a known date" a
--      database-level invariant
--   4. re-create get_new_notable() with a release guard in the read path,
--      so even a stale row can never surface an unreleased game
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. Evict rows the new gate rejects
-- ----------------------------------------------------------------------
-- The daily refresh would prune these on its next tick anyway (an upcoming
-- game can never be re-upserted, so it is stale by definition), but doing it
-- here means the section is correct the moment this file runs rather than
-- after the next 02:10 UTC job.
DELETE FROM public.new_notable_pool WHERE lane = 'anticipated';
DELETE FROM public.new_notable_pool WHERE release_date IS NULL OR release_date > now();


-- ----------------------------------------------------------------------
-- 2. Two lanes only
-- ----------------------------------------------------------------------
-- The original CHECK was declared inline, so its name was auto-generated.
-- Drop whatever check constraint currently governs `lane`, then add a named
-- one, so this file is idempotent and does not depend on that generated name.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'new_notable_pool'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%lane%'
  LOOP
    EXECUTE format('ALTER TABLE public.new_notable_pool DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE public.new_notable_pool
  ADD CONSTRAINT new_notable_pool_lane_check CHECK (lane IN ('aaa', 'indie'));


-- ----------------------------------------------------------------------
-- 3. Every pool row is a released game with a known date
-- ----------------------------------------------------------------------
-- A row with no release date can't be shown on a grid that sorts by release
-- date, and can't have passed a gate that requires a past date — so it is
-- always a bug, and the column can say so. The engine only ever writes a
-- non-null date (isReleased() rejects a missing/non-numeric
-- first_release_date before classification), so this cannot trip the daily
-- job.
--
-- The "released" half deliberately stays out of a CHECK: a CHECK expression
-- must be immutable, and `release_date <= now()` is not. It is enforced at
-- write time by the engine and again at read time in get_new_notable()
-- below.
ALTER TABLE public.new_notable_pool
  ALTER COLUMN release_date SET NOT NULL;

COMMENT ON TABLE public.new_notable_pool IS
  'Already-RELEASED recent games that cleared one of the two notability lanes (aaa = volume of attention, indie = quality above audience size) — see supabase/functions/new-notable/lanes.ts. Never contains unreleased/upcoming games: anticipation does not qualify a game for New & Notable. Refreshed daily by the new-notable Edge Function. Explore reads only from here: no live IGDB call on view. A game clearing neither lane is simply absent from this table.';

COMMENT ON COLUMN public.new_notable_pool.lane IS
  'aaa = Lane A, broad attention (rating volume, recognized publisher, or real buzz on a just-released title). indie = Lane B, acclaimed at modest volume. Checked A first, so a game with both volume and a high score is tagged aaa.';

COMMENT ON COLUMN public.new_notable_pool.lane_score IS
  'The raw signal the lane decision was made on: total_rating_count (aaa on volume), hypes (aaa on a just-released title with no ratings yet), or total_rating (indie). Comparable only within the same lane. QA/internal only, never rendered.';

COMMENT ON COLUMN public.new_notable_pool.hypes IS
  'IGDB pre-release interest counter. Retained as a SUPPORTING signal for a game released within the last few weeks that has no ratings yet — never as a reason to include an unreleased game.';


-- ----------------------------------------------------------------------
-- 4. RPC get_new_notable(target uuid)
-- ----------------------------------------------------------------------
-- The rail's single read surface. Returns the curated rail set (rail_rank
-- IS NOT NULL), reordered by the viewer's B1 taste vector — ORDER ONLY,
-- exactly like get_active_themed_drop(): a genre the viewer has never
-- touched scores 0 and sorts last, but nothing is ever removed, so no lane
-- and no genre can be taste-filtered out of existence. Falls back to the
-- engine's own rail_rank (release-date-driven) when the viewer has no taste
-- vector yet.
--
-- `release_date <= now()` is a belt-and-braces release guard: the pool
-- should never hold a future-dated row, and if a refresh ever regressed and
-- wrote one, the rail still would not show it. Cheap — the rail set is ~16
-- rows.
--
-- The see-all grid does NOT call this RPC — it reads new_notable_pool
-- directly, ordered by release_date desc, applying the same release guard.
-- That surface is intentionally not taste-ordered. See newNotableService.js.
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
      AND p.release_date <= now()
  ) sub;

  RETURN jsonb_build_object(
    'games',      games,
    'game_count', jsonb_array_length(games)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_new_notable(uuid) TO anon, authenticated;
