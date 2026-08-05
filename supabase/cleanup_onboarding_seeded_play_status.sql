-- Cleanup: remove the play statuses that onboarding's favorites step invented.
--
-- ⚠️  NOT YET APPLIED, and deliberately NOT in supabase/migrations/ so that a
--     `db push` cannot run it by accident. Apply it by hand after sign-off, the
--     same way the other standalone scripts in this directory are applied.
--
-- ── What went wrong ─────────────────────────────────────────────────────────
-- From 2026-06-06 (commit 1a508b8) until this fix, finishing onboarding ran
-- setGameStatus(id, 'played') for each of the user's 3 favorite picks. Picking
-- a favorite is not a claim to have played anything, but that call wrote:
--   • game_trackers.status = 'played'
--   • activities  (activity_type='status_changed', metadata.to_status='played')
--   • activity_events (type='completed')
-- which in turn inflated the games-played stat, advanced the 2026 Challenge
-- (goalService counts DISTINCT igdb_game_id from exactly those activities
-- rows), and seeded the taste vector with a `finished` signal worth 3.0 points
-- per game. Favorites themselves were never written to users.favorite_games —
-- only to localStorage — so the picks did not even show up on the profile of
-- the user who made them when viewed from another device.
--
-- ── How the bad rows are identified ─────────────────────────────────────────
-- There is no provenance column, so the seeding is identified by its shape.
-- The onboarding loop is the only thing in the app that can produce all four
-- of these at once:
--   1. to_status='played' with from_status IS NULL   (writes onto a clean slate)
--   2. ≥2 such rows within a 3-second window          (a tight programmatic loop;
--      the observed bursts span ≤0.1s, which no human can do through the UI)
--   3. within 10 minutes of users.onboarded_at        (note: onboarded_at was
--      backfilled to created_at by 20260804140000, so for pre-August accounts
--      this reads as "just after signup", which is exactly when onboarding ran)
--   4. no play_sessions row for that game             (no evidence of real play)
--
-- Deliberately NOT matched, verified against production:
--   • 3 single status changes made minutes-to-days later, one of them from
--     'currently' → a real user marking a real game played.
--   • 1 tracker the user has since moved to 'playing' themselves — their
--     edit wins, so the row is left alone entirely.
--
-- ── Explicitly preserved ────────────────────────────────────────────────────
-- 2 of the 26 flagged games were REVIEWED by the user within 3 minutes of the
-- seed (Left 4 Dead 2, FIFA 18 — both rated 5). You do not review a game you
-- have not played, so those two keep their played status: a false positive
-- here would delete a real user's real history, which is worse than leaving
-- two rows over-counted.
--
-- ── Measured scope at time of writing ───────────────────────────────────────
--   26 activities rows          across 8 users   → 24 deleted, 2 preserved
--    3 activity_events rows     ('completed')    → 3 deleted
--    2 game_trackers rows       (still 'played') → status cleared
--    1 affected user has a user_goals row, so exactly one 2026 Challenge ring
--      is currently over-counted; it recomputes from activities on next read.
--
-- Everything below is idempotent and runs inside the migration's transaction.

begin;

create temporary table onboarding_seeded on commit drop as
with played as (
  select a.id,
         a.user_id,
         a.igdb_game_id,
         a.created_at,
         a.metadata->>'from_status' as from_status,
         extract(epoch from (a.created_at - u.onboarded_at)) as secs_after_onboard
  from public.activities a
  join public.users u on u.id = a.user_id
  where a.activity_type = 'status_changed'
    and a.metadata->>'to_status' = 'played'
),
bursts as (
  select p.*,
         count(*) over (
           partition by p.user_id
           order by p.created_at
           range between interval '3 seconds' preceding
                     and interval '3 seconds' following
         ) as burst_size
  from played p
)
select b.id as activity_id, b.user_id, b.igdb_game_id
from bursts b
where b.burst_size >= 2
  and b.from_status is null
  and b.secs_after_onboard between -30 and 600
  -- Real engagement overrides the heuristic.
  and not exists (
    select 1 from public.reviews r
    where r.user_id = b.user_id
      and r.igdb_game_id::text = b.igdb_game_id::text
  )
  and not exists (
    select 1 from public.play_sessions s
    where s.user_id = b.user_id
      and s.igdb_game_id::text = b.igdb_game_id::text
  );

-- 1. The tracker status itself. Only rows still sitting at 'played' are
--    touched: if the user has since moved the game to playing/dropped/want,
--    that is their own deliberate edit and it stands.
delete from public.game_trackers t
where t.status = 'played'
  and t.hours_played is not distinct from 0
  and t.rating is null
  and exists (
    select 1 from onboarding_seeded s
    where s.user_id = t.user_id
      and s.igdb_game_id::text = t.igdb_game_id::text
  );

-- 2. The 'completed' Pulse events — these are what the taste engine reads to
--    date a `finished` signal, and what rendered "finished a game" in feeds.
delete from public.activity_events e
where e.type = 'completed'
  and exists (
    select 1 from onboarding_seeded s
    where s.user_id = e.actor_user_id
      and s.igdb_game_id::text = e.entity_id
  );

-- 3. The activities rows. This is the one that unwinds the 2026 Challenge:
--    goalService counts DISTINCT igdb_game_id over exactly this predicate, so
--    the ring recomputes on next read with no further intervention.
delete from public.activities a
where a.id in (select activity_id from onboarding_seeded);

commit;

-- Taste vectors are derived, not authoritative: the next daily taste-engine
-- run rebuilds them from the corrected tables, and the affected users pick up
-- a `favorite` signal (1.5 pts) in place of the bogus `finished` one (3.0)
-- once their favorites sync to users.favorite_games.
