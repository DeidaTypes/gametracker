-- =====================================================================
-- Behavioral taste profile — E0 taste vector expansion
-- =====================================================================
-- BEFORE this migration the taste vector consumed exactly two signals:
--   • reviews.rating        (0-5 star scale)
--   • game_trackers.status  (flat STATUS_WEIGHT map) + game_trackers.rating
-- combined with max() per game and NO recency weighting. Everything else
-- the app already records was invisible to the engine, which produced a
-- reproducible bug: a user with play sessions but no ratings for a genre
-- got ZERO affinity in that genre (verified — a user with a logged
-- "FIFA 2001: Major League Soccer" session had no "Sport" key at all, and
-- a sessions-only user had no vector row whatsoever).
--
-- This migration widens the *storage* so the taste-engine Edge Function can
-- record an additive, recency-decayed profile over ALL behavioral signals:
--   hours played (strongest) > finished > review written > list curation >
--   backlog intent > swipe right, minus swipe left.
--
-- It owns three things:
--   1. New explanation/provenance columns on `user_taste_vectors` — per-genre
--      and per-theme contributing signal types, so a downstream section can
--      say WHY a genre scores (task 4) instead of showing a bare number.
--   2. A new `user_swipe_signals` table. Swipes were previously localStorage
--      only (`gt:swipes:v1`), which means the daily server-side job could not
--      physically read them. Without a durable table, "weight swipes into the
--      taste vector" is unimplementable server-side.
--   3. A rewritten `get_user_taste_vector` RPC exposing the new fields.
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. user_taste_vectors — signal provenance + per-signal-type totals
-- ----------------------------------------------------------------------
-- `genre_signals` / `theme_signals` answer "why does this genre score?".
-- Shape, one entry per genre the user has ANY real signal in:
--   {
--     "Sport": {
--       "affinity": 0.3142,          -- matches genre_weights[key]
--       "raw": 4.82,                 -- pre-normalization accumulated score
--       "games": 2,                  -- distinct games contributing
--       "signals": {                 -- recency-decayed points BY SOURCE
--         "hours": 3.10, "finished": 1.22, "backlog": 0.50
--       }
--     }
--   }
-- Only signal types that actually contributed appear in `signals` — an
-- absent key means that behavior genuinely never happened for this genre,
-- never a zero placeholder.
ALTER TABLE public.user_taste_vectors
  ADD COLUMN IF NOT EXISTS genre_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS theme_signals jsonb NOT NULL DEFAULT '{}'::jsonb;

-- `signal_totals` is the user-level roll-up of the same accumulation, so a
-- caller can say "this profile is mostly driven by hours played" without
-- summing the per-genre map:
--   { "hours": 41.2, "rating": 9.0, "review": 7.5, "list": 3.6,
--     "finished": 6.0, "backlog": 1.6, "swipe_right": 0.5, "swipe_left": -1.0 }
ALTER TABLE public.user_taste_vectors
  ADD COLUMN IF NOT EXISTS signal_totals jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Raw behavioral counters — honest denominators for the UI, and the inputs
-- to `confidence`. These are counts of REAL rows, not derived estimates.
ALTER TABLE public.user_taste_vectors
  ADD COLUMN IF NOT EXISTS hours_total       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS list_game_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lists_created     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finished_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backlog_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swipe_right_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swipe_left_count  integer NOT NULL DEFAULT 0;

-- Most recent contributing behavior of ANY type. Lets the UI say "as of your
-- session 2 days ago" and lets us reason about staleness independently of
-- `updated_at` (which is when the JOB last ran, not when the user last acted).
ALTER TABLE public.user_taste_vectors
  ADD COLUMN IF NOT EXISTS last_signal_at timestamptz;

COMMENT ON COLUMN public.user_taste_vectors.genre_signals IS
  'Per-genre provenance: { genre: { affinity, raw, games, signals: { hours|rating|review|list|finished|backlog|swipe_right|swipe_left: points } } }. Recency-decayed points by source, so downstream sections can explain a recommendation. Absent signal key = that behavior never happened for that genre.';
COMMENT ON COLUMN public.user_taste_vectors.signal_totals IS
  'User-level roll-up of recency-decayed points by signal type. Same keys as genre_signals[*].signals.';
COMMENT ON COLUMN public.user_taste_vectors.hours_total IS
  'Total real hours from play_sessions (falling back to game_trackers.hours_played for games with no session rows). Never estimated.';
COMMENT ON COLUMN public.user_taste_vectors.last_signal_at IS
  'Timestamp of the most recent contributing behavior of any type. Distinct from updated_at, which is when the daily job last ran.';


-- ----------------------------------------------------------------------
-- 2. user_swipe_signals — durable swipe history for the server-side engine
-- ----------------------------------------------------------------------
-- WHY this table exists: swipes lived exclusively in localStorage
-- (`gt:swipes:v1`). The taste engine runs as a scheduled Edge Function with
-- no browser, so left-swipes were structurally unreadable and right-swipes
-- were only visible indirectly (a right swipe also upserts a `want` tracker
-- row, which the engine mistook for a plain backlog add).
--
-- This is a SIGNAL MIRROR, not a relocation of ownership:
--   • localStorage remains the source of truth for deck exclusion + TTLs,
--     so the swipe deck keeps working offline and unauthenticated exactly
--     as before.
--   • This table is written best-effort by swipeService for signed-in users
--     and read only by the daily job. A failed write degrades the taste
--     signal slightly; it never blocks a swipe.
--
-- `action` mirrors SWIPE_ACTIONS in src/services/swipeService.js. It is
-- constrained rather than an enum so adding a future action is a one-line
-- migration and an unknown value can never silently poison the vector.
CREATE TABLE IF NOT EXISTS public.user_swipe_signals (
  user_id      uuid   NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  igdb_game_id bigint NOT NULL,
  action       text   NOT NULL
    CHECK (action IN ('backlog', 'skip', 'not_interested')),
  -- Denormalized so the engine can weight a swipe even before IGDB tag
  -- resolution catches up (the deck already has these on the card).
  genre_names  text[] NOT NULL DEFAULT '{}',
  theme_names  text[] NOT NULL DEFAULT '{}',
  swiped_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, igdb_game_id)
);

-- The engine scans a user's swipes newest-first and ignores ancient ones.
CREATE INDEX IF NOT EXISTS user_swipe_signals_user_swiped_idx
  ON public.user_swipe_signals (user_id, swiped_at DESC);

COMMENT ON TABLE public.user_swipe_signals IS
  'Server-visible mirror of the device-local swipe history (gt:swipes:v1), so the daily taste-engine job can weight swipe right/left. localStorage stays authoritative for deck exclusion; this table exists purely as a taste signal. One row per (user, game) — a later swipe overwrites an earlier one.';

ALTER TABLE public.user_swipe_signals ENABLE ROW LEVEL SECURITY;

-- Unlike the other engine tables, this one is CLIENT-WRITTEN (the browser
-- records the swipe), so it needs real write policies scoped to the owner.
-- Swipe history is private — it is never surfaced on another user's profile.
DROP POLICY IF EXISTS user_swipe_signals_select_own ON public.user_swipe_signals;
CREATE POLICY user_swipe_signals_select_own ON public.user_swipe_signals
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_swipe_signals_insert_own ON public.user_swipe_signals;
CREATE POLICY user_swipe_signals_insert_own ON public.user_swipe_signals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_swipe_signals_update_own ON public.user_swipe_signals;
CREATE POLICY user_swipe_signals_update_own ON public.user_swipe_signals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- "Reset discovery" in Settings clears local swipes; let it clear these too.
DROP POLICY IF EXISTS user_swipe_signals_delete_own ON public.user_swipe_signals;
CREATE POLICY user_swipe_signals_delete_own ON public.user_swipe_signals
  FOR DELETE USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------
-- 3. Engine scan indexes
-- ----------------------------------------------------------------------
-- The daily job now reads play_sessions and list_games for every user, so
-- give both a covering path. Guarded + IF NOT EXISTS: on an instance that
-- already has an equivalent index this is a cheap no-op.
CREATE INDEX IF NOT EXISTS play_sessions_user_game_idx
  ON public.play_sessions (user_id, igdb_game_id);

CREATE INDEX IF NOT EXISTS list_games_list_idx
  ON public.list_games (list_id);

CREATE INDEX IF NOT EXISTS activity_events_actor_type_idx
  ON public.activity_events (actor_user_id, type, created_at DESC);


-- ----------------------------------------------------------------------
-- 4. RPC get_user_taste_vector(target uuid) — now signal-aware
-- ----------------------------------------------------------------------
-- Adds the provenance + counter fields. Kept as a single jsonb return and
-- the same function signature so existing callers keep working; new keys are
-- purely additive. SECURITY INVOKER (default) — respects the SELECT policy.
CREATE OR REPLACE FUNCTION public.get_user_taste_vector(target uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT
    (SELECT jsonb_build_object(
       'user_id',            v.user_id,
       'genre_weights',      v.genre_weights,
       'theme_weights',      v.theme_weights,
       'genre_signals',      v.genre_signals,
       'theme_signals',      v.theme_signals,
       'signal_totals',      v.signal_totals,
       'top_rated_game_ids', v.top_rated_game_ids,
       'rated_game_count',   v.rated_game_count,
       'tracked_game_count', v.tracked_game_count,
       'hours_total',        v.hours_total,
       'session_count',      v.session_count,
       'reviewed_count',     v.reviewed_count,
       'list_game_count',    v.list_game_count,
       'lists_created',      v.lists_created,
       'finished_count',     v.finished_count,
       'backlog_count',      v.backlog_count,
       'swipe_right_count',  v.swipe_right_count,
       'swipe_left_count',   v.swipe_left_count,
       'signal_count',       v.signal_count,
       'confidence',         v.confidence,
       'last_signal_at',     v.last_signal_at,
       'updated_at',         v.updated_at
     )
     FROM public.user_taste_vectors v
     WHERE v.user_id = target);
$$;

GRANT EXECUTE ON FUNCTION public.get_user_taste_vector(uuid) TO anon, authenticated;
