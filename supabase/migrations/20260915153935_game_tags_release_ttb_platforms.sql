-- Widen game_tags with release date, time-to-beat, and platforms.
--
-- Five badges (Time Traveler, Early Adopter, Short Stack, The Long Haul,
-- Platform Nomad) are blocked on game facts that were never cached anywhere
-- usable:
--   - drop_candidate_pool.time_to_beat_seconds is IGDB's `normally`, not
--     `completely`, and only covers 42/79 finished-game completions (53%).
--   - drop_candidate_pool.release_year is year-only (68% coverage) — too
--     coarse for Early Adopter, which needs day precision.
--   - new_notable_pool.release_date is a 31-row recent-releases rail, not a
--     library cache (0/79 finished games hit it).
--   - Nothing caches platforms anywhere.
--
-- game_tags is the right home: it's the IGDB genre/theme/similar/quality
-- metadata cache Omnivore and Deep Cut already join, 728 rows, written only
-- by the taste-engine Edge Function. This migration ADDS columns only — no
-- existing column, default, or row is touched.
--
-- ── Null semantics (the actual hard part) ────────────────────────────────
-- IGDB genuinely lacks time-to-beat for many games and release dates for
-- some — those must stay NULL, never estimated or derived. But a NULL alone
-- is ambiguous: does it mean "IGDB has none" or "we never asked"? For a
-- table being retrofitted with columns onto 728 pre-existing rows (as
-- opposed to genre_ids/genre_names, which are populated atomically at
-- row-insert time and can safely be NOT NULL DEFAULT '{}'), that ambiguity
-- is real and needs its own bit, not a convention.
--
-- Fix: two dedicated "attempted at" timestamps, one per IGDB round trip
-- shape, since release_date/platforms and time-to-beat come from two
-- different IGDB endpoints (`games` vs `game_time_to_beats`) and can be
-- fetched/refreshed independently:
--   - release_platform_fetched_at IS NULL      -> never attempted
--   - release_platform_fetched_at IS NOT NULL  -> attempted; first_release_date
--     / platform_ids / platform_names being NULL or '{}' past that point is
--     IGDB's real answer, not a gap
--   - time_to_beat_fetched_at follows the identical rule for the two
--     time-to-beat columns.
--
-- platform_ids/platform_names therefore CANNOT be NOT NULL DEFAULT '{}' like
-- genre_ids/genre_names — that would make "not fetched" and "IGDB has no
-- platforms" both read as '{}', which is exactly the ambiguity this
-- migration exists to remove. They stay nullable; the two ids/names columns
-- are still int[]/text[] pairs, matching the genre_ids/genre_names shape
-- exactly otherwise.

alter table public.game_tags
  add column first_release_date timestamptz,
  add column release_platform_fetched_at timestamptz,
  add column platform_ids integer[],
  add column platform_names text[],
  add column time_to_beat_normally_seconds integer,
  add column time_to_beat_completely_seconds integer,
  add column time_to_beat_fetched_at timestamptz;

comment on column public.game_tags.first_release_date is
  'IGDB games.first_release_date, converted from its unix-epoch-seconds timestamp via to_timestamp() — day precision at minimum (IGDB dates this at UTC midnight), never derived from a release year. NULL is only a real "IGDB has no release date for this game" once release_platform_fetched_at is set; before that it just means we have not looked yet.';

comment on column public.game_tags.release_platform_fetched_at is
  'When we last queried IGDB''s `games` endpoint for first_release_date + platforms on this row (bundled into the same games query as genre/theme resolution, so it costs no extra IGDB request on top of the existing tag fetch). NULL = never attempted with these fields — including for rows created before this column existed. Distinguishes "not fetched" from "IGDB has none" for first_release_date, platform_ids, and platform_names.';

comment on column public.game_tags.platform_ids is
  'IGDB games.platforms[].id. Same int[] shape as genre_ids, but nullable (unlike genre_ids'' NOT NULL DEFAULT ''{}'') because this column is being retrofitted onto pre-existing rows: NULL means release_platform_fetched_at has not run yet for this row; ''{}'' (once release_platform_fetched_at is set) means IGDB confirmed the game has no listed platforms. Never defaulted to ''{}'' on a failed/unattempted fetch.';

comment on column public.game_tags.platform_names is
  'IGDB games.platforms[].name, index-aligned with platform_ids. Same NULL-vs-''{}'' semantics as platform_ids — see that column''s comment.';

comment on column public.game_tags.time_to_beat_normally_seconds is
  'IGDB game_time_to_beats.normally, in SECONDS (IGDB''s native unit — not converted). Balanced playthrough: some side content, not completionist. This is the flavor drop_candidate_pool.time_to_beat_seconds already uses. NULL once time_to_beat_fetched_at is set means IGDB has no `normally` estimate for this game — never backfilled from `completely`.';

comment on column public.game_tags.time_to_beat_completely_seconds is
  'IGDB game_time_to_beats.completely, in SECONDS (IGDB''s native unit). 100%-completion playthrough — the flavor Short Stack and The Long Haul need; drop_candidate_pool does not carry this flavor at all. NULL once time_to_beat_fetched_at is set means IGDB has no `completely` estimate for this game — never derived/estimated from `normally`.';

comment on column public.game_tags.time_to_beat_fetched_at is
  'When we last queried IGDB''s `game_time_to_beats` endpoint for this game (a separate IGDB endpoint from the `games` query above, hence tracked separately from release_platform_fetched_at). NULL = never attempted. Distinguishes "not fetched" from "IGDB has no time-to-beat entry at all for this game" for both seconds columns.';
