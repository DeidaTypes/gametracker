-- =====================================================================
-- Themed Drops — T1 engine data layer
-- =====================================================================
-- RUN MANUALLY before testing (Supabase SQL editor, or
--   supabase db query --linked -f supabase/migrations/20260730140000_themed_drops.sql
-- ). Nothing in this file runs automatically.
--
-- ONE themed drop is live at any moment, on a fully automatic two-cycle
-- weekly rotation:
--
--   Thu 00:00 -> Mon 00:00   WEEKEND slot   fixed theme
--   Mon 00:00 -> Thu 00:00   WEEKDAY slot   rotates through a theme pool
--
-- All times UTC — see §4 for why the boundary is a single global instant
-- rather than per-user local midnight.
--
-- ---------------------------------------------------------------------
-- THE ONE RULE THIS SCHEMA EXISTS TO ENFORCE: THEMES ARE DATA.
-- ---------------------------------------------------------------------
-- Adding "Soulslike Sunday" later must be an INSERT, not a deploy. So a
-- theme never contains a query — it contains a COMPOSITION that
-- references filter primitives registered in `drop_filter_types`. The
-- engine knows how to evaluate each primitive; it knows nothing about any
-- specific theme. There is no `if theme == 'vampire_session'` anywhere.
--
-- The risk with data-driven config is that a typo becomes a silent empty
-- drop at 00:00 on a Thursday. So the composition is VALIDATED BY THE
-- DATABASE on write (§2): an unknown filter type, a missing required
-- param, or a wrong-typed param aborts the INSERT with a readable error.
-- The owner finds out while editing the row, not on Thursday.
--
-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
--   1. drop_filter_types    the composable filter library (registry)
--   2. drop_themes          author-editable themes (the thing you edit)
--   3. drop_candidate_pool  quality-floor game pool, engine-written cache
--   4. drop_schedule        the rotation calendar
--   5. drop_games           cached contents of each scheduled drop
--   6. drop_history         no-repeat memory
--   7. RLS
--   8. Calendar functions   window math + rotation
--   9. RPC get_active_themed_drop()
--
-- Idempotent: every statement is guarded, so re-running is safe.
-- =====================================================================


-- Non-overlapping time windows are enforced with a GiST exclusion
-- constraint in §5, which needs the range operator classes.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ----------------------------------------------------------------------
-- 1. drop_filter_types — the composable filter library
-- ----------------------------------------------------------------------
-- The registry of primitives a theme may compose from. This table is the
-- CONTRACT between the owner (who writes compositions) and the engine
-- (which evaluates them), and it exists for three reasons:
--
--   1. Validation. The trigger in §2 rejects a composition referencing a
--      type that is not here, so a typo can never reach the scheduler.
--   2. Documentation. `param_schema` + `description` tell the owner what
--      a filter accepts without reading TypeScript.
--   3. Honesty about coverage. `notes` records the real-world caveat for
--      each primitive — most importantly that time_to_beat is only
--      present for ~41% of the quality pool.
--
-- Adding a NEW PRIMITIVE (not a new theme) is the one case that does need
-- code: a handler in supabase/functions/themed-drops/filterLibrary.ts plus
-- a row here. Adding a new THEME from existing primitives needs neither.
--
-- `param_schema` is a small hand-rolled shape, not JSON Schema: each key
-- maps to { type, required } where type is one of
-- 'int' | 'number' | 'int[]' | 'string' | 'bool'. Deliberately tiny — it
-- only has to catch author typos, and a full JSON Schema validator in
-- plpgsql would be far more machinery than that is worth.
CREATE TABLE IF NOT EXISTS public.drop_filter_types (
  key          text PRIMARY KEY,
  label        text NOT NULL,
  description  text NOT NULL,
  param_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes        text,
  sort_order   integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.drop_filter_types IS
  'The composable filter library for Themed Drops. A theme references these primitives by key; the engine evaluates them generically. Adding a THEME needs no code change — only adding a new PRIMITIVE does (a handler in themed-drops/filterLibrary.ts plus a row here).';

INSERT INTO public.drop_filter_types (key, label, description, param_schema, notes, sort_order) VALUES
  (
    'time_to_beat',
    'Time to beat',
    'Keeps games whose IGDB game_time_to_beats "normally" value falls in [min_hours, max_hours]. Either bound may be omitted for an open-ended range.',
    '{"min_hours": {"type": "number", "required": false},
      "max_hours": {"type": "number", "required": false}}'::jsonb,
    'ONLY includes games with a REAL recorded completion time. Never estimates, never infers from genre, never includes a game with no IGDB entry. Measured coverage is ~41% of the quality pool and is strongly skewed toward popular titles (80% of the most-rated quintile vs 17% of the least), so a theme using this filter has a materially smaller pool than one that does not. IGDB times are crowd-sourced and unvalidated: values outside 15min-200h are stored as NULL by the pool refresh because they are not completion times (data-entry junk like World Cup 98 at 567,890 hours, and endless games like League of Legends where there is nothing to complete).',
    1
  ),
  (
    'genre',
    'Genre',
    'Keeps games carrying any (match=any, default) or all (match=all) of the given IGDB genre ids.',
    '{"ids": {"type": "int[]", "required": true},
      "match": {"type": "string", "required": false}}'::jsonb,
    'Formal IGDB genre ids, as carried on drop_candidate_pool.genre_ids. Densely populated: every game with any metadata has genres.',
    2
  ),
  (
    'theme',
    'Theme / mood',
    'Keeps games carrying any (default) or all of the given IGDB theme ids.',
    '{"ids": {"type": "int[]", "required": true},
      "match": {"type": "string", "required": false}}'::jsonb,
    'IGDB themes are editorial and sparser than genres. There is no "relaxing" or "cozy" theme in IGDB — the closest real ids are 33 Sandbox, 27 Comedy, 35 Kids. Compose cozy moods from genres plus these rather than expecting a literal mood tag.',
    3
  ),
  (
    'release_window',
    'Release window',
    'Keeps games whose release year falls in [min_year, max_year]. Either bound may be omitted.',
    '{"min_year": {"type": "int", "required": false},
      "max_year": {"type": "int", "required": false}}'::jsonb,
    'Games with no known release date are excluded whenever either bound is set, on the same principle as time_to_beat: an unknown is not a match.',
    4
  ),
  (
    'rating_floor',
    'Rating floor',
    'Keeps games with total_rating >= min_rating AND total_rating_count >= min_rating_count.',
    '{"min_rating": {"type": "number", "required": false},
      "min_rating_count": {"type": "int", "required": false}}'::jsonb,
    'A theme-level floor ON TOP of the engine-wide hard floor, which always applies and cannot be opted out of. Use this to make a specific theme stricter, never looser — the engine takes the MAXIMUM of the two.',
    5
  ),
  (
    'multiplayer',
    'Co-op / multiplayer',
    'Keeps games offering any (default) or all of the given IGDB game_mode ids.',
    '{"modes": {"type": "int[]", "required": true},
      "match": {"type": "string", "required": false}}'::jsonb,
    'IGDB game_modes: 1 Single player, 2 Multiplayer, 3 Co-operative, 4 Split screen, 5 MMO, 6 Battle Royale. "Couch co-op" is (3,4) — split screen alone is truer to the couch but roughly a third the pool.',
    6
  )
ON CONFLICT (key) DO UPDATE
  SET label        = EXCLUDED.label,
      description  = EXCLUDED.description,
      param_schema = EXCLUDED.param_schema,
      notes        = EXCLUDED.notes,
      sort_order   = EXCLUDED.sort_order;


-- ----------------------------------------------------------------------
-- 2. drop_themes — the author-editable table
-- ----------------------------------------------------------------------
-- THIS IS THE TABLE THE OWNER EDITS. One row per theme.
--
-- `composition` shape:
--   {
--     "all": [ { "type": "<filter key>", "params": { ... } }, ... ],
--     "any": [ { "type": "<filter key>", "params": { ... } }, ... ]
--   }
--
-- `all` filters are AND-combined: every one must pass. `any` is an
-- optional OR group: if present and non-empty, at least one must pass.
-- `any` exists because two of the seeded themes genuinely need it —
-- "One more turn" is (strategy genres OR a 4X/turn-based theme) and
-- "Rainy day games" is (sim/puzzle genres OR a cozy-ish theme). Without
-- it those would have to be split into two themes or hardcoded, and
-- hardcoding is the thing this whole design exists to avoid.
--
-- `slot_eligibility`:
--   'weekend' — the fixed Thu->Mon theme
--   'weekday' — joins the Mon->Thu rotation
--   'either'  — joins the weekday rotation AND can cover the weekend slot
--               if no 'weekend' theme is active
--
-- `rotation_order` is the position in the weekday rotation. Ties break by
-- slug so the order is total and stable — otherwise adding a theme could
-- silently reshuffle the whole upcoming calendar.
CREATE TABLE IF NOT EXISTS public.drop_themes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  subtitle         text,
  composition      jsonb NOT NULL DEFAULT '{"all": []}'::jsonb,
  slot_eligibility text NOT NULL DEFAULT 'weekday'
    CHECK (slot_eligibility IN ('weekend', 'weekday', 'either')),
  is_active        boolean NOT NULL DEFAULT true,
  rotation_order   integer NOT NULL DEFAULT 100,
  drop_size        integer NOT NULL DEFAULT 20 CHECK (drop_size BETWEEN 1 AND 60),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drop_themes_rotation_idx
  ON public.drop_themes (slot_eligibility, is_active, rotation_order, slug);

COMMENT ON TABLE public.drop_themes IS
  'Author-editable Themed Drops themes. A theme is a display name + subtitle + a COMPOSITION of filter primitives from drop_filter_types — never a query. Adding a theme is an INSERT with no code change; the trigger below validates the composition on write so a typo fails at edit time, not at 00:00 on a Thursday.';

COMMENT ON COLUMN public.drop_themes.composition IS
  'AND-combined "all" filters plus an optional OR "any" group. Validated against drop_filter_types by validate_drop_composition().';


-- ── Composition validation ────────────────────────────────────────────
-- Runs on every INSERT/UPDATE of drop_themes. Raises (aborting the write)
-- when a composition references an unknown filter type, omits a required
-- param, or passes a param of the wrong type.
--
-- This is what makes "no code change" SAFE rather than merely possible:
-- the owner gets a specific error naming the theme, the filter and the
-- param, instead of a drop that silently selects zero games.
-- STABLE, not IMMUTABLE: this reads drop_filter_types, so its result can
-- change between statements as the registry does. Declaring it IMMUTABLE
-- would let the planner cache a validation result across a registry change.
CREATE OR REPLACE FUNCTION public.validate_drop_composition(composition jsonb, ctx text DEFAULT 'theme')
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  grp        text;
  node       jsonb;
  ftype      text;
  params     jsonb;
  schema_row public.drop_filter_types%ROWTYPE;
  pkey       text;
  pspec      jsonb;
  pval       jsonb;
  total      integer := 0;
BEGIN
  IF composition IS NULL OR jsonb_typeof(composition) <> 'object' THEN
    RAISE EXCEPTION '[%] composition must be a JSON object, got %',
      ctx, COALESCE(jsonb_typeof(composition), 'null');
  END IF;

  FOREACH grp IN ARRAY ARRAY['all', 'any'] LOOP
    IF composition ? grp THEN
      IF jsonb_typeof(composition -> grp) <> 'array' THEN
        RAISE EXCEPTION '[%] composition."%" must be an array of filters', ctx, grp;
      END IF;

      FOR node IN SELECT * FROM jsonb_array_elements(composition -> grp) LOOP
        total := total + 1;
        ftype := node ->> 'type';

        IF ftype IS NULL THEN
          RAISE EXCEPTION '[%] a filter in "%" is missing its "type" key', ctx, grp;
        END IF;

        SELECT * INTO schema_row FROM public.drop_filter_types WHERE key = ftype;
        IF NOT FOUND THEN
          RAISE EXCEPTION
            '[%] unknown filter type "%". Registered types: %. Adding a NEW primitive requires a handler in themed-drops/filterLibrary.ts plus a drop_filter_types row.',
            ctx, ftype,
            (SELECT string_agg(key, ', ' ORDER BY sort_order) FROM public.drop_filter_types);
        END IF;

        params := COALESCE(node -> 'params', '{}'::jsonb);
        IF jsonb_typeof(params) <> 'object' THEN
          RAISE EXCEPTION '[%] filter "%": params must be an object', ctx, ftype;
        END IF;

        -- Required params present?
        FOR pkey, pspec IN SELECT e.key, e.value FROM jsonb_each(schema_row.param_schema) e LOOP
          IF COALESCE((pspec ->> 'required')::boolean, false)
             AND NOT (params ? pkey) THEN
            RAISE EXCEPTION '[%] filter "%": missing required param "%"', ctx, ftype, pkey;
          END IF;
        END LOOP;

        -- Known + correctly typed params?
        FOR pkey, pval IN SELECT e.key, e.value FROM jsonb_each(params) e LOOP
          IF NOT (schema_row.param_schema ? pkey) THEN
            RAISE EXCEPTION '[%] filter "%": unknown param "%". Accepts: %',
              ctx, ftype, pkey,
              (SELECT string_agg(k, ', ') FROM jsonb_object_keys(schema_row.param_schema) k);
          END IF;

          IF pval IS NOT NULL AND jsonb_typeof(pval) <> 'null' THEN
            CASE schema_row.param_schema -> pkey ->> 'type'
              WHEN 'int', 'number' THEN
                IF jsonb_typeof(pval) <> 'number' THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" must be a number, got %',
                    ctx, ftype, pkey, jsonb_typeof(pval);
                END IF;
              WHEN 'int[]' THEN
                IF jsonb_typeof(pval) <> 'array' THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" must be an array of ints, got %',
                    ctx, ftype, pkey, jsonb_typeof(pval);
                END IF;
                IF EXISTS (
                  SELECT 1 FROM jsonb_array_elements(pval) e
                  WHERE jsonb_typeof(e) <> 'number'
                ) THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" must contain only ints',
                    ctx, ftype, pkey;
                END IF;
                IF jsonb_array_length(pval) = 0 THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" cannot be empty — an empty id list matches nothing',
                    ctx, ftype, pkey;
                END IF;
              WHEN 'bool' THEN
                IF jsonb_typeof(pval) <> 'boolean' THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" must be a boolean', ctx, ftype, pkey;
                END IF;
              WHEN 'string' THEN
                IF jsonb_typeof(pval) <> 'string' THEN
                  RAISE EXCEPTION '[%] filter "%": param "%" must be a string', ctx, ftype, pkey;
                END IF;
              ELSE
                NULL;
            END CASE;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  -- A theme with no filters would match the entire quality pool. That is
  -- almost certainly an editing mistake rather than an intent, and it
  -- would burn the no-repeat budget of every other theme.
  IF total = 0 THEN
    RAISE EXCEPTION
      '[%] composition has no filters — that would match the whole pool. Add at least one filter to "all" or "any".', ctx;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.drop_themes_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_drop_composition(NEW.composition, NEW.slug);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drop_themes_validate_trg ON public.drop_themes;
CREATE TRIGGER drop_themes_validate_trg
  BEFORE INSERT OR UPDATE ON public.drop_themes
  FOR EACH ROW EXECUTE FUNCTION public.drop_themes_validate();


-- ── Seed themes ───────────────────────────────────────────────────────
-- Every one of these resolves through the filter library above. There is
-- no theme-specific code path for any of them; the engine treats these
-- exactly the same as a theme the owner adds tomorrow.
--
-- Pool sizes measured against live IGDB before seeding (see
-- scripts/diagnose-themed-drops.mjs). Each figure is games clearing the
-- engine-wide hard floor AND the theme's own filters:
--
--   Beat it in a weekend    762     Couch co-op tonight    1137
--   Have time after work?   325     Rainy day games       1608
--   Vampire session?        674     One more turn         1026
--
-- The three time-based themes carry ONLY games with a real recorded
-- completion time — the time_to_beat primitive drops unknowns rather
-- than estimating, which is why their pools are smaller.

INSERT INTO public.drop_themes
  (slug, display_name, subtitle, slot_eligibility, rotation_order, drop_size, composition)
VALUES
  (
    'beat-it-in-a-weekend',
    'Beat it in a weekend',
    'Start it Friday, finish it Sunday',
    -- 20, not 24: the weekend theme is the only one that runs EVERY week, so
    -- it alone consumes 10 drops' worth of games inside the no-repeat window
    -- while each weekday theme consumes about two. Its pool is the binding
    -- constraint on the whole rotation, and a smaller drop is what keeps it
    -- comfortably fresh. See the freshness math in selection.ts.
    'weekend', 0, 20,
    '{"all": [
        {"type": "time_to_beat", "params": {"max_hours": 12}},
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ]}'::jsonb
  ),
  (
    'have-time-after-work',
    'Have time after work?',
    'Done before bed, no weekend required',
    'weekday', 10, 20,
    '{"all": [
        {"type": "time_to_beat", "params": {"min_hours": 2, "max_hours": 6}},
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ]}'::jsonb
  ),
  (
    'vampire-session',
    'Vampire session?',
    'For the ones who game till sunrise',
    'weekday', 20, 20,
    '{"all": [
        {"type": "time_to_beat", "params": {"min_hours": 20}},
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ]}'::jsonb
  ),
  (
    'one-more-turn',
    'One more turn',
    'It is 2am and you are still not done',
    'weekday', 30, 20,
    -- Strategy family OR the 4X theme. IGDB has no "roguelike" THEME
    -- (roguelike is a community keyword, which is far too sparse to build
    -- a drop on), so the turn-based itch is expressed through the formal
    -- strategy genres plus 4X, all of which are densely populated.
    '{"all": [
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ],
      "any": [
        {"type": "genre", "params": {"ids": [15, 16, 11, 24]}},
        {"type": "theme", "params": {"ids": [41]}}
      ]}'::jsonb
  ),
  (
    'couch-co-op-tonight',
    'Couch co-op tonight',
    'Two controllers, one couch',
    'weekday', 40, 20,
    '{"all": [
        {"type": "multiplayer", "params": {"modes": [3, 4]}},
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ]}'::jsonb
  ),
  (
    'rainy-day-games',
    'Rainy day games',
    'Nowhere to be, nothing to prove',
    'weekday', 50, 20,
    -- "Cozy" is not an IGDB tag. The honest approximation is the sim /
    -- puzzle / point-and-click genres, or the Sandbox / Kids themes.
    '{"all": [
        {"type": "rating_floor", "params": {"min_rating": 78, "min_rating_count": 25}}
      ],
      "any": [
        {"type": "genre", "params": {"ids": [13, 9, 2]}},
        {"type": "theme", "params": {"ids": [33, 35]}}
      ]}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE
  SET display_name     = EXCLUDED.display_name,
      subtitle         = EXCLUDED.subtitle,
      slot_eligibility = EXCLUDED.slot_eligibility,
      rotation_order   = EXCLUDED.rotation_order,
      drop_size        = EXCLUDED.drop_size,
      composition      = EXCLUDED.composition;


-- ----------------------------------------------------------------------
-- 3. drop_candidate_pool — the quality-floor pool
-- ----------------------------------------------------------------------
-- Selection reads from HERE, never from IGDB. That is what lets a drop
-- activate at 00:00 exactly and what keeps Explore free of live IGDB
-- calls. The pool is refreshed by the themed-drops job on its own slow
-- cadence (games do not cross a rating floor overnight).
--
-- Same principle as genre_game_pools: this is a POOL, not a mirror of
-- IGDB's catalog. It holds only games already clearing the engine-wide
-- hard floor — ~4.3k rows at the current floor, and it stays there.
--
-- `time_to_beat_seconds` NULL means IGDB publishes no USABLE community
-- time. That is a real answer, not missing data, and the time_to_beat
-- filter treats it as a non-match rather than guessing. It covers both
-- "IGDB has no entry" and "IGDB's entry is not a completion time" —
-- the raw feed carries both data-entry junk (World Cup 98: 567,890
-- hours) and endless games (League of Legends: 14,451 hours), and
-- neither belongs in a drop that promises a game you can finish. See
-- the plausibility bounds in themed-drops/pool.ts.
--
-- `popularity_rank` is 1 for the most-rated game in the pool. Stored
-- rather than derived so the balance lean is a stable, inspectable
-- number: two selections on the same pool lean identically.
CREATE TABLE IF NOT EXISTS public.drop_candidate_pool (
  igdb_game_id         bigint PRIMARY KEY,
  name                 text,
  cover_image_id       text,
  total_rating         numeric,
  total_rating_count   integer,
  release_year         integer,
  genre_ids            integer[] NOT NULL DEFAULT '{}',
  genre_names          text[]    NOT NULL DEFAULT '{}',
  theme_ids            integer[] NOT NULL DEFAULT '{}',
  theme_names          text[]    NOT NULL DEFAULT '{}',
  game_mode_ids        integer[] NOT NULL DEFAULT '{}',
  -- IGDB `collections` (plural, an array — the singular `collection` field is
  -- retired and silently returns nothing). Backs the franchise cap in
  -- selection.ts: a drop that is six Sonic games is correct and useless.
  collection_ids       integer[] NOT NULL DEFAULT '{}',
  time_to_beat_seconds integer,
  time_to_beat_count   integer,
  popularity_rank      integer,
  popularity_pct       numeric,  -- 0 = most mainstream, 1 = deepest cut
  refreshed_at         timestamptz NOT NULL DEFAULT now()
);

-- Added after the table shipped; guarded so re-running the file is safe.
ALTER TABLE public.drop_candidate_pool
  ADD COLUMN IF NOT EXISTS collection_ids integer[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS drop_candidate_pool_ttb_idx
  ON public.drop_candidate_pool (time_to_beat_seconds)
  WHERE time_to_beat_seconds IS NOT NULL;

CREATE INDEX IF NOT EXISTS drop_candidate_pool_pop_idx
  ON public.drop_candidate_pool (popularity_pct);

COMMENT ON TABLE public.drop_candidate_pool IS
  'Games clearing the engine-wide hard quality floor, with the metadata every filter primitive needs. Refreshed by the themed-drops Edge Function; selection reads only from here so a drop can activate at exactly 00:00 with no IGDB round trip. NULL time_to_beat_seconds = IGDB has no community time (an honest unknown, never estimated).';


-- ----------------------------------------------------------------------
-- 4. drop_schedule — the rotation calendar
-- ----------------------------------------------------------------------
-- One row per window. Windows TILE the timeline with no gaps and no
-- overlaps, which is how "exactly one drop live" is guaranteed
-- structurally rather than by application discipline:
--
--   • the EXCLUDE constraint makes two overlapping windows unstorable
--   • windows are generated back-to-back, so there is never a gap
--   • the read RPC resolves "active" as the window containing now()
--
-- Because active-ness is derived from the clock and not from a status
-- flag, the swap at Thu/Mon 00:00 is exact to the second and does not
-- depend on cron firing on time. Cron's only job is to stay AHEAD —
-- selecting games for windows that have not started yet. A late cron run
-- delays nothing; it would only risk a window opening with no games
-- cached, which is why the job keeps two windows of lookahead.
--
-- All boundaries are UTC. A single global instant, not per-user local
-- midnight: the drop is one shared object with one cached game list, so
-- "live" has to mean the same thing for everyone. Per-timezone drops
-- would mean per-timezone caches and per-timezone no-repeat history.
CREATE TABLE IF NOT EXISTS public.drop_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot            text NOT NULL CHECK (slot IN ('weekend', 'weekday')),
  theme_id        uuid NOT NULL REFERENCES public.drop_themes(id) ON DELETE RESTRICT,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  cycle_index     integer NOT NULL,  -- weeks since the rotation epoch
  selection_state text NOT NULL DEFAULT 'pending'
    CHECK (selection_state IN ('pending', 'selected', 'failed')),
  selection_note  text,
  game_count      integer NOT NULL DEFAULT 0,
  selected_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drop_schedule_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT drop_schedule_no_overlap
    EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
);

CREATE UNIQUE INDEX IF NOT EXISTS drop_schedule_starts_idx
  ON public.drop_schedule (starts_at);

COMMENT ON TABLE public.drop_schedule IS
  'The Themed Drops rotation calendar. Windows tile the timeline gaplessly and cannot overlap (GiST exclusion constraint), so exactly one drop is live at any instant and "live" is derived from the clock rather than a status flag — making the Thu/Mon 00:00 swap exact regardless of when cron last ran.';


-- ----------------------------------------------------------------------
-- 5. drop_games — cached drop contents
-- ----------------------------------------------------------------------
-- The selected set for one scheduled window, denormalized so a read is a
-- single indexed SELECT with no join to the pool (the pool is refreshed
-- independently and a game may legitimately fall out of it later; a drop
-- that already shipped must keep showing what it shipped).
--
-- `rank` is the engine's order before per-user taste is applied. The read
-- RPC reorders by the viewer's B1 vector — taste changes ORDER only and
-- never removes a game, so every viewer sees the same set.
CREATE TABLE IF NOT EXISTS public.drop_games (
  schedule_id          uuid NOT NULL REFERENCES public.drop_schedule(id) ON DELETE CASCADE,
  igdb_game_id         bigint NOT NULL,
  rank                 integer NOT NULL,
  selection_score      numeric,
  quality_score        numeric,
  discovery_score      numeric,  -- the balance-lean half, for QA
  game_title           text,
  cover_image_id       text,
  total_rating         numeric,
  total_rating_count   integer,
  release_year         integer,
  genre_ids            integer[] NOT NULL DEFAULT '{}',
  genre_names          text[]    NOT NULL DEFAULT '{}',
  theme_names          text[]    NOT NULL DEFAULT '{}',
  time_to_beat_seconds integer,
  PRIMARY KEY (schedule_id, igdb_game_id)
);

CREATE INDEX IF NOT EXISTS drop_games_read_idx
  ON public.drop_games (schedule_id, rank);

COMMENT ON TABLE public.drop_games IS
  'Cached contents of one scheduled drop, denormalized so reads never join the candidate pool — a shipped drop keeps showing what it shipped even after the pool refreshes underneath it. `rank` is pre-taste order; the read RPC reorders per viewer without removing anything.';


-- ----------------------------------------------------------------------
-- 6. drop_history — no-repeat memory
-- ----------------------------------------------------------------------
-- Every game shown in every drop, so selection can exclude anything seen
-- recently. Deliberately GLOBAL across themes: the promise is "you will
-- not see the same game twice in a short span", and a user does not
-- experience "but it was a different theme" as a different game.
--
-- Keyed on shown_at = the window's START, not the selection time. A drop
-- is selected up to two windows early, and dating the memory by when the
-- user could actually SEE it is what makes the retention window mean what
-- it says.
CREATE TABLE IF NOT EXISTS public.drop_history (
  igdb_game_id bigint NOT NULL,
  schedule_id  uuid NOT NULL REFERENCES public.drop_schedule(id) ON DELETE CASCADE,
  theme_id     uuid NOT NULL REFERENCES public.drop_themes(id) ON DELETE CASCADE,
  shown_at     timestamptz NOT NULL,
  PRIMARY KEY (schedule_id, igdb_game_id)
);

CREATE INDEX IF NOT EXISTS drop_history_recent_idx
  ON public.drop_history (igdb_game_id, shown_at DESC);

COMMENT ON TABLE public.drop_history IS
  'No-repeat memory: every game shown in every drop, dated by the window START (not selection time, which runs up to two windows early). Global across themes — "you already saw this" does not care which theme showed it.';


-- ----------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------
-- Everything here is global, non-personal, IGDB-derived content, so it is
-- world-readable. Writes come exclusively from the themed-drops Edge
-- Function under the service role (which bypasses RLS) — no write policy
-- exists, so every client is read-only by omission.
--
-- drop_themes is readable too: the owner edits it through the Supabase
-- dashboard/SQL (service role), and the app needs the name + subtitle to
-- render. Nothing in a theme row is sensitive.

ALTER TABLE public.drop_filter_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_themes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_candidate_pool  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_schedule        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_games           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drop_history         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drop_filter_types_select_all ON public.drop_filter_types;
CREATE POLICY drop_filter_types_select_all ON public.drop_filter_types
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drop_themes_select_all ON public.drop_themes;
CREATE POLICY drop_themes_select_all ON public.drop_themes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drop_candidate_pool_select_all ON public.drop_candidate_pool;
CREATE POLICY drop_candidate_pool_select_all ON public.drop_candidate_pool
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drop_schedule_select_all ON public.drop_schedule;
CREATE POLICY drop_schedule_select_all ON public.drop_schedule
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drop_games_select_all ON public.drop_games;
CREATE POLICY drop_games_select_all ON public.drop_games
  FOR SELECT USING (true);

DROP POLICY IF EXISTS drop_history_select_all ON public.drop_history;
CREATE POLICY drop_history_select_all ON public.drop_history
  FOR SELECT USING (true);


-- ----------------------------------------------------------------------
-- 8. Calendar functions — window math + rotation
-- ----------------------------------------------------------------------
-- The calendar lives in SQL rather than in the Edge Function because it
-- is pure deterministic date arithmetic with no IGDB involvement, and
-- because the read RPC needs the same notion of "which window is now" as
-- the writer. One implementation, no chance of the two disagreeing.

-- Rotation epoch: Monday 2026-01-05 00:00 UTC. Any Monday works; fixing
-- one makes cycle_index reproducible so the same week always resolves to
-- the same rotation position.
CREATE OR REPLACE FUNCTION public.drop_rotation_epoch()
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$ SELECT timestamptz '2026-01-05 00:00:00+00' $$;

-- The window containing `ts`, as (slot, starts_at, ends_at, cycle_index).
--
-- date_trunc('week') in UTC lands on Monday 00:00, which is already one
-- of our two boundaries. Monday+3d is Thursday, the other. So:
--   Mon 00:00 <= ts < Thu 00:00  ->  weekday
--   Thu 00:00 <= ts < Mon 00:00  ->  weekend
CREATE OR REPLACE FUNCTION public.drop_window_for(ts timestamptz)
RETURNS TABLE (slot text, starts_at timestamptz, ends_at timestamptz, cycle_index integer)
LANGUAGE sql IMMUTABLE
AS $$
  WITH w AS (
    SELECT date_trunc('week', ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS monday
  )
  SELECT
    CASE WHEN ts < w.monday + interval '3 days' THEN 'weekday' ELSE 'weekend' END,
    CASE WHEN ts < w.monday + interval '3 days' THEN w.monday ELSE w.monday + interval '3 days' END,
    CASE WHEN ts < w.monday + interval '3 days' THEN w.monday + interval '3 days' ELSE w.monday + interval '7 days' END,
    (EXTRACT(EPOCH FROM (w.monday - public.drop_rotation_epoch())) / 604800)::integer
  FROM w;
$$;

COMMENT ON FUNCTION public.drop_window_for(timestamptz) IS
  'The rotation window containing a timestamp: weekday = Mon 00:00 -> Thu 00:00 UTC, weekend = Thu 00:00 -> Mon 00:00 UTC. Shared by the scheduler and the read RPC so both agree on what "now" means.';

-- Which theme should fill a given slot in a given cycle?
--
-- Weekend is FIXED: the active 'weekend' theme (lowest rotation_order if
-- the owner has staged more than one), falling back to an 'either' theme
-- so the slot is never empty.
--
-- Weekday ROTATES: the active weekday pool ordered by (rotation_order,
-- slug), advanced one position per week. cycle_index is weeks since the
-- epoch, so consecutive weeks step through the pool in order and wrap.
--
-- Adding a weekday theme changes which theme future cycles resolve to,
-- but never rewrites a window already written to drop_schedule — the
-- scheduler only ever inserts missing rows.
CREATE OR REPLACE FUNCTION public.drop_theme_for_slot(p_slot text, p_cycle integer)
RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  pool_size integer;
  picked    uuid;
BEGIN
  IF p_slot = 'weekend' THEN
    SELECT id INTO picked
    FROM public.drop_themes
    WHERE is_active AND slot_eligibility = 'weekend'
    ORDER BY rotation_order, slug
    LIMIT 1;

    IF picked IS NULL THEN
      SELECT id INTO picked
      FROM public.drop_themes
      WHERE is_active AND slot_eligibility = 'either'
      ORDER BY rotation_order, slug
      LIMIT 1;
    END IF;

    RETURN picked;
  END IF;

  SELECT count(*) INTO pool_size
  FROM public.drop_themes
  WHERE is_active AND slot_eligibility IN ('weekday', 'either');

  IF pool_size = 0 THEN
    RETURN NULL;
  END IF;

  -- Postgres % keeps the sign of the dividend, and cycle_index is
  -- negative for any window before the epoch. Normalise so pre-epoch
  -- windows (backfill, tests) do not fall off the front of the pool.
  SELECT id INTO picked
  FROM public.drop_themes
  WHERE is_active AND slot_eligibility IN ('weekday', 'either')
  ORDER BY rotation_order, slug
  OFFSET ((p_cycle % pool_size) + pool_size) % pool_size
  LIMIT 1;

  RETURN picked;
END;
$$;

-- Fill the calendar from now to now + horizon_weeks. Only ever INSERTs
-- missing windows, so re-running is safe and a window that already
-- shipped is never retroactively reassigned to a different theme.
CREATE OR REPLACE FUNCTION public.ensure_drop_schedule(horizon_weeks integer DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  cursor_ts timestamptz := now();
  horizon   timestamptz := now() + (horizon_weeks || ' weeks')::interval;
  w         record;
  theme     uuid;
  created   integer := 0;
BEGIN
  LOOP
    SELECT * INTO w FROM public.drop_window_for(cursor_ts);
    EXIT WHEN w.starts_at >= horizon;

    IF NOT EXISTS (SELECT 1 FROM public.drop_schedule s WHERE s.starts_at = w.starts_at) THEN
      theme := public.drop_theme_for_slot(w.slot, w.cycle_index);
      IF theme IS NOT NULL THEN
        INSERT INTO public.drop_schedule (slot, theme_id, starts_at, ends_at, cycle_index)
        VALUES (w.slot, theme, w.starts_at, w.ends_at, w.cycle_index)
        ON CONFLICT DO NOTHING;
        created := created + 1;
      END IF;
    END IF;

    cursor_ts := w.ends_at;
  END LOOP;

  RETURN created;
END;
$$;

COMMENT ON FUNCTION public.ensure_drop_schedule(integer) IS
  'Fills the rotation calendar forward. INSERT-only: a window already on the calendar is never reassigned, so adding a theme affects future windows without rewriting the upcoming one out from under a user.';


-- ----------------------------------------------------------------------
-- 9. RPC get_active_themed_drop(target uuid)
-- ----------------------------------------------------------------------
-- The single read surface. Returns the live theme, its cached games and
-- the expiry timestamp the UI counts down to.
--
-- Three things happen per viewer, none of which touch IGDB:
--
--   • OWNED/TRACKED EXCLUSION — anything in the viewer's game_trackers is
--     dropped. Per-viewer, so it cannot be baked into the shared cache;
--     this is why the engine selects more games than a drop displays.
--     (The client additionally filters its localStorage library, which is
--     the primary library store — see themedDropsService.js.)
--
--   • TASTE ORDERING — reorders by the B1 vector: a game's score is the
--     sum of its genres' weights. ORDER ONLY. A genre the viewer has
--     never touched scores 0 and sorts last, but is never removed, so the
--     drop cannot collapse into an echo chamber of what they already play.
--
--   • EXPIRY — ends_at of the containing window, for the countdown.
--
-- SECURITY INVOKER: all six tables are world-readable and game_trackers
-- is filtered to `target`, which is auth.uid() by default.
CREATE OR REPLACE FUNCTION public.get_active_themed_drop(target uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  sched  public.drop_schedule%ROWTYPE;
  th     public.drop_themes%ROWTYPE;
  tv     jsonb := '{}'::jsonb;
  games  jsonb;
BEGIN
  SELECT * INTO sched
  FROM public.drop_schedule
  WHERE starts_at <= now() AND ends_at > now()
  ORDER BY starts_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'active', false,
      'reason', 'no_scheduled_window',
      'games', '[]'::jsonb
    );
  END IF;

  SELECT * INTO th FROM public.drop_themes WHERE id = sched.theme_id;

  IF target IS NOT NULL THEN
    SELECT COALESCE(genre_weights, '{}'::jsonb) INTO tv
    FROM public.user_taste_vectors WHERE user_id = target;
  END IF;
  tv := COALESCE(tv, '{}'::jsonb);

  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'taste_score')::numeric DESC, (g->>'rank')::int ASC), '[]'::jsonb)
  INTO games
  FROM (
    SELECT jsonb_build_object(
      'igdb_game_id',         dg.igdb_game_id,
      'rank',                 dg.rank,
      'title',                dg.game_title,
      'cover_image_id',       dg.cover_image_id,
      'total_rating',         dg.total_rating,
      'total_rating_count',   dg.total_rating_count,
      'release_year',         dg.release_year,
      'genre_names',          dg.genre_names,
      'theme_names',          dg.theme_names,
      'time_to_beat_seconds', dg.time_to_beat_seconds,
      'selection_score',      dg.selection_score,
      'taste_score',          (
        SELECT COALESCE(SUM(COALESCE((tv ->> gn)::numeric, 0)), 0)
        FROM unnest(dg.genre_names) AS gn
      )
    ) AS g
    FROM public.drop_games dg
    WHERE dg.schedule_id = sched.id
      AND (
        target IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.game_trackers gt
          WHERE gt.user_id = target AND gt.igdb_game_id = dg.igdb_game_id
        )
      )
  ) sub;

  RETURN jsonb_build_object(
    'active',          sched.selection_state = 'selected',
    'schedule_id',     sched.id,
    'slot',            sched.slot,
    'starts_at',       sched.starts_at,
    'expires_at',      sched.ends_at,
    'cycle_index',     sched.cycle_index,
    'selection_state', sched.selection_state,
    'selected_at',     sched.selected_at,
    'theme', jsonb_build_object(
      'slug',         th.slug,
      'display_name', th.display_name,
      'subtitle',     th.subtitle
    ),
    'games',       games,
    'game_count',  jsonb_array_length(games)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_themed_drop(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_window_for(timestamptz)  TO anon, authenticated;
