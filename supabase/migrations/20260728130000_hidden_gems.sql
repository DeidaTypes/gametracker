-- =====================================================================
-- Hidden gems — replaces "Because you played X"
-- =====================================================================
-- "Because you played X" anchored recs to ONE seed game and leaned on
-- IGDB similar_games, which kept surfacing popular titles the user
-- already knew — a mid-70s match % on a game everyone's heard of carries
-- no information. This migration retires that cache shape and replaces
-- it with `user_hidden_gems`: high-quality, low-rating-volume games
-- scoped to the genres/themes the user's OWN behavioral taste vector
-- (see 20260728120000_behavioral_taste_profile.sql — untouched by this
-- migration) actually shows affinity for. A niche-indie player gets
-- indies; a sports player gets sports; a horror fan gets horror.
--
-- Still written EXCLUSIVELY by the taste-engine Edge Function's daily
-- run (service role) — the UI never queries IGDB at read time, and a
-- user with too little behavioral signal simply gets no rows (the
-- section hides; it never falls back to generic popular games).
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. Retire the "Because you played" cache tables
-- ----------------------------------------------------------------------
-- CASCADE takes their RLS policies and indexes with them. Nothing else
-- in the schema references these — get_taste_match / get_user_taste_vector
-- read only from user_taste_vectors, which this migration does not touch.
DROP TABLE IF EXISTS public.user_recommendations CASCADE;
DROP TABLE IF EXISTS public.user_recommendation_seeds CASCADE;


-- ----------------------------------------------------------------------
-- 2. user_hidden_gems — precomputed "Hidden gems for you" cache
-- ----------------------------------------------------------------------
-- One row per (user, game) the daily job selected: total_rating >= the
-- engine's quality floor AND total_rating_count inside its "still
-- under-the-radar" band (see HIDDEN_GEM_MIN_RATING / _MIN_RATING_COUNT /
-- _MAX_RATING_COUNT in supabase/functions/taste-engine), sourced from one
-- of the user's own top-weighted genres or themes.
--
-- `matched_tag` names WHICH of the user's real affinities (a genre or
-- theme name straight out of user_taste_vectors.genre_weights /
-- theme_weights) this pick came from — so the UI/QA can show and verify
-- "this is here because you play Sport", never an invented reason.
-- `rank` orders the user's full cached pool (strongest quality/affinity
-- first); the client reads fixed-size slices and rotates through rank
-- order on refresh — no re-derivation, no IGDB call.
CREATE TABLE IF NOT EXISTS public.user_hidden_gems (
  user_id            uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  igdb_game_id       bigint  NOT NULL,
  game_title         text,
  game_image         text,
  genre_names        text[]  NOT NULL DEFAULT '{}',
  matched_tag        text,
  total_rating       numeric NOT NULL,
  total_rating_count integer NOT NULL,
  rank               integer NOT NULL DEFAULT 0,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, igdb_game_id)
);

CREATE INDEX IF NOT EXISTS user_hidden_gems_user_rank_idx
  ON public.user_hidden_gems (user_id, rank);

COMMENT ON TABLE public.user_hidden_gems IS
  'Precomputed "Hidden gems for you": high total_rating + low total_rating_count games scoped to the genres/themes the user''s taste vector actually shows affinity for. Written only by the taste-engine Edge Function (service role). UI reads from here and rotates through cached rank order — never queries IGDB per load.';


-- ----------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------
-- Writes come exclusively from the Edge Function using the service_role
-- key, which bypasses RLS — no write policy is added, so every
-- authenticated/anon client is read-only by omission. Private: a user
-- reads only their own cached gems.
ALTER TABLE public.user_hidden_gems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_hidden_gems_select_own ON public.user_hidden_gems;
CREATE POLICY user_hidden_gems_select_own ON public.user_hidden_gems
  FOR SELECT USING (auth.uid() = user_id);
