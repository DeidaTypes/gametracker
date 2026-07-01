-- =====================================================================
-- Taste Engine — server-side taste vectors + recommendations
-- Sprint: recommendation engine (24B); multi-seed cache (24C)
-- =====================================================================
-- Run this once in the Supabase SQL editor OR via
--   supabase db query --linked -f supabase/taste_engine.sql
-- Idempotent: every statement is guarded (IF NOT EXISTS /
-- CREATE OR REPLACE) so re-running is safe. Includes a one-time DO block
-- that migrates the original single-seed `user_recommendations` shape
-- (24B: one merged top-20 list per user) to the multi-seed shape (24C:
-- each of the user's top 10-15 seeds keeps its own independently-cached
-- rec list) for any environment that already has the old columns.
--
-- This file owns four cache tables + two read RPCs. NOTHING here is
-- fabricated — every row is derived from real `reviews` / `game_trackers`
-- data mapped to real IGDB genre/theme metadata by the `taste-engine`
-- Edge Function. When a user has too little data the engine writes
-- nothing, so the read APIs return empty / null rather than an invented
-- guess.
--
--   1. `game_tags`                 — IGDB metadata cache (genres, themes,
--                                    similar_games, quality) keyed by IGDB
--                                    id. Populated server-side so the UI
--                                    never queries IGDB per page load.
--   2. `user_taste_vectors`        — normalized genre/theme affinity
--                                    vector per user + a confidence score.
--   3. `user_recommendation_seeds` — the user's top 10-15 rated/played
--                                    games currently qualifying as seeds,
--                                    ordered by weight (seed_rank 1 =
--                                    strongest), one row per seed.
--   4. `user_recommendations`      — precomputed "Because you played X"
--                                    picks, keyed by (user, seed, game) so
--                                    EVERY seed keeps its own independent
--                                    ~10-20-game rec list, not one merged
--                                    list per user.
--   5. RPC get_taste_match(a,b)      — 0–100 score + per-genre breakdown
--                                       from two vectors; null below the
--                                       confidence threshold.
--   6. RPC get_user_taste_vector(u)  — read one user's vector.
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. game_tags — IGDB metadata cache
-- ----------------------------------------------------------------------
-- One row per IGDB game the engine has ever needed. `fetched_at` lets the
-- engine skip re-fetching fresh rows (7-day TTL) so a daily refresh over a
-- growing library still respects IGDB's ≤4 req/s ceiling.
CREATE TABLE IF NOT EXISTS public.game_tags (
  igdb_game_id       bigint PRIMARY KEY,
  name               text,
  cover_image_id     text,
  genre_ids          integer[]  NOT NULL DEFAULT '{}',
  genre_names        text[]     NOT NULL DEFAULT '{}',
  theme_ids          integer[]  NOT NULL DEFAULT '{}',
  theme_names        text[]     NOT NULL DEFAULT '{}',
  similar_game_ids   bigint[]   NOT NULL DEFAULT '{}',
  total_rating       numeric,
  total_rating_count integer,
  fetched_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_tags IS
  'IGDB genre/theme/similar/quality metadata cache. Written only by the taste-engine Edge Function (service role). Read-only to clients.';


-- ----------------------------------------------------------------------
-- 2. user_taste_vectors — normalized affinity vector per user
-- ----------------------------------------------------------------------
-- genre_weights / theme_weights are L2-NORMALIZED jsonb maps
--   { "Role-playing (RPG)": 0.63, "Adventure": 0.41, ... }
-- so cosine similarity between two users is a plain dot product.
--
-- `signal_count` = number of distinct rated/tracked games that resolved
-- to real IGDB tags — the input to `confidence`. `confidence` in [0,1]
-- ramps to 1.0 at TASTE_CONFIDENCE_FULL (8) signal games.
CREATE TABLE IF NOT EXISTS public.user_taste_vectors (
  user_id            uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  genre_weights      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  theme_weights      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  top_rated_game_ids bigint[] NOT NULL DEFAULT '{}',
  rated_game_count   integer NOT NULL DEFAULT 0,
  tracked_game_count integer NOT NULL DEFAULT 0,
  signal_count       integer NOT NULL DEFAULT 0,
  confidence         numeric NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_taste_vectors IS
  'Per-user L2-normalized genre/theme affinity vectors. Written only by the taste-engine Edge Function. Derived purely from public review + tracker data.';


-- ----------------------------------------------------------------------
-- 3. user_recommendation_seeds — the user's current seed set
-- ----------------------------------------------------------------------
-- One row per (user, seed game) the daily job selected as a "Because you
-- played X" anchor — the user's top 10-15 highest-weighted rated/tracked
-- games that resolved to IGDB tags (fewer if the user has rated fewer
-- games; table is empty when zero qualify). `seed_rank` orders seeds by
-- weight (1 = strongest) so the client can round-robin/weight the
-- rotation without re-deriving it from user_recommendations. `rec_count`
-- lets the client skip a seed whose rec list came back too thin.
CREATE TABLE IF NOT EXISTS public.user_recommendation_seeds (
  user_id      uuid   NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seed_game_id bigint NOT NULL,
  seed_title   text,
  seed_image   text,
  seed_weight  numeric NOT NULL DEFAULT 0,
  seed_rank    integer NOT NULL DEFAULT 0,
  rec_count    integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, seed_game_id)
);

CREATE INDEX IF NOT EXISTS user_recommendation_seeds_user_rank_idx
  ON public.user_recommendation_seeds (user_id, seed_rank);

COMMENT ON TABLE public.user_recommendation_seeds IS
  'The user''s current "Because you played X" seed set (up to 10-15 top-rated games), ordered by seed_rank. Written only by the taste-engine Edge Function. UI rotates through these — never queries IGDB per load.';


-- ----------------------------------------------------------------------
-- 4. user_recommendations — precomputed picks, keyed by (user, seed, game)
-- ----------------------------------------------------------------------
-- One row per (user, seed, recommended game) — every seed in
-- user_recommendation_seeds keeps its OWN independently-cached ~10-20-game
-- rec list, so the same candidate game can legitimately appear under
-- multiple seeds with different match scores. `seed_game_id/seed_title`
-- cite which seed this pick was derived from (that seed's similar_games
-- entry, or a genre/theme match sharing that seed's genre). `match_score`
-- is 0–100. `rank` is the pick's position within ITS seed's list (not
-- global), so each seed independently sorts best-first.
CREATE TABLE IF NOT EXISTS public.user_recommendations (
  user_id            uuid   NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seed_game_id       bigint NOT NULL,
  seed_title         text,
  igdb_game_id       bigint NOT NULL,
  match_score        numeric NOT NULL,
  game_title         text,
  game_image         text,
  genre_names        text[]  NOT NULL DEFAULT '{}',
  total_rating       numeric,
  total_rating_count integer,
  rank               integer NOT NULL DEFAULT 0,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, seed_game_id, igdb_game_id)
);

-- One-time migration from the 24B single-seed shape (PK on (user_id,
-- igdb_game_id); columns because_of_game_id/because_of_title) to the 24C
-- multi-seed shape, for any environment that already ran the old version
-- of this file. No-op on a fresh install (columns won't exist yet).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_recommendations'
      AND column_name = 'because_of_game_id'
  ) THEN
    -- Rows with no seed attribution can't survive the new NOT NULL column
    -- — the daily job fully replaces this table anyway, so it's safe to
    -- drop them rather than fabricate a seed.
    DELETE FROM public.user_recommendations WHERE because_of_game_id IS NULL;

    ALTER TABLE public.user_recommendations RENAME COLUMN because_of_game_id TO seed_game_id;
    ALTER TABLE public.user_recommendations RENAME COLUMN because_of_title TO seed_title;
    ALTER TABLE public.user_recommendations ALTER COLUMN seed_game_id SET NOT NULL;
    ALTER TABLE public.user_recommendations DROP CONSTRAINT IF EXISTS user_recommendations_pkey;
    ALTER TABLE public.user_recommendations ADD PRIMARY KEY (user_id, seed_game_id, igdb_game_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_recommendations_user_seed_rank_idx
  ON public.user_recommendations (user_id, seed_game_id, rank);

COMMENT ON TABLE public.user_recommendations IS
  'Precomputed per-user, per-seed recommendations ("Because you played X"), keyed by (user_id, seed_game_id, igdb_game_id) so every seed keeps its own independent rec list. Written only by the taste-engine Edge Function. UI reads from here — never queries IGDB per load.';


-- ----------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------
-- Writes to all four tables come exclusively from the Edge Function
-- using the service_role key, which bypasses RLS. So we add NO write
-- policies — every authenticated/anon client is read-only by omission.
--
--   game_tags                 → readable by anyone (public IGDB metadata).
--   user_taste_vectors        → readable by any authenticated user. The
--                               vectors are derived from PUBLIC reviews
--                               and contain only genre/theme affinities
--                               (not sensitive), and profile UIs surface
--                               another user's taste + taste-match.
--   user_recommendation_seeds → private: a user reads only their own
--                               seed set.
--   user_recommendations      → private: a user reads only their own
--                               per-seed picks.

ALTER TABLE public.game_tags                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_taste_vectors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recommendation_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recommendations      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_tags_select_all ON public.game_tags;
CREATE POLICY game_tags_select_all ON public.game_tags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS user_taste_vectors_select_auth ON public.user_taste_vectors;
CREATE POLICY user_taste_vectors_select_auth ON public.user_taste_vectors
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS user_recommendation_seeds_select_own ON public.user_recommendation_seeds;
CREATE POLICY user_recommendation_seeds_select_own ON public.user_recommendation_seeds
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_recommendations_select_own ON public.user_recommendations;
CREATE POLICY user_recommendations_select_own ON public.user_recommendations
  FOR SELECT USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------
-- 6. RPC get_user_taste_vector(target uuid)
-- ----------------------------------------------------------------------
-- Thin read helper so the client has a single, stable read surface.
-- SECURITY INVOKER (default) — respects the SELECT policy above.
CREATE OR REPLACE FUNCTION public.get_user_taste_vector(target uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'user_id',            v.user_id,
       'genre_weights',      v.genre_weights,
       'theme_weights',      v.theme_weights,
       'top_rated_game_ids', v.top_rated_game_ids,
       'rated_game_count',   v.rated_game_count,
       'tracked_game_count', v.tracked_game_count,
       'signal_count',       v.signal_count,
       'confidence',         v.confidence,
       'updated_at',         v.updated_at
     )
     FROM public.user_taste_vectors v
     WHERE v.user_id = target),
    NULL
  );
$$;


-- ----------------------------------------------------------------------
-- 7. RPC get_taste_match(user_a uuid, user_b uuid)
-- ----------------------------------------------------------------------
-- Returns a JSON object:
--   { "score": 0-100, "confidence": 0-1, "enough_data": true,
--     "shared_genre_count": n,
--     "genres": [ { "genre": "RPG", "strength": 0-100 }, ... ] }
-- OR, below the confidence threshold:
--   { "score": null, "enough_data": false, "reason": "...", "genres": [] }
--
-- Threshold (never a shaky guess):
--   • BOTH users must have signal_count >= 3   (MIN_SIGNAL)
--   • the two vectors must share >= 2 genres    (MIN_SHARED_GENRES)
--
-- Similarity:
--   Vectors are stored L2-normalized, so genre/theme cosine = dot product.
--   Overall = genre cosine when either theme vector is empty, else
--   0.75*genre + 0.25*theme. Score = round(overall * 100).
--
-- SECURITY DEFINER so the caller can compare ANY two users' vectors
-- (e.g. viewer ↔ profile owner) without needing row access to both.
CREATE OR REPLACE FUNCTION public.get_taste_match(user_a uuid, user_b uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MIN_SIGNAL        constant integer := 3;
  MIN_SHARED_GENRES constant integer := 2;

  va public.user_taste_vectors%ROWTYPE;
  vb public.user_taste_vectors%ROWTYPE;

  genre_dot   numeric := 0;
  theme_dot   numeric := 0;
  theme_a_ct  integer := 0;
  theme_b_ct  integer := 0;
  overall     numeric := 0;
  shared_ct   integer := 0;
  genres_json jsonb;
BEGIN
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'invalid_pair', 'genres', '[]'::jsonb);
  END IF;

  SELECT * INTO va FROM public.user_taste_vectors WHERE user_id = user_a;
  SELECT * INTO vb FROM public.user_taste_vectors WHERE user_id = user_b;

  IF va.user_id IS NULL OR vb.user_id IS NULL
     OR va.signal_count < MIN_SIGNAL OR vb.signal_count < MIN_SIGNAL THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'insufficient_data', 'genres', '[]'::jsonb);
  END IF;

  -- Genre cosine = dot product over shared keys (vectors pre-normalized).
  SELECT
    COALESCE(SUM((a.value)::numeric * (b.value)::numeric), 0),
    COUNT(*)
  INTO genre_dot, shared_ct
  FROM jsonb_each_text(va.genre_weights) a
  JOIN jsonb_each_text(vb.genre_weights) b ON a.key = b.key;

  IF shared_ct < MIN_SHARED_GENRES THEN
    RETURN jsonb_build_object('score', NULL, 'enough_data', false,
      'reason', 'too_few_shared_genres', 'genres', '[]'::jsonb);
  END IF;

  -- Theme cosine (only blended when BOTH users have theme signal).
  SELECT COUNT(*) INTO theme_a_ct FROM jsonb_object_keys(va.theme_weights);
  SELECT COUNT(*) INTO theme_b_ct FROM jsonb_object_keys(vb.theme_weights);

  IF theme_a_ct > 0 AND theme_b_ct > 0 THEN
    SELECT COALESCE(SUM((a.value)::numeric * (b.value)::numeric), 0)
    INTO theme_dot
    FROM jsonb_each_text(va.theme_weights) a
    JOIN jsonb_each_text(vb.theme_weights) b ON a.key = b.key;

    overall := 0.75 * genre_dot + 0.25 * theme_dot;
  ELSE
    overall := genre_dot;
  END IF;

  overall := GREATEST(0, LEAST(1, overall));

  -- Per-genre breakdown: shared genres by combined strength sqrt(wa*wb),
  -- top 6, expressed 0–100.
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'strength')::numeric DESC), '[]'::jsonb)
  INTO genres_json
  FROM (
    SELECT jsonb_build_object(
             'genre', a.key,
             'strength', round(100 * sqrt((a.value)::numeric * (b.value)::numeric))
           ) AS g
    FROM jsonb_each_text(va.genre_weights) a
    JOIN jsonb_each_text(vb.genre_weights) b ON a.key = b.key
    ORDER BY sqrt((a.value)::numeric * (b.value)::numeric) DESC
    LIMIT 6
  ) sub;

  RETURN jsonb_build_object(
    'score',              round(overall * 100),
    'confidence',         round(LEAST(va.confidence, vb.confidence)::numeric, 2),
    'enough_data',        true,
    'shared_genre_count', shared_ct,
    'genres',             genres_json
  );
END;
$$;

-- Allow both anon + authenticated clients to call the read RPCs.
GRANT EXECUTE ON FUNCTION public.get_user_taste_vector(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_taste_match(uuid, uuid)  TO anon, authenticated;
