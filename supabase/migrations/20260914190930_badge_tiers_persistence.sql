-- Migration: server-side tiered badge persistence + computation (S16-4)
--
-- CONTEXT / WHAT WAS FOUND BEFORE WRITING THIS (see chat self-check for the
-- full write-up):
--   - public.user_badges ALREADY EXISTS (user_id, badge_id, earned_at) —
--     created well before this sprint (Sprint 5 P9) and used today by
--     src/services/badgeService.js (syncEarnedBadge / syncAllEarnedBadges),
--     badge_rarity(), and users.showcase_badges. It is single-tier: each
--     earnable threshold is its own badge_id row (e.g. 'reviewer-10').
--     This migration EXTENDS that table rather than creating a second one —
--     there is no separate S16-2 "achievements" table; S16-2
--     (20260914182910_streak_milestone_persistence) created a narrower
--     `user_streak_milestones` table scoped only to streak-day celebration
--     bookkeeping, which is reused (read-only) below for Kept the Fire.
--   - Old single-tier badge ids (reviewer-*, curator-*, player-*, etc.) are
--     left untouched. The new 32-badge catalogue below uses a disjoint id
--     namespace (one row per badge FAMILY, e.g. 'timekeeper', with a `tier`
--     column holding the highest tier reached), so there is no collision.
--
-- ── 1. Additive schema change ────────────────────────────────────────────
alter table public.user_badges
  add column if not exists tier text
    check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  add column if not exists current_value numeric,
  add column if not exists celebrated_at timestamptz;

comment on column public.user_badges.tier is
  'Highest tier reached for multi-tier (Sprint 16) badges. NULL for legacy single-tier badge rows and for multi-tier badges not yet earned at any tier. Monotonic: recompute_my_badges() never lowers this.';
comment on column public.user_badges.current_value is
  'Raw metric value as of the last recompute (e.g. session count, hours) — lets the client render progress toward the next tier without re-querying source tables.';
comment on column public.user_badges.celebrated_at is
  'Reserved for the unlock-watcher rework (separate prompt). NOT read or written by anything yet — recompute_my_badges() always leaves it NULL. Kept the Fire is silent by definition-side flag (see src/data/badges.js), not by this column.';

-- ── 2. Tier helpers (private schema — same convention as
--    private.actor_visible_to / private.is_blocked_between) ──────────────
create or replace function private.badge_tier_rank(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'platinum' then 4
    when 'gold' then 3
    when 'silver' then 2
    when 'bronze' then 1
    else 0
  end;
$$;

create or replace function private.badge_tier_for(
  p_value numeric, p_bronze numeric, p_silver numeric, p_gold numeric
)
returns text
language sql
immutable
as $$
  select case
    when p_value >= p_gold then 'gold'
    when p_value >= p_silver then 'silver'
    when p_value >= p_bronze then 'bronze'
    else null
  end;
$$;

-- ── 3. The computation RPC ────────────────────────────────────────────────
-- Chosen over per-table triggers: badge-relevant writes span five source
-- tables (play_sessions, game_trackers, reviews, journal_entries,
-- review_likes) plus a cross-table join (activities -> game_tags) for
-- Omnivore. Five+ triggers duplicating the "never regress a tier" upsert
-- logic would drift; one RPC keeps that logic in exactly one place. The
-- client calls this after any badge-relevant write (see PART 2 of the
-- chat report for the exact call sites) and once defensively on profile
-- mount. It always operates on auth.uid() — there is no user-id parameter,
-- so it cannot be called on someone else's behalf.
--
-- Cost: every subquery below is scoped to `user_id = v_user_id` and hits an
-- existing per-user index (idx_activities_user_created,
-- idx_journal_user_date, idx_reviews_user_id, idx_play_sessions_user_game /
-- _active, idx_review_likes_user, review_likes_review_id_user_id_key). For
-- a power user with e.g. 2,000 sessions / 500 reviews / 500 journal entries
-- this is ~12 indexed scans of a few hundred–few thousand rows each — low
-- tens of milliseconds, not a full-table scan. See self-check item 11 for
-- a measured number.
create or replace function public.recompute_my_badges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_timekeeper numeric;
  v_marathoner numeric;
  v_devoted numeric;
  v_critic numeric;
  v_chronicler numeric;
  v_finisher numeric;
  v_kept_the_fire numeric;
  v_honest numeric;
  v_full_picture numeric;
  v_omnivore numeric;
  v_regular numeric;
  v_resonant numeric;
begin
  if v_user_id is null then
    raise exception 'recompute_my_badges requires an authenticated user';
  end if;

  -- WAVE 1 -------------------------------------------------------------
  select count(*) into v_timekeeper
    from public.play_sessions where user_id = v_user_id;

  select coalesce(max(hours), 0) into v_marathoner
    from public.play_sessions where user_id = v_user_id;

  -- Devoted reads the maintained hours_played ROLLUP on game_trackers
  -- (see 20260723214254_play_sessions_hours_rollup_diary.sql — "never
  -- compute hours_played client-side"), not a fresh sum over play_sessions.
  select coalesce(max(hours_played), 0) into v_devoted
    from public.game_trackers where user_id = v_user_id;

  select count(*) into v_critic
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  select count(*) into v_chronicler
    from public.journal_entries
    where user_id = v_user_id and body is not null and length(trim(body)) > 0;

  -- Finisher (and nothing else in this function) reads completion EVENTS,
  -- never game_trackers.status — see the decoupling rule in the chat report.
  select count(distinct igdb_game_id) into v_finisher
    from public.activities
    where user_id = v_user_id
      and activity_type = 'status_changed'
      and metadata->>'to_status' = 'played';

  -- Kept the Fire REUSES S16-2's persisted highest-ever streak milestone
  -- (users.highest_streak_milestone, kept in sync by
  -- recordStreakMilestoneProgress in streakMilestoneService.js). This is
  -- deliberately NOT an independent streak computation.
  select coalesce(highest_streak_milestone, 0) into v_kept_the_fire
    from public.users where id = v_user_id;

  -- WAVE 2 (shipped — see chat report for the four moved to Wave 3) -----
  select count(*) into v_honest
    from public.reviews
    where user_id = v_user_id and body is not null and length(trim(body)) > 0
      and rating < 3;

  select count(*) into v_full_picture
    from public.journal_entries
    where user_id = v_user_id
      and mood is not null and hours_played is not null
      and body is not null and length(trim(body)) > 0;

  select count(distinct genre) into v_omnivore
    from (
      select distinct a.igdb_game_id
      from public.activities a
      where a.user_id = v_user_id
        and a.activity_type = 'status_changed'
        and a.metadata->>'to_status' = 'played'
    ) finished
    join public.game_tags gt on gt.igdb_game_id = finished.igdb_game_id
    cross join lateral unnest(gt.genre_names) as genre;

  select count(distinct date_trunc('month', played_on)) into v_regular
    from public.play_sessions
    where user_id = v_user_id and played_on is not null;

  select count(*) into v_resonant
    from public.review_likes rl
    join public.reviews r on r.id = rl.review_id
    where r.user_id = v_user_id;

  -- Upsert every computed badge. Tier is monotonic (GREATEST by rank) —
  -- current_value always reflects the live count, but a tier already
  -- reached can never be taken away by a later drop in the raw count.
  with computed(badge_id, value, new_tier) as (
    values
      ('timekeeper', v_timekeeper, private.badge_tier_for(v_timekeeper, 25, 150, 500)),
      ('marathoner', v_marathoner, private.badge_tier_for(v_marathoner, 4, 8, 12)),
      ('devoted', v_devoted, private.badge_tier_for(v_devoted, 50, 150, 400)),
      ('critic', v_critic, private.badge_tier_for(v_critic, 10, 50, 200)),
      ('chronicler', v_chronicler, private.badge_tier_for(v_chronicler, 15, 75, 250)),
      ('finisher', v_finisher, private.badge_tier_for(v_finisher, 10, 50, 150)),
      ('kept-the-fire', v_kept_the_fire, private.badge_tier_for(v_kept_the_fire, 7, 30, 100)),
      ('honest', v_honest, private.badge_tier_for(v_honest, 5, 20, 60)),
      ('full-picture', v_full_picture, private.badge_tier_for(v_full_picture, 10, 50, 150)),
      ('omnivore', v_omnivore, private.badge_tier_for(v_omnivore, 5, 12, 20)),
      ('regular', v_regular, private.badge_tier_for(v_regular, 3, 12, 24)),
      ('resonant', v_resonant, private.badge_tier_for(v_resonant, 25, 150, 500))
  )
  insert into public.user_badges (user_id, badge_id, tier, current_value, earned_at)
  select v_user_id, badge_id, new_tier, value, now()
  from computed
  on conflict (user_id, badge_id) do update
    set current_value = excluded.current_value,
        tier = case
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then excluded.tier
          else public.user_badges.tier
        end,
        earned_at = case
          when private.badge_tier_rank(excluded.tier) > private.badge_tier_rank(public.user_badges.tier)
            then now()
          else public.user_badges.earned_at
        end;
end;
$$;

-- Authenticated only — the function always targets auth.uid() internally
-- so there is no user-id argument to guard, but anon has no business
-- calling it at all.
revoke all on function public.recompute_my_badges() from public, anon;
grant execute on function public.recompute_my_badges() to authenticated;

-- ── 4. RLS ────────────────────────────────────────────────────────────────
-- No policy change: public.user_badges already has
-- `user_badges_select_visible` ("own rows, or not blocked" — the same
-- shape already governing review_likes / review_comments / review_pins /
-- comment_likes / user_streaks, i.e. the existing rule for social-visible
-- per-user content). That is a looser rule than
-- `private.actor_visible_to` (used by reviews / game_trackers / activities
-- / user_goals), which additionally respects the profile's follow-gated
-- activity_privacy setting. Badges have used the looser rule since Sprint
-- 5 P9 and this migration does not change that — see chat self-check item
-- 5 for the explicit "match it, do not invent a new rule" citation.
--
-- Writes go through recompute_my_badges() (SECURITY DEFINER, bypasses RLS,
-- always targets auth.uid()), so no new client-facing INSERT/UPDATE policy
-- is needed for the new columns.
