import { supabase } from './supabase'
import { getFollowing } from './followService'
import { hapticSuccess } from '../utils/haptics'

/**
 * Goal Service — escalating yearly game-count challenge.
 *
 * Schema (user_goals):
 *   user_id         uuid     PK (FK → users)
 *   year            smallint PK
 *   target          integer  (1–9999)  — current tier's absolute target
 *   tier            smallint            — current tier, starts at 1
 *   tier_base       integer             — cumulative-games threshold
 *                                         where the current tier started
 *                                         (0 for tier 1)
 *   goal_reached_at date | null         — local date the current tier's
 *                                         target was first reached
 *   created_at, updated_at timestamptz
 *
 * "Finished this year" is counted from the activities table:
 *   COUNT(DISTINCT igdb_game_id) WHERE activity_type = 'status_changed'
 *   AND metadata->>'to_status' = 'played'
 *   AND EXTRACT(YEAR FROM created_at) = <year>
 *
 * Only activities in Supabase are counted — never localStorage-only
 * data — so the number is always reproducible from real records.
 *
 * ── Escalating tiers ─────────────────────────────────────────────────
 * Reaching a tier's target climbs the goal by TIER_INCREMENT for the
 * next tier (15 -> 30 -> 45 -> 60 -> 75 -> ...), and keeps climbing
 * through the year. `current` (the real, cumulative games-finished
 * count) never resets — only `tier_base`/`target` move, so "progress
 * within the tier" is `current - tier_base` against `target - tier_base`.
 *
 * Reaching a tier shows a green "Goal reached!" celebration for the
 * REST of that in-app day (tracked via `goal_reached_at`). The next
 * time the app is opened on a later day, `resolveTierState` silently
 * advances to the next tier — no manual tap required. See
 * `resolveTierState` for the pure state-machine and `getGoalProgress`
 * for where it's applied + persisted.
 */

export const TIER_INCREMENT = 15

/**
 * Local calendar-day stamp ('YYYY-MM-DD'), used to detect "a new in-app
 * day has started" without any timezone/UTC surprises — this only ever
 * gets compared against another stamp produced the same way.
 * @param {Date} [date]
 * @returns {string}
 */
export function getLocalDateStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Pure tier state-machine — given the stored tier state, the user's
 * current (cumulative) finished-games count, and today's date stamp,
 * returns the resolved state for *today*.
 *
 * Rules:
 *   - While `goalReachedAt` is set to a PAST day (not today), the tier
 *     just-reached has already had its full celebration day — advance
 *     to the next tier (target += TIER_INCREMENT, tierBase = old
 *     target, goalReachedAt reset to null). Loops so a user who was
 *     away for a while and blew through multiple tiers still lands on
 *     the correct current tier.
 *   - After any advances, if `current` already meets the (possibly
 *     new) tier's target and today hasn't been recorded yet, stamp
 *     `goalReachedAt` = today — this starts (or re-starts, for a
 *     freshly-advanced tier) that tier's one-day celebration.
 *
 * @param {{ target: number, tier: number, tierBase: number, goalReachedAt: string|null }} goal
 * @param {number} current
 * @param {string} todayStamp
 * @returns {{ state: { target: number, tier: number, tierBase: number, goalReachedAt: string|null }, changed: boolean }}
 */
export function resolveTierState(goal, current, todayStamp) {
  let state = {
    target: goal.target,
    tier: goal.tier ?? 1,
    tierBase: goal.tierBase ?? 0,
    goalReachedAt: goal.goalReachedAt ?? null,
  }
  let changed = false

  // A goal_reached_at from a prior day means that tier's celebration
  // day has fully elapsed — climb to the next tier(s).
  while (state.goalReachedAt && state.goalReachedAt !== todayStamp) {
    state = {
      target: state.target + TIER_INCREMENT,
      tier: state.tier + 1,
      tierBase: state.target,
      goalReachedAt: null,
    }
    changed = true
  }

  // Newly reaching (or re-reaching, right after an advance) the
  // current tier's target — start today's celebration.
  if (current >= state.target && state.goalReachedAt !== todayStamp) {
    state = { ...state, goalReachedAt: todayStamp }
    changed = true
  }

  return { state, changed }
}

/* ──────────────────────────────────────────────────────────────────────
   getGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Fetch the goal row for (userId, year). Returns null when not set.
 * @param {string} userId
 * @param {number} year
 * @returns {Promise<{ userId: string, year: number, target: number, tier: number, tierBase: number, goalReachedAt: string|null } | null>}
 */
export async function getGoal(userId, year) {
  if (!userId || !year) return null
  const { data, error } = await supabase
    .from('user_goals')
    .select('user_id, year, target, tier, tier_base, goal_reached_at')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle()

  if (error) {
    console.error('[goal] getGoal failed:', error.message)
    return null
  }
  if (!data) return null
  return {
    userId: data.user_id,
    year: data.year,
    target: data.target,
    tier: data.tier ?? 1,
    tierBase: data.tier_base ?? 0,
    goalReachedAt: data.goal_reached_at ?? null,
  }
}

/* ──────────────────────────────────────────────────────────────────────
   setGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Upsert the goal for (userId, year). Overwrites target if it already
 * exists, and (re)starts the escalating-tier ladder at tier 1 — this is
 * the "start a fresh yearly challenge" action, not a mid-ladder edit.
 * @param {string} userId
 * @param {number} year
 * @param {number} target  — must be 1–9999
 * @returns {Promise<boolean>}   true on success
 */
export async function setGoal(userId, year, target) {
  if (!userId || !year || !target) return false
  const clamped = Math.max(1, Math.min(9999, Math.round(target)))

  const { error } = await supabase.from('user_goals').upsert(
    {
      user_id: userId,
      year,
      target: clamped,
      tier: 1,
      tier_base: 0,
      goal_reached_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,year' }
  )
  if (error) {
    console.error('[goal] setGoal failed:', error.message)
    return false
  }
  return true
}

/* ──────────────────────────────────────────────────────────────────────
   persistTierState
   ────────────────────────────────────────────────────────────────────── */

/**
 * Write a resolved tier state back to the goal row — called by
 * `getGoalProgress` only when `resolveTierState` reports a change
 * (a tier just advanced and/or today's celebration was just stamped).
 * Best-effort: a failure here just means the next call re-resolves
 * from the same stored state, so it's logged rather than thrown.
 * @param {string} userId
 * @param {number} year
 * @param {{ target: number, tier: number, tierBase: number, goalReachedAt: string|null }} state
 */
async function persistTierState(userId, year, state) {
  const { error } = await supabase
    .from('user_goals')
    .update({
      target: state.target,
      tier: state.tier,
      tier_base: state.tierBase,
      goal_reached_at: state.goalReachedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('year', year)

  if (error) {
    console.error('[goal] persistTierState failed:', error.message)
  }
}

/* ──────────────────────────────────────────────────────────────────────
   deleteGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Remove the goal row so the user can start fresh.
 */
export async function deleteGoal(userId, year) {
  if (!userId || !year) return false
  const { error } = await supabase
    .from('user_goals')
    .delete()
    .eq('user_id', userId)
    .eq('year', year)
  if (error) {
    console.error('[goal] deleteGoal failed:', error.message)
    return false
  }
  return true
}

/* ──────────────────────────────────────────────────────────────────────
   countFinishedThisYear
   ────────────────────────────────────────────────────────────────────── */

/**
 * Count DISTINCT games the user marked as "played" (Finished) in a
 * given calendar year, using the activities table.
 *
 * A game is counted once even if the user toggled Played → Playing →
 * Played multiple times in the same year — we only need the distinct
 * igdb_game_id set, not the event count.
 *
 * @param {string} userId
 * @param {number} year   — defaults to current calendar year
 * @returns {Promise<number>}
 */
export async function countFinishedThisYear(userId, year = new Date().getFullYear()) {
  if (!userId) return 0
  const counts = await countFinishedThisYearForUsers([userId], year)
  return counts.get(userId) || 0
}

/* ──────────────────────────────────────────────────────────────────────
   countFinishedThisYearForUsers
   ────────────────────────────────────────────────────────────────────── */

/**
 * Same as `countFinishedThisYear`, but for many users in ONE query
 * instead of one query per user.
 *
 * getRivalryData used to call `countFinishedThisYear` once per followee
 * (up to 20 extra round-trips on top of the `getFollowing` call itself).
 * This fetches every matching activity row for the whole batch of user
 * ids up front and buckets/dedupes the distinct igdb_game_id set per
 * user in JS — one round-trip no matter how many followees there are.
 *
 * @param {string[]} userIds
 * @param {number} [year]
 * @returns {Promise<Map<string, number>>} userId -> distinct Finished count
 */
export async function countFinishedThisYearForUsers(userIds, year = new Date().getFullYear()) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)))
  if (!ids.length) return new Map()

  const yearStart = `${year}-01-01T00:00:00.000Z`
  const yearEnd   = `${year + 1}-01-01T00:00:00.000Z`

  const { data, error } = await supabase
    .from('activities')
    .select('user_id, igdb_game_id')
    .in('user_id', ids)
    .eq('activity_type', 'status_changed')
    .eq('metadata->>to_status', 'played')
    .gte('created_at', yearStart)
    .lt('created_at', yearEnd)
    .not('igdb_game_id', 'is', null)

  if (error) {
    console.error('[goal] countFinishedThisYearForUsers failed:', error.message)
    return new Map()
  }

  // Deduplicate per-user in JS (a user might mark the same game played
  // twice after un-marking it — we only want the distinct game set).
  const uniqueGamesByUser = new Map()
  for (const row of data || []) {
    let set = uniqueGamesByUser.get(row.user_id)
    if (!set) {
      set = new Set()
      uniqueGamesByUser.set(row.user_id, set)
    }
    set.add(row.igdb_game_id)
  }

  const counts = new Map()
  for (const id of ids) counts.set(id, uniqueGamesByUser.get(id)?.size || 0)
  return counts
}

/* ──────────────────────────────────────────────────────────────────────
   getFinishedGamesThisYear
   ────────────────────────────────────────────────────────────────────── */

/**
 * The actual games behind `countFinishedThisYear`'s number — the distinct
 * set the user marked "played" during `year`, newest completion first.
 *
 * `countFinishedThisYear` runs the same query but discards the game ids
 * after counting, so the challenge detail screen would otherwise have no
 * way to show its own contents. Both read the activities table, so the
 * list length always matches the ring's `current`.
 *
 * Covers aren't denormalised onto every activity row, so we backfill them
 * from the user's tracker rows and reviews. A game with no cover on record
 * is returned with `image: null` rather than a placeholder — the caller
 * renders an initial instead.
 *
 * @param {string} userId
 * @param {number} [year]
 * @returns {Promise<Array<{ igdbGameId: number, title: string|null, image: string|null, completedAt: string }>>}
 */
export async function getFinishedGamesThisYear(userId, year = new Date().getFullYear()) {
  if (!userId) return []

  const yearStart = `${year}-01-01T00:00:00.000Z`
  const yearEnd   = `${year + 1}-01-01T00:00:00.000Z`

  const { data, error } = await supabase
    .from('activities')
    .select('igdb_game_id, metadata, created_at')
    .eq('user_id', userId)
    .eq('activity_type', 'status_changed')
    .eq('metadata->>to_status', 'played')
    .gte('created_at', yearStart)
    .lt('created_at', yearEnd)
    .not('igdb_game_id', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[goal] getFinishedGamesThisYear failed:', error.message)
    return []
  }

  // Newest-first order means the first row we see per game is its most
  // recent completion — keep that one and drop the re-marks.
  const byGame = new Map()
  for (const row of data || []) {
    const id = Number(row.igdb_game_id)
    if (byGame.has(id)) continue
    byGame.set(id, {
      igdbGameId: id,
      title: row.metadata?.game_title || null,
      image: row.metadata?.game_image || null,
      completedAt: row.created_at,
    })
  }

  const games = Array.from(byGame.values())
  const needCovers = games.filter((g) => !g.image).map((g) => g.igdbGameId)
  if (needCovers.length === 0) return games

  const [trackerResult, reviewResult] = await Promise.all([
    supabase
      .from('game_trackers')
      .select('igdb_game_id, game_image, game_title')
      .eq('user_id', userId)
      .in('igdb_game_id', needCovers),
    supabase
      .from('reviews')
      .select('igdb_game_id, game_image, game_title')
      .eq('user_id', userId)
      .in('igdb_game_id', needCovers),
  ])

  const covers = new Map()
  const titles = new Map()
  for (const rows of [trackerResult.data, reviewResult.data]) {
    for (const row of rows || []) {
      const id = Number(row.igdb_game_id)
      if (row.game_image && !covers.has(id)) covers.set(id, row.game_image)
      if (row.game_title && !titles.has(id)) titles.set(id, row.game_title)
    }
  }

  return games.map((g) =>
    g.image
      ? g
      : { ...g, image: covers.get(g.igdbGameId) || null, title: g.title || titles.get(g.igdbGameId) || null }
  )
}

/* ──────────────────────────────────────────────────────────────────────
   getGoalProgress
   ────────────────────────────────────────────────────────────────────── */

/**
 * Convenience: fetch goal + current count in one call.
 *
 * `target`/`percent` describe the CURRENT TIER only — see the
 * "Escalating tiers" note above. Reaching a tier auto-persists that
 * fact (`goal_reached_at`); on a later day this same call transparently
 * advances to the next tier before computing the returned values, so
 * callers never need to think about tiers explicitly.
 *
 * Returns:
 *   {
 *     hasGoal:       boolean,
 *     target:        number | null,   — null when no goal is set; else
 *                                       the CURRENT TIER's absolute target
 *     current:       number,          — distinct Finished games this year
 *                                       (cumulative, never resets)
 *     year:          number,
 *     percent:       number,          — 0–100 within the current tier
 *     tier:          number,          — current tier (1-based)
 *     tierBase:      number,          — threshold where this tier started
 *     goalReachedAt: string | null,   — local date this tier's target
 *                                       was first reached (celebration
 *                                       shows while this equals today)
 *   }
 */
export async function getGoalProgress(userId, year = new Date().getFullYear()) {
  if (!userId) {
    return { hasGoal: false, target: null, current: 0, year, percent: 0, tier: 1, tierBase: 0, goalReachedAt: null }
  }

  const [goal, current] = await Promise.all([
    getGoal(userId, year),
    countFinishedThisYear(userId, year),
  ])

  if (!goal) {
    return { hasGoal: false, target: null, current, year, percent: 0, tier: 1, tierBase: 0, goalReachedAt: null }
  }

  const todayStamp = getLocalDateStamp()
  const { state, changed } = resolveTierState(goal, current, todayStamp)
  if (changed) {
    await persistTierState(userId, year, state)
    // Fire only on the transition into a freshly-reached tier (not on a
    // silent tier-advance with no new reach) — one-shot per tier, since
    // a later call this same day will already see goalReachedAt === today
    // and skip the `changed` branch entirely.
    if (state.goalReachedAt === todayStamp) {
      hapticSuccess()
    }
  }

  const tierSpan = Math.max(1, state.target - state.tierBase)
  const percent = Math.min(100, Math.round(((current - state.tierBase) / tierSpan) * 100))

  return {
    hasGoal: true,
    target: state.target,
    current,
    year,
    percent,
    tier: state.tier,
    tierBase: state.tierBase,
    goalReachedAt: state.goalReachedAt,
  }
}

/* ──────────────────────────────────────────────────────────────────────
   computePace
   ────────────────────────────────────────────────────────────────────── */

/**
 * Compare how many games the user has finished against how many they
 * "should" have finished by today, given a uniform distribution across
 * the year.
 *
 * @param {{ hasGoal: boolean, target: number|null, current: number, year: number }} goalProgress
 * @returns {{ status: 'ahead'|'on-track'|'behind', games: number, label: string } | null}
 *          null when no goal is set.
 */
export function computePace({ hasGoal, target, current, year }) {
  if (!hasGoal || !target) return null

  const now = new Date()
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0)
  const msPerDay = 24 * 60 * 60 * 1000
  // daysElapsed: at least 1 so Jan 1 itself isn't 0/365
  const daysElapsed = Math.max(1, Math.floor((now - yearStart) / msPerDay) + 1)
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const totalDays = isLeap ? 366 : 365

  const expectedByNow = (target * daysElapsed) / totalDays
  const delta = current - expectedByNow
  const roundedDelta = Math.round(delta)

  if (roundedDelta > 0) {
    const g = roundedDelta
    return { status: 'ahead', games: g, label: `${g} ${g === 1 ? 'game' : 'games'} ahead of schedule` }
  }
  if (roundedDelta < 0) {
    const g = Math.abs(roundedDelta)
    return { status: 'behind', games: g, label: `${g} ${g === 1 ? 'game' : 'games'} behind schedule` }
  }
  return { status: 'on-track', games: 0, label: 'On track' }
}

/* ──────────────────────────────────────────────────────────────────────
   computeMilestoneBeat
   ────────────────────────────────────────────────────────────────────── */

/**
 * Returns the highest milestone number the user has already crossed,
 * or null if they haven't hit any yet. Milestone step is derived from
 * the target so it's proportional to the goal size.
 *
 * @param {number} current
 * @param {number|null} target
 * @returns {number|null}
 */
export function computeMilestoneBeat(current, target) {
  if (!current || current <= 0) return null
  const n = milestoneStep(target)
  const beat = Math.floor(current / n) * n
  return beat > 0 ? beat : null
}

function milestoneStep(target) {
  if (!target || target <= 10) return 1
  if (target <= 25) return 5
  if (target <= 100) return 10
  return 25
}

/* ──────────────────────────────────────────────────────────────────────
   getRivalryData
   ────────────────────────────────────────────────────────────────────── */

/**
 * Return game-count progress (this calendar year) for the people the
 * current user follows, so we can render a "friendly rivalry" leaderboard.
 *
 * Each entry: { userId, username, current }
 * Sorted descending by current. Entries with 0 games are included only
 * if they would otherwise produce an empty list; the caller can filter
 * further.
 *
 * Two queries total regardless of follow-list size — `getFollowing`
 * plus ONE grouped aggregate via `countFinishedThisYearForUsers` — where
 * this used to be `getFollowing` + one `countFinishedThisYear` call PER
 * followee (as many as 21 queries for a maxed-out 20-follow list).
 *
 * @param {string} userId     — signed-in user's id
 * @param {number} [year]
 * @returns {Promise<Array<{ userId: string, username: string, current: number }>>}
 */
export async function getRivalryData(userId, year = new Date().getFullYear()) {
  if (!userId) return []

  const followRows = await getFollowing(userId, 20, 0)
  if (!followRows.length) return []

  const followeeIds = followRows.map((row) => row.followee_id)
  const counts = await countFinishedThisYearForUsers(followeeIds, year)

  const results = followRows.map((row) => {
    const fid = row.followee_id
    const u = row.followee
    return {
      userId: fid,
      username: u?.username || u?.display_name || 'user',
      current: counts.get(fid) || 0,
    }
  })

  return results.sort((a, b) => b.current - a.current)
}
