// Library Service - manages game lists and trackers
import { logActivity } from './activityService'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
  logCompletedEventOnce,
} from './activityEventsService'
import { getTracker } from './hoursService'
import { queueCelebration, updateCelebrationStats } from './celebrationService'
import { countFinishedThisYear } from './goalService'
import { supabase } from './supabase'
import { recomputeBadges } from './badgeService'
import { showToast } from '../components/Toast'
import { STATUS_META } from '../components/StatusChip'
import { isQuotaExceededError } from '../utils/storageQuota'

// Map tracker status → Pulse activity_event type. 'want' maps to
// 'backlogged' — Home-hub sprint: this is surfaced on the viewer's own
// Home feed (see communityService.getHomeFeed), but Explore/Collections
// still don't treat it as circle-worthy activity (neither reads
// 'backlogged' out of activity_events today).
const STATUS_TO_EVENT_TYPE = {
  want: ACTIVITY_EVENT_TYPES.BACKLOGGED,
  currently: ACTIVITY_EVENT_TYPES.STARTED,
  played: ACTIVITY_EVENT_TYPES.COMPLETED,
  dropped: ACTIVITY_EVENT_TYPES.DROPPED,
}

const LIBRARY_STORAGE_KEY = 'gameLibrary'
const PROGRESS_STORAGE_KEY = 'gameProgress'
const BACKLOG_CLEARS_KEY = 'backlogClears_v1'

// backlogClears_v1 grows one entry per backlog-clear with no eviction —
// each entry is tiny ({gameId, clearedAt}) but it is genuinely unbounded,
// same class of bug as gt:swipes:v1 (see swipeService.js). Capped here for
// the same reason: nothing downstream (getBacklogClearsThisYear) needs
// more than a year or two of history. Oldest-first eviction.
const MAX_BACKLOG_CLEARS = 500

/**
 * Distinct error class for a localStorage write that failed even after the
 * prune-and-retry in saveLibrary() below. Exported so a caller that DOES
 * want to tell quota apart from "list doesn't exist" / "already in list"
 * can `err instanceof LibraryQuotaError` instead of string-matching.
 * Nothing in this file throws this to a caller that isn't already
 * try/catching (see saveLibrary) — it exists for callers that want it, not
 * as a new way for an unrelated write to crash.
 */
export class LibraryQuotaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LibraryQuotaError'
  }
}

// Last storage-layer failure from saveLibrary(), for callers that want to
// show a distinct message instead of a generic "could not update" toast —
// see getLastLibraryError(). Reset to null on every successful save.
let lastLibraryError = null

/** The most recent saveLibrary() failure, or null if the last save (or the
 *  last check) succeeded. Shape: `{ code: 'quota'|'unknown', message }`. */
export function getLastLibraryError() {
  return lastLibraryError
}

// WHY: writing full IGDB payloads into localStorage exhausted the WKWebView
// quota on device, which silently broke every status write and the swipe-deck
// exclude set. It did not reproduce in a browser, where the quota is far
// larger. Do not strip this as dead weight.
/**
 * The ONLY shape a game row inside library.lists / library.customLists may
 * ever have. Every write path into a library list must go through this —
 * spreading a raw canonical Game object (screenshots, websites, keywords,
 * themes, tagIds, description, platforms, developers, publishers...) here
 * is what wrote entire IGDB API responses into localStorage and exhausted
 * a WKWebView's quota after only a handful of games (see the migration
 * below for the one-time cleanup of rows already written this way).
 *
 * `id` is always coerced to a String. normalizeGame() (src/services/
 * normalizeGame.js) carries through IGDB's numeric `id` unchanged, so any
 * write path that persists a raw/canonical Game object's `.id` directly
 * writes a NUMBER — which then silently fails every `String(g.id) ===`
 * lookup elsewhere in this file (getGameStatus, isGameInList,
 * getSwipeExcludeIds's String(game.id) callers, etc). Stringifying at the
 * single choke point here is cheaper than auditing every read site.
 *
 * `year` / `genre` / `rating` are kept (not just id/title/image/addedAt)
 * because they're genuinely read for display/signal elsewhere —
 * swipeService.getTasteSignal() and dnaService both read genre/rating/year
 * off "played"/backlog library rows. Nothing bigger than that (no arrays
 * of objects, no free-text description, no screenshots) belongs here.
 */
function toSlimLibraryGame(game, addedAt) {
  return {
    id: String(game.id),
    title: game.title || '',
    image: game.image || game.coverUrl || null,
    addedAt: addedAt || game.addedAt || new Date().toISOString(),
    year: game.year ?? null,
    genre: game.genre ?? null,
    rating: game.rating ?? null,
  }
}

/**
 * Re-slim every game row across every list, IN PLACE, on the exact object
 * passed in (never re-reads from storage — that could race with whatever
 * in-memory mutation the caller is about to persist and silently drop it).
 * Used by saveLibrary()'s prune-and-retry and by the one-time migration
 * below, which additionally measures before/after.
 *
 * Never drops a row — only sheds fields on rows that are already objects
 * with an `id`. A malformed row (no id) is left untouched rather than
 * guessed at.
 *
 * @returns {boolean} true if anything was actually rewritten (i.e. some row
 *   wasn't already in the slim shape) — callers use this to know whether
 *   the retry is even worth attempting.
 */
function slimLibraryInPlace(library) {
  let changed = false
  const slimList = (list) => {
    if (!list || !Array.isArray(list.games)) return
    list.games = list.games.map((g) => {
      if (!g || g.id == null) return g
      const slim = toSlimLibraryGame(g)
      const isAlreadySlim =
        typeof g.id === 'string' &&
        Object.keys(g).length <= Object.keys(slim).length &&
        Object.keys(g).every((k) => k in slim)
      if (!isAlreadySlim) changed = true
      return slim
    })
  }
  Object.values(library.lists || {}).forEach(slimList)
  Object.values(library.customLists || {}).forEach(slimList)
  return changed
}

/**
 * Cap backlogClears_v1 at MAX_BACKLOG_CLEARS, oldest-first eviction.
 * @returns {boolean} true if anything was evicted.
 */
function pruneBacklogClears() {
  try {
    const stored = localStorage.getItem(BACKLOG_CLEARS_KEY)
    if (!stored) return false
    const clears = JSON.parse(stored)
    if (!Array.isArray(clears) || clears.length <= MAX_BACKLOG_CLEARS) return false
    const trimmed = clears.slice(clears.length - MAX_BACKLOG_CLEARS)
    localStorage.setItem(BACKLOG_CLEARS_KEY, JSON.stringify(trimmed))
    return true
  } catch {
    return false
  }
}

const DEFAULT_LISTS = {
  'currently-playing': { name: STATUS_META.currently.label, games: [] },
  'played': { name: STATUS_META.played.label, games: [] },
  'want-to-play': { name: STATUS_META.want.label, games: [] },
  'dropped': { name: STATUS_META.dropped.label, games: [] },
}

const STATUS_LIST_MAP = {
  want: 'want-to-play',
  currently: 'currently-playing',
  played: 'played',
  dropped: 'dropped',
}

const LIST_STATUS_MAP = {
  'want-to-play': 'want',
  'currently-playing': 'currently',
  'played': 'played',
  'dropped': 'dropped',
}

/**
 * Local status key → the value `game_trackers.status` actually accepts.
 *
 * These two vocabularies were never the same. `game_trackers_status_check`
 * allows ('want_to_play','playing','played','dropped'); the local library
 * speaks ('want','currently','played','dropped'). Backlog syncs wrote the
 * LOCAL word 'want', so Postgres rejected every one of them — the upsert
 * error is logged and swallowed, so this failed silently for as long as the
 * sync has existed (the live table held zero backlog rows). Any server-side
 * feature reading backlog intent saw an empty backlog for every user.
 */
export const TRACKER_STATUS = Object.freeze({
  want: 'want_to_play',
  currently: 'playing',
  played: 'played',
  dropped: 'dropped',
})

/** Inverse of TRACKER_STATUS — server vocabulary back to the local one. */
const LOCAL_STATUS = Object.freeze(
  Object.fromEntries(Object.entries(TRACKER_STATUS).map(([local, remote]) => [remote, local]))
)

/**
 * Mirror one status change into `game_trackers`. Fire-and-forget: callers
 * write localStorage first and never await this, so a failed/offline sync
 * can't roll back or delay the optimistic local change.
 *
 * Without this, statuses set from the game screen only ever existed on the
 * device that set them, while `game_trackers` (written by the backlog
 * quick-add and session paths) held a different set — which is how the
 * Library status cells and the Profile games numeral ended up disagreeing.
 */
function syncStatusToServer(gameId, localStatus, game) {
  const remoteStatus = TRACKER_STATUS[localStatus]
  if (!remoteStatus) return
  ;(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.id) return
      const { error } = await supabase.from('game_trackers').upsert(
        {
          user_id: user.id,
          igdb_game_id: String(gameId),
          status: remoteStatus,
          game_title: game?.title || null,
          game_image: game?.image || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,igdb_game_id' }
      )
      if (error) console.error('[library] status sync failed:', error.message)
    } catch (err) {
      console.error('[library] status sync crashed:', err)
    }
  })()
}

/**
 * Reconcile localStorage status buckets with `game_trackers` for the
 * signed-in user. Runs once per login (see AuthContext).
 *
 * Two-way and non-destructive, because neither side is a strict superset of
 * the other: statuses set on another device only exist on the server, and
 * statuses set before this sync existed only exist locally. A game the
 * server knows about and this device doesn't is pulled into the matching
 * bucket; a game this device knows about is pushed up. On a genuine
 * conflict the local status wins and overwrites the server row — it's the
 * one the user is currently looking at.
 */
export async function syncTrackersWithServer(userId) {
  if (!userId) return { pulled: 0, pushed: 0, skipped: true }
  try {
    const { data, error } = await supabase
      .from('game_trackers')
      .select('igdb_game_id, status, game_title, game_image, updated_at')
      .eq('user_id', userId)
    if (error) {
      console.error('[library] syncTrackersWithServer failed:', error.message)
      return { pulled: 0, pushed: 0, error }
    }

    const library = getLibrary() || initializeLibrary()
    const localStatuses = new Map()
    for (const [listId, status] of Object.entries(LIST_STATUS_MAP)) {
      for (const g of library.lists?.[listId]?.games || []) {
        if (g?.id != null) localStatuses.set(String(g.id), { status, game: g })
      }
    }

    let pulled = 0
    for (const row of data || []) {
      const id = String(row.igdb_game_id)
      if (localStatuses.has(id)) continue
      const listId = STATUS_LIST_MAP[LOCAL_STATUS[row.status]]
      if (!listId) continue
      if (!library.lists[listId]) library.lists[listId] = { ...DEFAULT_LISTS[listId], games: [] }
      if (!library.lists[listId].games) library.lists[listId].games = []
      library.lists[listId].games.push({
        id,
        title: row.game_title || '',
        image: row.game_image || null,
        addedAt: row.updated_at || new Date().toISOString(),
      })
      pulled++
    }
    if (pulled > 0) saveLibrary(library)

    const remoteStatuses = new Map(
      (data || []).map((row) => [String(row.igdb_game_id), row.status])
    )
    const toPush = []
    for (const [id, { status, game }] of localStatuses) {
      const remoteStatus = TRACKER_STATUS[status]
      if (remoteStatuses.get(id) === remoteStatus) continue
      toPush.push({
        user_id: userId,
        igdb_game_id: id,
        status: remoteStatus,
        game_title: game.title || null,
        game_image: game.image || null,
      })
    }
    if (toPush.length > 0) {
      const { error: pushErr } = await supabase
        .from('game_trackers')
        .upsert(toPush, { onConflict: 'user_id,igdb_game_id' })
      if (pushErr) console.error('[library] tracker push failed:', pushErr.message)
    }

    if (pulled > 0) window.dispatchEvent(new Event('libraryUpdated'))
    return { pulled, pushed: toPush.length }
  } catch (err) {
    console.error('[library] syncTrackersWithServer crashed:', err)
    return { pulled: 0, pushed: 0, error: err }
  }
}

/**
 * Record that a game was cleared out of the backlog.
 * Called by setGameStatus whenever a game moves away from 'want'.
 */
export function recordBacklogClear(gameId) {
  const stored = localStorage.getItem(BACKLOG_CLEARS_KEY)
  const clears = stored ? JSON.parse(stored) : []
  clears.push({ gameId: String(gameId), clearedAt: new Date().toISOString() })
  // Cap inline (not just via the app-start prune) so a single very long
  // session can't grow this unbounded between app starts either.
  const capped =
    clears.length > MAX_BACKLOG_CLEARS
      ? clears.slice(clears.length - MAX_BACKLOG_CLEARS)
      : clears
  localStorage.setItem(BACKLOG_CLEARS_KEY, JSON.stringify(capped))
}

/**
 * How many backlog games have been cleared since Jan 1 of the current year.
 */
export function getBacklogClearsThisYear() {
  const stored = localStorage.getItem(BACKLOG_CLEARS_KEY)
  if (!stored) return 0
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
  return JSON.parse(stored).filter(
    (c) => new Date(c.clearedAt).getTime() >= yearStart,
  ).length
}

// Initialize library with default lists. An older localStorage library
// can be missing keys added later (e.g. `dropped`); merge those in so
// setGameStatus never reads `library.lists[targetList]` as undefined.
export function initializeLibrary() {
  const existing = getLibrary()
  if (!existing || !existing.lists) {
    const library = {
      lists: Object.fromEntries(
        Object.entries(DEFAULT_LISTS).map(([key, def]) => [
          key,
          { name: def.name, games: [] },
        ]),
      ),
      customLists: {},
    }
    saveLibrary(library)
    return library
  }

  let missing = false
  for (const [key, def] of Object.entries(DEFAULT_LISTS)) {
    const list = existing.lists[key]
    if (!list || typeof list !== 'object' || Array.isArray(list)) {
      existing.lists[key] = { name: def.name, games: [] }
      missing = true
    } else if (!Array.isArray(list.games)) {
      list.games = []
      missing = true
    }
  }
  if (missing) saveLibrary(existing)
  return existing
}

// Get entire library
export function getLibrary() {
  const stored = localStorage.getItem(LIBRARY_STORAGE_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  return null
}

function tryWriteLibrary(library) {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library))
    return true
  } catch (err) {
    if (!isQuotaExceededError(err)) {
      console.error('[library] saveLibrary failed (non-quota):', err)
    }
    return false
  }
}

/**
 * Save library. Returns true on success, false if the write could not be
 * persisted even after a prune-and-retry (previously this threw
 * QuotaExceededError straight out of localStorage.setItem — callers that
 * didn't wrap it in try/catch, e.g. addGameToList()'s callers in
 * SwipeDeck/AddToListButton, would crash rather than degrade).
 *
 * On quota exhaustion:
 *   1. Re-slim the EXACT object being saved (see slimLibraryInPlace) and
 *      cap backlogClears_v1 — the two unbounded stores this file owns.
 *      (Cannot reach into swipeService's gt:swipes:v1 here: swipeService
 *      already imports FROM this file, so calling back into it would be
 *      circular. Its own writeStore() does the equivalent prune-and-retry
 *      independently — see swipeService.js.)
 *   2. Retry the write once.
 *   3. If it still fails, this is a genuine, materially-full device quota
 *      (Fix 1/2/3 should make this rare) — surface a distinct, honest
 *      toast from here, the one place every library write funnels
 *      through, so it fires regardless of which caller (status tile,
 *      backlog add, custom list) triggered it, and record it via
 *      getLastLibraryError() so a caller with its own toast (e.g.
 *      addGameToBacklog below, GameDetail's status tiles) can show this
 *      message instead of a generic "could not update" one.
 */
export function saveLibrary(library) {
  if (tryWriteLibrary(library)) {
    lastLibraryError = null
    return true
  }

  let recovered = false
  try {
    if (slimLibraryInPlace(library)) recovered = true
  } catch (err) {
    console.error('[library] slimLibraryInPlace during quota recovery failed:', err)
  }
  try {
    if (pruneBacklogClears()) recovered = true
  } catch (err) {
    console.error('[library] pruneBacklogClears during quota recovery failed:', err)
  }

  if (tryWriteLibrary(library)) {
    lastLibraryError = recovered
      ? { code: 'quota-recovered', message: 'Freed up on-device storage automatically.' }
      : null
    return true
  }

  const message =
    "Your device is out of storage for GameTracker. Free up space (Settings → General → iPhone Storage) and try again."
  lastLibraryError = { code: 'quota', message }
  console.error('[library] saveLibrary failed after prune-and-retry: quota exceeded')
  try {
    showToast(message, 'error', 4000)
  } catch {
    // Toast host not mounted yet — non-fatal.
  }
  return false
}

// WHY: writing full IGDB payloads into localStorage exhausted the WKWebView
// quota on device, which silently broke every status write and the swipe-deck
// exclude set. It did not reproduce in a browser, where the quota is far
// larger. This rewrites rows already stored that way. Do not strip it.
/**
 * One-time (but always safe to re-run — fully idempotent) migration:
 * rewrite every game row in gameLibrary down to the slim shape defined by
 * toSlimLibraryGame(), reclaiming whatever bloat (full IGDB payloads,
 * mostly) has accumulated from a historical write path that spread a raw
 * game object into a list. Never drops a game — array lengths in and out
 * are always equal; only fields are shed.
 *
 * Safe to call on every app start: a library that's already fully slim
 * is detected (slimLibraryInPlace returns false) and this becomes a
 * cheap no-op read with byte counts equal before/after.
 *
 * @returns {{
 *   ran: boolean,            // false only when there was no library to migrate
 *   changed: boolean,        // true if any row was actually rewritten
 *   bytesBefore: number,
 *   bytesAfter: number,
 *   bytesReclaimed: number,
 *   countsBefore: Record<string, number>,  // listId → game count
 *   countsAfter: Record<string, number>,
 * }}
 */
export function migrateLibraryToSlimShape() {
  const raw = localStorage.getItem(LIBRARY_STORAGE_KEY)
  if (!raw) return { ran: false, changed: false, bytesBefore: 0, bytesAfter: 0, bytesReclaimed: 0, countsBefore: {}, countsAfter: {} }

  const bytesBefore = raw.length * 2 // UTF-16
  const library = JSON.parse(raw)

  const countGames = (lib) => {
    const counts = {}
    for (const [listId, list] of Object.entries(lib.lists || {})) {
      counts[listId] = Array.isArray(list.games) ? list.games.length : 0
    }
    for (const [listId, list] of Object.entries(lib.customLists || {})) {
      counts[listId] = Array.isArray(list.games) ? list.games.length : 0
    }
    return counts
  }

  const countsBefore = countGames(library)
  const changed = slimLibraryInPlace(library)
  const countsAfter = countGames(library)

  if (!changed) {
    return { ran: true, changed: false, bytesBefore, bytesAfter: bytesBefore, bytesReclaimed: 0, countsBefore, countsAfter }
  }

  const nextRaw = JSON.stringify(library)
  const bytesAfter = nextRaw.length * 2
  // Direct write (not saveLibrary/tryWriteLibrary): if THIS write somehow
  // still hits quota — the migration is actively trying to shrink the
  // payload, so a smaller-but-still-too-big result is a real edge case —
  // fall back to the exact same prune-and-retry saveLibrary already does
  // rather than duplicating it.
  if (!tryWriteLibrary(library)) {
    saveLibrary(library)
  }

  return {
    ran: true,
    changed: true,
    bytesBefore,
    bytesAfter,
    bytesReclaimed: bytesBefore - bytesAfter,
    countsBefore,
    countsAfter,
  }
}

/**
 * Drop the local tracker library, per-game progress and backlog-clear log.
 *
 * This is the store that leaked accounts into each other: `gameLibrary` is a
 * single un-namespaced key, and syncTrackersWithServer() PUSHES whatever it
 * finds there to `game_trackers` under the currently-signed-in user. Left in
 * place across a user switch, it doesn't just render the previous account's
 * library — it writes it into the new account server-side. The authoritative
 * copy is `game_trackers`, which the same sync pulls back down, so clearing
 * here costs a signed-in user nothing.
 */
export function clearLibrary() {
  for (const key of [
    LIBRARY_STORAGE_KEY,
    PROGRESS_STORAGE_KEY,
    BACKLOG_CLEARS_KEY,
  ]) {
    try {
      localStorage.removeItem(key)
    } catch {
      // best-effort
    }
  }
}

// Get games from a specific list
export function getGamesFromList(listId) {
  const library = getLibrary() || initializeLibrary()
  const fromDefault = library.lists?.[listId]?.games
  if (Array.isArray(fromDefault)) return fromDefault.filter(Boolean)
  const fromCustom = library.customLists?.[listId]?.games
  if (Array.isArray(fromCustom)) return fromCustom.filter(Boolean)
  return []
}

// Add game to a list
export function addGameToList(listId, game) {
  const library = getLibrary() || initializeLibrary()

  // Check if game already exists in the list. String-compared: `game.id`
  // can arrive as a number (any caller passing a raw/canonical Game
  // object through) while stored rows are always String (toSlimLibraryGame
  // below) — a strict === here would silently allow a numeric-id duplicate.
  const existingGame = getGamesFromList(listId).find(g => String(g.id) === String(game.id))
  if (existingGame) {
    return false // Game already in list
  }

  // Slim at the write path itself, not at each call site — see
  // toSlimLibraryGame's doc comment. This is the fix for the fat-object /
  // numeric-id bloat: no caller of addGameToList, present or future, can
  // persist a raw IGDB/canonical Game object into a list anymore.
  const slimGame = toSlimLibraryGame(game)

  if (library.lists[listId]) {
    if (!library.lists[listId].games) {
      library.lists[listId].games = []
    }
    library.lists[listId].games.push(slimGame)
  } else if (library.customLists[listId]) {
    if (!library.customLists[listId].games) {
      library.customLists[listId].games = []
    }
    library.customLists[listId].games.push(slimGame)
  } else {
    return false // List doesn't exist
  }

  return saveLibrary(library)
}

/**
 * Add a game to the backlog from a passive discovery surface
 * (Discover → Recently activity cards, Because You Played rail). Mirrors
 * SwipeDeck's swipe-right contract:
 *   1. Optimistic local want-to-play list write (always).
 *   2. Best-effort cross-device sync — upserts a 'want' game_trackers row
 *      for the signed-in user. A Supabase failure never rolls back the
 *      local add; it's logged and swallowed.
 *
 * Shows its own success/duplicate toast so every call site gets the same
 * feedback without repeating the copy.
 *
 * @param {{ id: string|number, title: string, image?: string|null,
 *           year?: number|null, genre?: string|null, rating?: number|null }} game
 * @returns {Promise<boolean>}  true if newly added, false if already backlogged.
 */
export async function addGameToBacklog(game) {
  if (!game?.id) return false

  const added = addGameToList('want-to-play', {
    id: String(game.id),
    title: game.title,
    image: game.image || null,
    year: game.year ?? null,
    genre: game.genre ?? null,
    rating: game.rating ?? null,
  })

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user?.id) {
      const { error } = await supabase.from('game_trackers').upsert(
        {
          user_id: user.id,
          igdb_game_id: String(game.id),
          status: TRACKER_STATUS.want,
          game_title: game.title,
          game_image: game.image || null,
        },
        { onConflict: 'user_id,igdb_game_id' }
      )
      if (error) {
        console.error('[library] addGameToBacklog tracker sync failed:', error.message)
      }
    }
  } catch (err) {
    console.error('[library] addGameToBacklog crashed:', err)
  }

  // Pulse — this quick-add path (the "+ Add to Backlog" button on
  // other people's rating/review/status cards — see
  // HomeReviewCard.BacklogAction) bypassed setGameStatus entirely, so
  // unlike every other status transition it never emitted a
  // 'backlogged' activity_event — the feed broadening task's "logged/
  // added a game" event type went missing specifically for this entry
  // point. Mirrors setGameStatus's 'want' branch (same event type,
  // same metadata shape) so a card-triggered backlog add reads
  // identically to one made from the game/library screens. Only fires
  // when the game was actually newly added (`added`), never on the
  // already-in-backlog no-op.
  if (added) {
    logActivityEvent({
      type: ACTIVITY_EVENT_TYPES.BACKLOGGED,
      entityId: String(game.id),
      metadata: {
        from_status: null,
        game_title: game.title || null,
        game_image: game.image || null,
      },
    })
  }

  // A quota failure surfaces through the exact same `added === false` path
  // as "already in your backlog" — check getLastLibraryError() so a full
  // device says so honestly instead of implying the game was a duplicate.
  // saveLibrary() already fired its own toast for the quota case; skip
  // showing a second, contradictory one here.
  const quotaFailure = !added && getLastLibraryError()?.code === 'quota'
  if (!quotaFailure) {
    showToast(
      added ? `Added "${game.title}" to backlog` : `"${game.title}" is already in your backlog`,
      added ? 'success' : 'error',
      2500
    )
  }
  return added
}

// Remove game from a list
export function removeGameFromList(listId, gameId) {
  const library = getLibrary() || initializeLibrary()

  // String-compared — see isGameInList's comment above.
  if (library.lists[listId]) {
    library.lists[listId].games = (library.lists[listId].games || []).filter(
      g => String(g.id) !== String(gameId)
    )
  } else if (library.customLists[listId]) {
    library.customLists[listId].games = (library.customLists[listId].games || []).filter(
      g => String(g.id) !== String(gameId)
    )
  }

  saveLibrary(library)
}

// Create a custom list
export function createCustomList(listName, description = '', initialGames = []) {
  const library = getLibrary() || initializeLibrary()
  
  // Generate a unique ID
  const listId = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  if (!library.customLists) {
    library.customLists = {}
  }
  
  library.customLists[listId] = {
    name: listName,
    description: description,
    // Slim shape, same as addGameToList — see toSlimLibraryGame.
    games: initialGames.map(game => toSlimLibraryGame(game)),
    createdAt: new Date().toISOString(),
  }
  
  saveLibrary(library)
  return listId
}

// Delete a custom list
export function deleteCustomList(listId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.customLists[listId]) {
    delete library.customLists[listId]
    saveLibrary(library)
    return true
  }
  
  return false
}

// Restore a previously-deleted custom list (used for undo)
export function restoreCustomList(listId, snapshot) {
  const library = getLibrary() || initializeLibrary()
  if (!library.customLists) library.customLists = {}
  library.customLists[listId] = snapshot
  saveLibrary(library)
  return true
}

// Get raw snapshot of a custom list (use before deleting, for undo)
export function getCustomListSnapshot(listId) {
  const library = getLibrary() || initializeLibrary()
  return library.customLists?.[listId] ?? null
}

// Rename a custom list
export function renameCustomList(listId, newName) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.customLists[listId]) {
    library.customLists[listId].name = newName
    saveLibrary(library)
    return true
  }
  
  return false
}

// Get all lists (default + custom)
export function getAllLists() {
  const library = getLibrary() || initializeLibrary()

  const trackerLists = {}
  for (const [listId, list] of Object.entries(library.lists || {})) {
    const label = STATUS_META[LIST_STATUS_MAP[listId]]?.label
    trackerLists[listId] = label ? { ...list, name: label } : list
  }

  return {
    ...trackerLists,
    ...library.customLists,
  }
}

// Check if game is in a list
export function isGameInList(listId, gameId) {
  const games = getGamesFromList(listId)
  // String-compared for the same reason as addGameToList's duplicate check
  // above — stored rows are always String post-migration, but a caller can
  // still pass a numeric id (e.g. straight off a canonical Game object).
  return games.some(g => String(g.id) === String(gameId))
}

// Get list info
export function getListInfo(listId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.lists[listId]) {
    return {
      id: listId,
      name: STATUS_META[LIST_STATUS_MAP[listId]]?.label || library.lists[listId].name,
      isCustom: false,
    }
  }
  
  if (library.customLists[listId]) {
    return {
      id: listId,
      name: library.customLists[listId].name,
      description: library.customLists[listId].description || '',
      isCustom: true,
      createdAt: library.customLists[listId].createdAt,
    }
  }
  
  return null
}

// ─── Progress Tracking ──────────────────────────────────────────

function getAllProgress() {
  const stored = localStorage.getItem(PROGRESS_STORAGE_KEY)
  return stored ? JSON.parse(stored) : {}
}

function saveAllProgress(progress) {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
}

/**
 * Returns the status list a game belongs to ('want' | 'currently' | 'played' | null)
 */
export function getGameStatus(gameId) {
  const id = String(gameId)
  for (const [listId, status] of Object.entries(LIST_STATUS_MAP)) {
    const games = getGamesFromList(listId)
    if (games.some(g => String(g.id) === id)) return status
  }
  return null
}

/**
 * Moves a game between status lists. If the game isn't in any list yet,
 * `game` object must be passed so it can be added.
 *
 * First-time-Played celebration trigger
 *   When the transition lands on `played` AND the per-game
 *   `playedFirstAt` timestamp on gameProgress is null, set the timestamp
 *   and enqueue a celebration. The timestamp is only ever written once
 *   per-game (see updateGameProgress + getGameProgress) so toggling
 *   played → playing → played does NOT re-celebrate. This is the
 *   "first-time-ever-Played per game" semantics from the design spec.
 */
export function setGameStatus(gameId, newStatus, game = null) {
  try {
    const id = String(gameId)
    const targetList = STATUS_LIST_MAP[newStatus]
    if (!targetList) return false

    const currentStatus = getGameStatus(id)
    if (currentStatus === newStatus) return true

    const library = initializeLibrary()

    let gameObj = game
    for (const listId of Object.keys(LIST_STATUS_MAP)) {
      const list = library.lists[listId]
      if (!list || !Array.isArray(list.games)) continue
      const idx = list.games.findIndex(g => g && String(g.id) === id)
      if (idx !== -1) {
        gameObj = list.games[idx]
        list.games.splice(idx, 1)
      }
    }

    if (!gameObj) return false

    if (!library.lists[targetList] || typeof library.lists[targetList] !== 'object') {
      library.lists[targetList] = {
        name: DEFAULT_LISTS[targetList]?.name || targetList,
        games: [],
      }
    }
    if (!Array.isArray(library.lists[targetList].games)) {
      library.lists[targetList].games = []
    }
    library.lists[targetList].games.push({
      // String(): gameObj can be the raw/canonical game object passed in
      // by the caller (first-ever status set for this game — the loop
      // above never found it in an existing list to pull the already-
      // slim/already-String stored row from instead). Left un-stringified
      // this is exactly how Palworld/Portal 2-style numeric ids got into
      // gameLibrary — see toSlimLibraryGame's doc comment.
      id: String(gameObj.id),
      title: gameObj.title || '',
      image: gameObj.image || gameObj.coverUrl || null,
      addedAt: gameObj.addedAt || new Date().toISOString(),
    })

    // Track clearance for the "clear-it" progress meter.
    if (currentStatus === 'want') {
      try {
        recordBacklogClear(id)
      } catch (clearErr) {
        console.error('[library] recordBacklogClear failed:', clearErr)
      }
    }

    // saveLibrary() no longer throws on quota exhaustion (it prunes/retries
    // internally and fires its own distinct toast) — it returns false
    // instead, so this check is what makes a genuine storage failure still
    // come back to the status tile as `false`, exactly like before.
    if (!saveLibrary(library)) return false

    // Side effects must not flip a successful write into a false return —
    // GameDetail now toasts on false, which made a post-save throw look
    // like every tile was broken.
    try {
      syncStatusToServer(id, newStatus, gameObj)

    if (newStatus === 'currently') {
      updateGameProgress(id, { lastPlayedAt: new Date().toISOString() })
    }

    // First-time-Played celebration. Only fires when the row has never
    // had `playedFirstAt` set — by design, a previous Played → Playing →
    // Played re-toggle does NOT re-celebrate.
    let justCelebrated = false
    if (newStatus === 'played' && currentStatus !== 'played') {
      const existing = getGameProgress(id)
      if (!existing.playedFirstAt) {
        const completedAt = new Date().toISOString()
        updateGameProgress(id, { playedFirstAt: completedAt })
        justCelebrated = true
        // Pass a snapshot of the game object so the celebration can
        // render synchronously without hitting localStorage / IGDB again.
        queueCelebration({
          igdbGameId: id,
          completedAt,
          game: {
            id: gameObj.id,
            title: gameObj.title,
            image: gameObj.image,
            year: gameObj.year,
            developers: gameObj.developers,
            addedAt: gameObj.addedAt,
          },
          previousStatus: currentStatus || null,
        })
      }
    }

    window.dispatchEvent(new Event('libraryUpdated'))

    // Activity log — fire-and-forget AFTER the local save succeeds. The
    // service-side try/catch in logActivity prevents activity-log failures
    // from rolling back the status change.
    const activityLogPromise = logActivity({
      activityType: 'status_changed',
      igdbGameId: gameId,
      metadata: {
        from_status: currentStatus || null,
        to_status: newStatus,
        game_title: gameObj.title || null,
      },
    })

    // Sprint 16 badges — Finisher / Omnivore read status_changed rows
    // (to_status = 'played'), never game_trackers.status directly (see the
    // decoupling rule in the chat report). Chained off the same promise
    // countFinishedThisYear below waits on, for the same reason: recompute
    // must run AFTER the row above has actually committed, or it
    // undercounts this game by one.
    activityLogPromise.then(() => recomputeBadges()).catch(() => {})

    // "Your #Nth finished game of {year}" for the completion splash's stat
    // chips. This MUST run after the status_changed row above has actually
    // committed — countFinishedThisYear counts distinct 'played' rows in
    // `activities`, so querying it any earlier would undercount by one
    // (this game's own row wouldn't exist yet). The splash renders
    // immediately without this number and fills it in once it resolves —
    // see celebrationService.updateCelebrationStats.
    if (justCelebrated) {
      activityLogPromise
        .then(async (row) => {
          if (!row) return
          const year = new Date(row.created_at).getFullYear()
          const ordinal = await countFinishedThisYear(row.user_id, year)
          if (ordinal > 0) updateCelebrationStats(id, { ordinal, ordinalYear: year })
        })
        .catch((err) => {
          console.error('[library] finish-ordinal computation failed:', err)
        })
    }

    // Pulse — emit a uniform activity_events row so the follow-graph
    // feed picks the status change up. 'currently' → started, 'played'
    // → completed, 'dropped' → dropped, 'want' → backlogged (Home-only).
    const eventType = STATUS_TO_EVENT_TYPE[newStatus]
    if (eventType) {
      const baseMeta = {
        from_status: currentStatus || null,
        game_title: gameObj.title || null,
        game_image: gameObj.image || null,
      }
      // 'dropped' is the only type the feed renders with an "after Xh"
      // qualifier ("elvis dropped FIFA after 2h"). Look up the tracker's
      // hours_played at drop time so the sentence can read naturally
      // without the feed re-fetching the tracker on every render.
      // Best-effort: a missing/zero value just collapses the qualifier.
      if (eventType === ACTIVITY_EVENT_TYPES.DROPPED) {
        getTracker(gameId)
          .then((tracker) => {
            logActivityEvent({
              type: eventType,
              entityId: String(gameId),
              metadata: {
                ...baseMeta,
                hours_played: tracker?.hours_played ?? null,
              },
            })
          })
          .catch(() => {
            logActivityEvent({
              type: eventType,
              entityId: String(gameId),
              metadata: baseMeta,
            })
          })
      } else if (eventType === ACTIVITY_EVENT_TYPES.COMPLETED) {
        // BUG 3 fix: this is the second, previously-unguarded writer of
        // 'completed' rows — ReviewNew's "Mark as completed" already
        // goes through logCompletedEventOnce (see ReviewNew.jsx). Every
        // played -> playing -> played cycle used to call the plain
        // logActivityEvent above and insert a brand-new 'completed' row
        // each time, producing two genuinely separate completion cards
        // (or FeedGroupRow joining a title with itself). Same idempotent
        // guard, same (actor_user_id, entity_id) existence check — a
        // repeat transition now returns the ORIGINAL row untouched
        // instead of double-writing; a first-time completion still
        // inserts exactly the row logActivityEvent used to, with the
        // same type/entityId/metadata shape.
        logCompletedEventOnce({
          entityId: String(gameId),
          metadata: baseMeta,
        })
      } else {
        logActivityEvent({
          type: eventType,
          entityId: String(gameId),
          metadata: baseMeta,
        })
      }
    }
    } catch (sideErr) {
      console.error('[library] setGameStatus side effects failed:', sideErr)
    }

    return true
  } catch (err) {
    console.error('setGameStatus failed:', err)
    return false
  }
}

/**
 * Removes a game from whichever status list it belongs to.
 */
export function clearGameStatus(gameId) {
  try {
    const id = String(gameId)
    const library = getLibrary() || initializeLibrary()

    for (const listId of Object.keys(LIST_STATUS_MAP)) {
      const list = library.lists[listId]
      if (!list || !list.games) continue
      const idx = list.games.findIndex(g => String(g.id) === id)
      if (idx !== -1) {
        list.games.splice(idx, 1)
        break
      }
    }

    saveLibrary(library)
    // Drop the server row too, otherwise the next sync pulls the status
    // straight back onto this device.
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user?.id) return
        const { error } = await supabase
          .from('game_trackers')
          .delete()
          .eq('user_id', user.id)
          .eq('igdb_game_id', id)
        if (error) console.error('[library] clear status sync failed:', error.message)
      } catch (err) {
        console.error('[library] clear status sync crashed:', err)
      }
    })()
    window.dispatchEvent(new Event('libraryUpdated'))
    return true
  } catch (err) {
    console.error('clearGameStatus failed:', err)
    return false
  }
}

/**
 * Get progress data for a game.
 * Shape: { progressPercent, lastPlayedAt, hoursPlayed, playedFirstAt }
 *
 * `playedFirstAt` is the lifetime "first time this game was marked
 * Played" timestamp. Once set, it is never updated — see
 * updateGameProgress for the write-once guard.
 */
export function getGameProgress(gameId) {
  const all = getAllProgress()
  return (
    all[String(gameId)] || {
      progressPercent: null,
      lastPlayedAt: null,
      hoursPlayed: null,
      playedFirstAt: null,
    }
  )
}

/**
 * Merge-update progress fields for a game.
 *
 * `playedFirstAt` is write-once: if it's already non-null on the existing
 * row, subsequent writes are silently ignored. This is what makes the
 * first-time-Played celebration fire exactly once per (game, lifetime).
 */
export function updateGameProgress(gameId, data) {
  const all = getAllProgress()
  const id = String(gameId)
  const existing = all[id] || {}
  // Write-once guard for playedFirstAt. Spec: "if not null, no celebration."
  const nextPlayedFirstAt =
    existing.playedFirstAt
      ? existing.playedFirstAt
      : (data.playedFirstAt !== undefined ? data.playedFirstAt : null)
  all[id] = {
    progressPercent: data.progressPercent !== undefined ? data.progressPercent : (existing.progressPercent ?? null),
    lastPlayedAt: data.lastPlayedAt !== undefined ? data.lastPlayedAt : (existing.lastPlayedAt ?? null),
    hoursPlayed: data.hoursPlayed !== undefined ? data.hoursPlayed : (existing.hoursPlayed ?? null),
    playedFirstAt: nextPlayedFirstAt,
  }
  saveAllProgress(all)
  window.dispatchEvent(new Event('libraryUpdated'))
}

/**
 * Returns currently-playing games enriched with progress data, sorted by lastPlayedAt.
 */
export function getContinuePlayingGames(limit = 5) {
  const games = getGamesFromList('currently-playing')
  return games
    .map(g => {
      const progress = getGameProgress(g.id)
      return { ...g, ...progress }
    })
    .sort((a, b) => {
      const da = new Date(a.lastPlayedAt || a.addedAt || 0)
      const db = new Date(b.lastPlayedAt || b.addedAt || 0)
      return db - da
    })
    .slice(0, limit)
}

