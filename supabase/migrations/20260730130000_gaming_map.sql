-- =====================================================================
-- Your Gaming Map — G2 data layer
-- =====================================================================
-- RUN MANUALLY before testing (Supabase SQL editor, or
--   supabase db query --linked -f supabase/migrations/20260730130000_gaming_map.sql
-- ). Nothing in this file runs automatically.
--
-- Backing store for "Your Gaming Map": the user's 23 formal IGDB genres
-- sorted into four tiers (HOME TURF / EXPLORING / ON THE HORIZON / NOT
-- YET), plus the per-genre game pools the map's detail grid and "Venture
-- Out" read from.
--
-- Two hard rules this schema exists to enforce:
--
--   1. We cache POOLS, never IGDB's catalog. `genre_game_pools` holds at
--      most GENRE_POOL_SIZE games per (genre, sort) — a few thousand rows
--      total, refreshed by the existing daily job. Scrolling past the
--      cached pool paginates LIVE against IGDB from the client; it does
--      not deepen the cache.
--
--   2. No routine read touches IGDB. The pool tables are written by the
--      `taste-engine` Edge Function under the service role (which bypasses
--      RLS), and clients are read-only on them by omission. The two
--      per-user tables — `user_gaming_map` and `user_gaming_map_meta` —
--      are the exceptions: the client writes its own rows there, because
--      the library's primary store is localStorage and the browser is the
--      only place a user's full library exists. See §7.
--
-- FORMAL GENRES ONLY. Community keywords ("Soulslike", "cozy") are sparse
-- and inconsistently applied — a genre map built on them would have holes
-- that look like user behavior but are really missing metadata. IGDB's
-- formal `genres` field is complete for every game that has any metadata
-- at all, which is what makes "you have never played a Racing game" a
-- statement we can actually stand behind.
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. igdb_genres — the fixed formal genre list (reference data)
-- ----------------------------------------------------------------------
-- IGDB's /genres endpoint returned exactly these 23 rows when this
-- migration was written, and this list has been stable for years. It is
-- SEEDED, not synced: there is deliberately no job watching IGDB for new
-- genres. A new genre would change what the map means (every existing
-- user would silently gain a NOT YET tile), so that should be a human
-- decision — re-run this seed by hand if IGDB ever adds one.
--
-- `sort_order` is the map's canonical display order, so the tiles don't
-- reshuffle between renders. It follows IGDB's own id order, which groups
-- the older//broader genres first.
CREATE TABLE IF NOT EXISTS public.igdb_genres (
  id         integer PRIMARY KEY,   -- IGDB genre id (ids are sparse: 2..36)
  name       text NOT NULL,         -- exact IGDB name; matches game_tags.genre_names
  slug       text NOT NULL,         -- exact IGDB slug; safe for URLs
  sort_order integer NOT NULL
);

COMMENT ON TABLE public.igdb_genres IS
  'The 23 formal IGDB genres, seeded by hand. Reference data, NOT synced — IGDB adding a genre should be a deliberate human change, not a silent one. `name` matches game_tags.genre_names and user_taste_vectors.genre_weights keys exactly, which is what lets the map join taste affinity to a genre id.';

INSERT INTO public.igdb_genres (id, name, slug, sort_order) VALUES
  (2,  'Point-and-click',              'point-and-click',            1),
  (4,  'Fighting',                     'fighting',                   2),
  (5,  'Shooter',                      'shooter',                    3),
  (7,  'Music',                        'music',                      4),
  (8,  'Platform',                     'platform',                   5),
  (9,  'Puzzle',                       'puzzle',                     6),
  (10, 'Racing',                       'racing',                     7),
  (11, 'Real Time Strategy (RTS)',     'real-time-strategy-rts',     8),
  (12, 'Role-playing (RPG)',           'role-playing-rpg',           9),
  (13, 'Simulator',                    'simulator',                 10),
  (14, 'Sport',                        'sport',                     11),
  (15, 'Strategy',                     'strategy',                  12),
  (16, 'Turn-based strategy (TBS)',    'turn-based-strategy-tbs',   13),
  (24, 'Tactical',                     'tactical',                  14),
  (25, 'Hack and slash/Beat ''em up',  'hack-and-slash-beat-em-up', 15),
  (26, 'Quiz/Trivia',                  'quiz-trivia',               16),
  (30, 'Pinball',                      'pinball',                   17),
  (31, 'Adventure',                    'adventure',                 18),
  (32, 'Indie',                        'indie',                     19),
  (33, 'Arcade',                       'arcade',                    20),
  (34, 'Visual Novel',                 'visual-novel',              21),
  (35, 'Card & Board Game',            'card-and-board-game',       22),
  (36, 'MOBA',                         'moba',                      23)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      sort_order = EXCLUDED.sort_order;


-- ----------------------------------------------------------------------
-- 2. game_time_to_beat — completion-time cache, for on-ramp ranking
-- ----------------------------------------------------------------------
-- On-ramp ranking needs "how long is this to finish", which lives on
-- IGDB's game_time_to_beats endpoint, not on /games.
--
-- Its own table rather than columns on `game_tags` on purpose. game_tags
-- rows are only meaningful once genres/themes are populated, and
-- resolveTags() treats any row newer than its TTL as authoritative — so
-- inserting a genre-less row there just to record a completion time would
-- make the taste engine believe that game has NO genres for a week. A
-- separate table can't poison anything.
--
-- A row with NULL `seconds` is a real answer: IGDB has no community time
-- for that game. Storing it (rather than leaving the row absent) is what
-- stops the daily job re-asking about the same thousands of games every
-- night. The on-ramp scorer reads NULL as unknown and scores it neutrally
-- instead of guessing a length.
--
-- Long TTL by nature: ratings move weekly, but a released game's
-- completion time essentially never changes.
CREATE TABLE IF NOT EXISTS public.game_time_to_beat (
  igdb_game_id bigint PRIMARY KEY,
  seconds      integer,  -- IGDB game_time_to_beats.normally; NULL = none published
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_time_to_beat IS
  'IGDB game_time_to_beats.normally, in seconds, per game. NULL seconds = IGDB publishes no community completion time (an honest unknown, not zero) — the row exists so the daily job does not re-ask nightly. Written only by the taste-engine Edge Function.';

ALTER TABLE public.game_time_to_beat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_time_to_beat_select_all ON public.game_time_to_beat;
CREATE POLICY game_time_to_beat_select_all ON public.game_time_to_beat
  FOR SELECT USING (true);


-- ----------------------------------------------------------------------
-- 3. genre_game_pools — the cached per-genre grid pool
-- ----------------------------------------------------------------------
-- One row per (genre, sort, game). This is a POOL, not a mirror of IGDB:
-- the daily job keeps the top GENRE_POOL_SIZE games per genre per sort
-- (top_rated / popular / new) and nothing else. At 23 genres x 3 sorts x
-- 100 that is a hard ceiling of ~6.9k rows, and it stays there.
--
-- `rank` is the game's position within ITS (genre, sort) list, so the grid
-- reads `where genre_id = ? and sort_key = ? order by rank` and gets IGDB's
-- own ordering back without re-sorting or re-deriving anything. When the
-- user scrolls past the cached pool the client pages LIVE against IGDB at
-- offset = rank count; those results are deliberately NOT written back
-- here, which is what keeps this table a fixed-size cache.
--
-- `accessibility` is the precomputed, user-independent half of the on-ramp
-- score (quality + brevity + reach — see src/services/onRamps.js). It
-- lives here so "good places to start" costs a plain SELECT; the client
-- adds the per-user theme-affinity half at read time.
CREATE TABLE IF NOT EXISTS public.genre_game_pools (
  genre_id             integer NOT NULL REFERENCES public.igdb_genres(id) ON DELETE CASCADE,
  sort_key             text    NOT NULL CHECK (sort_key IN ('top_rated', 'popular', 'new')),
  igdb_game_id         bigint  NOT NULL,
  rank                 integer NOT NULL,
  game_title           text,
  cover_image_id       text,
  release_year         integer,
  total_rating         numeric,
  total_rating_count   integer,
  genre_ids            integer[] NOT NULL DEFAULT '{}',
  theme_ids            integer[] NOT NULL DEFAULT '{}',
  theme_names          text[]    NOT NULL DEFAULT '{}',
  time_to_beat_seconds integer,
  accessibility        numeric,  -- 0-100 on-ramp base; NULL only if unscoreable
  refreshed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (genre_id, sort_key, igdb_game_id)
);

CREATE INDEX IF NOT EXISTS genre_game_pools_read_idx
  ON public.genre_game_pools (genre_id, sort_key, rank);

-- "Good places to start" reads the accessible end of a genre regardless of
-- which sort the user is looking at.
CREATE INDEX IF NOT EXISTS genre_game_pools_accessible_idx
  ON public.genre_game_pools (genre_id, accessibility DESC NULLS LAST);

COMMENT ON TABLE public.genre_game_pools IS
  'Fixed-size per-genre game pool for the map''s genre grid: top ~100 games per genre per sort (top_rated/popular/new), refreshed by the taste-engine daily job. NOT a copy of IGDB''s catalog — deep scrolling paginates live against IGDB from the client and is never written back here.';


-- ----------------------------------------------------------------------
-- 4. user_genre_pools — the Venture Out pool, per user per genre
-- ----------------------------------------------------------------------
-- "Venture Out" proposes games from a genre the user has NEVER touched, so
-- the pool has to be per-user: it is taste-filtered (biased toward themes
-- they already like) and has their owned/backlogged games removed.
--
-- Built by the daily job from `genre_game_pools` — the global pool is
-- already cached, so producing every user's Venture Out pool costs ZERO
-- additional IGDB requests. That is the whole reason the global pool is
-- kept wider (three sorts) than any single grid view needs.
--
-- `matched_themes` records WHICH of the user's real theme affinities put
-- this game in their pool, so the UI can say "because you like Horror"
-- and QA can verify it, rather than showing an unexplained match number.
CREATE TABLE IF NOT EXISTS public.user_genre_pools (
  user_id              uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  genre_id             integer NOT NULL REFERENCES public.igdb_genres(id) ON DELETE CASCADE,
  igdb_game_id         bigint  NOT NULL,
  rank                 integer NOT NULL,
  match_score          numeric NOT NULL,          -- 0-100 blended taste + accessibility
  accessibility        numeric,                   -- 0-100, copied from genre_game_pools
  matched_themes       text[]  NOT NULL DEFAULT '{}',
  game_title           text,
  cover_image_id       text,
  release_year         integer,
  total_rating         numeric,
  total_rating_count   integer,
  time_to_beat_seconds integer,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, genre_id, igdb_game_id)
);

CREATE INDEX IF NOT EXISTS user_genre_pools_read_idx
  ON public.user_genre_pools (user_id, genre_id, rank);

COMMENT ON TABLE public.user_genre_pools IS
  'Per-user "Venture Out" pool for uncharted genres: quality-gated, theme-biased, owned/backlogged excluded. Derived by the daily job from genre_game_pools, so it costs no extra IGDB requests. Private to the user.';


-- ----------------------------------------------------------------------
-- 5. user_gaming_map — tier storage
-- ----------------------------------------------------------------------
-- One row per (user, genre) — all 23 genres for every user with signal,
-- including the NOT YET ones, because "you have never played a Racing
-- game" is a tile the map has to draw, not an absence.
--
-- This is a SNAPSHOT, not the source of truth. Tiers are derived from the
-- user's own library/backlog/sessions/ratings, and the client recomputes
-- them locally on every read so the map reacts to a status change
-- immediately (the library's primary store is localStorage — see
-- src/services/gamingMapService.js). This table is what makes the same
-- tiers readable SERVER-side: by the daily job when it builds Venture Out
-- pools, and by anyone viewing another user's map.
--
-- Stats are stored alongside the tier because every tile renders them and
-- re-deriving them per tile would mean re-scanning the library 23 times.
CREATE TABLE IF NOT EXISTS public.user_gaming_map (
  user_id          uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  genre_id         integer NOT NULL REFERENCES public.igdb_genres(id) ON DELETE CASCADE,
  tier             text    NOT NULL
    CHECK (tier IN ('home_turf', 'exploring', 'on_horizon', 'not_yet')),
  tier_rank        integer NOT NULL DEFAULT 0,  -- position within the tier, 1 = strongest
  score            numeric NOT NULL DEFAULT 0,  -- blended games+hours+ratings, tier input
  game_count       integer NOT NULL DEFAULT 0,  -- distinct games with ANY play signal
  played_count     integer NOT NULL DEFAULT 0,  -- of those, marked played/finished
  dropped_count    integer NOT NULL DEFAULT 0,
  backlog_count    integer NOT NULL DEFAULT 0,
  hours            numeric NOT NULL DEFAULT 0,
  avg_rating       numeric,                     -- 0-5 stars; NULL when nothing rated
  rated_count      integer NOT NULL DEFAULT 0,
  affinity         numeric,                     -- user_taste_vectors weight, NULL if absent
  last_activity_at timestamptz,
  -- 'client' rows saw the full library (localStorage included); 'engine' rows
  -- only saw what reached Supabase. The daily job writes 'engine' rows but
  -- never overwrites a fresher 'client' row, because doing so would throw
  -- away the only complete view of the library that exists.
  source           text NOT NULL DEFAULT 'client'
    CHECK (source IN ('client', 'engine')),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, genre_id)
);

CREATE INDEX IF NOT EXISTS user_gaming_map_user_tier_idx
  ON public.user_gaming_map (user_id, tier, tier_rank);

COMMENT ON TABLE public.user_gaming_map IS
  'Per-user, per-genre tier (home_turf/exploring/on_horizon/not_yet) + the stats each map tile renders. A snapshot: the client recomputes tiers locally on read so the map updates in real time off user actions, and this table exists so the same tiers are readable server-side (daily job, other users'' profiles).';

COMMENT ON COLUMN public.user_gaming_map.avg_rating IS
  'Mean of the user''s own 0-5 star ratings in this genre. NULL means they have rated nothing here — distinct from 0, which would be a real (terrible) rating.';


-- ----------------------------------------------------------------------
-- 6. user_gaming_map_meta — genre-resolution backfill queue
-- ----------------------------------------------------------------------
-- The map can only place a game on it if it knows the game's genres, and
-- genres come from the `game_tags` cache. The daily job fills game_tags
-- for every game with a SUPABASE-side signal (tracker, review, session,
-- list, swipe) — but the library's primary store is localStorage, so a
-- game added on-device and never synced has no game_tags row and cannot
-- be placed.
--
-- Rather than let the client fix that with a live IGDB call on read (which
-- would break the "no routine read hits IGDB" rule), it records the ids it
-- could not resolve here, and the next daily run resolves them into
-- game_tags. The map self-heals within a day, and `unresolved_count` lets
-- the UI be honest about coverage in the meantime instead of quietly
-- undercounting a genre.
--
-- Client-written for the user's own row, so unlike the other tables here
-- it needs real write policies.
CREATE TABLE IF NOT EXISTS public.user_gaming_map_meta (
  user_id             uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  unresolved_game_ids bigint[] NOT NULL DEFAULT '{}',
  unresolved_count    integer  NOT NULL DEFAULT 0,
  resolved_count      integer  NOT NULL DEFAULT 0,
  computed_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_gaming_map_meta IS
  'Per-user genre-resolution coverage for the gaming map. The client records IGDB ids from its local library that have no game_tags row; the daily job resolves them so the map self-heals without ever calling IGDB on a read.';


-- ----------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------
-- igdb_genres / genre_game_pools are public IGDB reference data — readable
-- by anyone, written only by the service role (no write policy = no client
-- writes). user_genre_pools and user_gaming_map are private to their
-- owner. user_gaming_map_meta is the one client-written table.

ALTER TABLE public.igdb_genres          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_game_pools     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_genre_pools     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gaming_map      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gaming_map_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS igdb_genres_select_all ON public.igdb_genres;
CREATE POLICY igdb_genres_select_all ON public.igdb_genres
  FOR SELECT USING (true);

DROP POLICY IF EXISTS genre_game_pools_select_all ON public.genre_game_pools;
CREATE POLICY genre_game_pools_select_all ON public.genre_game_pools
  FOR SELECT USING (true);

DROP POLICY IF EXISTS user_genre_pools_select_own ON public.user_genre_pools;
CREATE POLICY user_genre_pools_select_own ON public.user_genre_pools
  FOR SELECT USING (auth.uid() = user_id);

-- A user's genre map is the same class of information as their taste
-- vector, which is already readable by any authenticated user so profiles
-- can show taste + taste-match. Keeping these consistent means a future
-- "their map vs yours" view needs no policy change.
DROP POLICY IF EXISTS user_gaming_map_select_auth ON public.user_gaming_map;
CREATE POLICY user_gaming_map_select_auth ON public.user_gaming_map
  FOR SELECT USING (auth.role() = 'authenticated');

-- Unlike the other engine caches, this one is CLIENT-WRITTEN for the user's
-- own rows — the same reason user_swipe_signals is (see
-- 20260728120000_behavioral_taste_profile.sql). The library's primary store
-- is localStorage and setGameStatus never writes game_trackers, so a
-- server-side job physically cannot see most of a user's library. The
-- browser is the only place the full picture exists, so it writes the
-- snapshot; the daily job computes its own from Supabase data as a fallback
-- and defers to a fresher client-written row. Without this, the job would
-- classify genres the user has actually played as NOT YET and offer to
-- "venture out" into them.
DROP POLICY IF EXISTS user_gaming_map_insert_own ON public.user_gaming_map;
CREATE POLICY user_gaming_map_insert_own ON public.user_gaming_map
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_gaming_map_update_own ON public.user_gaming_map;
CREATE POLICY user_gaming_map_update_own ON public.user_gaming_map
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_gaming_map_meta_select_own ON public.user_gaming_map_meta;
CREATE POLICY user_gaming_map_meta_select_own ON public.user_gaming_map_meta
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_gaming_map_meta_insert_own ON public.user_gaming_map_meta;
CREATE POLICY user_gaming_map_meta_insert_own ON public.user_gaming_map_meta
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_gaming_map_meta_update_own ON public.user_gaming_map_meta;
CREATE POLICY user_gaming_map_meta_update_own ON public.user_gaming_map_meta
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ----------------------------------------------------------------------
-- 8. RPC get_gaming_map(target uuid) — read the stored snapshot
-- ----------------------------------------------------------------------
-- The client's own map is computed locally (real time, localStorage-aware)
-- and does not need this. This is the read path for the snapshot: another
-- user's map, or a fallback before the viewer's first local computation.
--
-- Always returns all 23 genres by LEFT JOINing the reference list, so a
-- caller never has to know that "absent row" means NOT YET. Genres with no
-- stored row come back as not_yet with zeroed stats, which is exactly what
-- they are.
--
-- SECURITY INVOKER (default) — respects the SELECT policy above.
CREATE OR REPLACE FUNCTION public.get_gaming_map(target uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'user_id', target,
    'computed_at', (SELECT max(m.computed_at) FROM public.user_gaming_map m WHERE m.user_id = target),
    'genres', COALESCE(jsonb_agg(g ORDER BY (g->>'sort_order')::int), '[]'::jsonb)
  )
  FROM (
    SELECT jsonb_build_object(
      'genre_id',         gen.id,
      'name',             gen.name,
      'slug',             gen.slug,
      'sort_order',       gen.sort_order,
      'tier',             COALESCE(m.tier, 'not_yet'),
      'tier_rank',        COALESCE(m.tier_rank, 0),
      'score',            COALESCE(m.score, 0),
      'game_count',       COALESCE(m.game_count, 0),
      'played_count',     COALESCE(m.played_count, 0),
      'dropped_count',    COALESCE(m.dropped_count, 0),
      'backlog_count',    COALESCE(m.backlog_count, 0),
      'hours',            COALESCE(m.hours, 0),
      'avg_rating',       m.avg_rating,
      'rated_count',      COALESCE(m.rated_count, 0),
      'affinity',         m.affinity,
      'last_activity_at', m.last_activity_at
    ) AS g
    FROM public.igdb_genres gen
    LEFT JOIN public.user_gaming_map m
      ON m.genre_id = gen.id AND m.user_id = target
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_gaming_map(uuid) TO anon, authenticated;
