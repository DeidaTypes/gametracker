import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getTasteVector } from '../../services/tasteEngineService'
import { fetchBroadDiscoveryBatch } from '../../services/igdb'
import { getAllLists, addGameToList, TRACKER_STATUS } from '../../services/libraryService'
import { supabase } from '../../services/supabase'
import { mutateSWR, peekSWR, peekSWRInFlight } from '../../services/swrCache'
import { useCachedResource } from '../../hooks/useCachedResource'
import { showToast } from '../Toast'
import { STATUS_META } from '../StatusChip'
import { Sparkles } from 'lucide-react'
import { SwipeCard } from './SwipeCard'
import {
  recordSwipe,
  getSwipeExcludeIds,
  incrementSessionAddCount,
  SWIPE_ACTIONS,
} from '../../services/swipeService'
import { getFollowedTrackersForGames } from '../../services/communityService'
import { getTimeToBeat } from '../../services/timeToBeatService'
import { hapticImpact } from '../../utils/haptics'
import { getGameNavStub } from '../../utils/gameNavStub'
import { prefetchNextSwipeCovers } from '../../utils/swipeCoverPrefetch'
import { imageIdFromCoverUrl } from '../../services/igdbImage'
import './SwipeDeck.css'

// sessionStorage key used to preserve deck state when the user taps a card
// to view its detail page and then navigates back. Folded into the
// discover:deck:{uid} swrCache entry on the way back (or adopted from here
// if the WebView was killed on the detail page and the memory cache is gone).
const DECK_SESSION_KEY = 'gt:swipe-deck-state:v1'

// In-memory session deck. Survives Discover unmount (Home → Discover, and
// card tap → Game Detail → back) so the same next card paints on the first
// frame. Never localStorage.
const DECK_CACHE_TTL_MS = 12 * 60 * 60 * 1000

function deckCacheKey(userId) {
  return userId ? `discover:deck:${userId}` : null
}

// How many un-swiped cards must remain before we background-fetch the next
// page. One refill at a time, and never while the cold load is in flight.
const REFILL_THRESHOLD = 8

// One refill per deck key, including across an unmount mid-request, so a
// remount cannot start a second batch beside the one already running.
const deckRefillInFlight = new Map()

// After this many consecutive failed/empty refill attempts, stop auto-retrying
// and show an honest "couldn't load more" state with a manual retry button —
// the catalog-backed pool should never legitimately run dry, so repeated
// failures mean a real connectivity problem, not "no more games".
const MAX_REFILL_RETRIES = 3

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build the set of every game ID already tracked in localStorage. */
function buildLocalLibraryIds() {
  const ids = new Set()
  try {
    const allLists = getAllLists()
    for (const list of Object.values(allLists)) {
      for (const g of list.games ?? []) {
        if (g.id != null) ids.add(String(g.id))
      }
    }
  } catch { /* ignore */ }
  return ids
}

/**
 * Top N genre names from a taste vector, highest weight first. Used only to
 * decide which of a candidate's genres are worth citing as the on-card
 * reason — never to decide which candidates are eligible in the first place.
 */
function topGenreNames(vector, n = 6) {
  if (!vector?.genreWeights) return []
  return Object.entries(vector.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name)
}

/**
 * Map a broad-discovery-pool game → the card shape SwipeCard consumes.
 *
 * `matchGenres` is the overlap between this candidate's own genres and the
 * user's top taste-vector genres (broad, whole-library signal) — purely
 * cosmetic copy, NOT a filter. A card with zero overlap is exactly as
 * eligible as one with full overlap; it just renders without a reason line
 * (SwipeCard already handles that honestly — no fabricated reason).
 */
function gameToCard(game, topGenres) {
  const genres = Array.isArray(game.genres) ? game.genres : []
  const matchGenres = topGenres.length
    ? genres.filter((g) => topGenres.includes(g)).slice(0, 2)
    : []
  return {
    id: game.id,
    title: game.title,
    image: game.image,
    coverImageId: game.coverImageId ?? imageIdFromCoverUrl(game.image) ?? null,
    year: game.year ?? null,
    genres,
    genre: genres.join(', ') || null,
    rating: game.totalRating != null ? game.totalRating / 20 : null,
    matchGenres,
  }
}

function readTapSnapshot() {
  let raw
  try {
    raw = sessionStorage.getItem(DECK_SESSION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try { sessionStorage.removeItem(DECK_SESSION_KEY) } catch { /* ignore */ }
  try {
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved.pool) || saved.pool.length === 0) return null
    return {
      pool: saved.pool,
      currentIdx: typeof saved.currentIdx === 'number' ? saved.currentIdx : 0,
      cursors: saved.cursors && typeof saved.cursors === 'object' ? saved.cursors : {},
      seenIds: Array.isArray(saved.seenIds) ? saved.seenIds.map(String) : [],
      genreWeights: saved.genreWeights && typeof saved.genreWeights === 'object'
        ? saved.genreWeights
        : null,
    }
  } catch {
    return null
  }
}

/** Memory cache wins. A tap snapshot is adopted only when the cache is cold. */
function adoptTapSnapshot(key) {
  if (!key) return
  if (peekSWR(key) !== undefined) {
    try { sessionStorage.removeItem(DECK_SESSION_KEY) } catch { /* ignore */ }
    return
  }
  const snap = readTapSnapshot()
  if (snap) mutateSWR(key, snap)
}

async function fetchTrackedGameIds(userId) {
  const { data, error } = await supabase
    .from('game_trackers')
    .select('igdb_game_id')
    .eq('user_id', userId)
  if (error) throw error
  const ids = []
  for (const row of data ?? []) {
    if (row.igdb_game_id) ids.push(String(row.igdb_game_id))
  }
  return ids
}

async function buildColdDeck(userId) {
  const libraryIds = buildLocalLibraryIds()
  const started = performance.now()

  const [trackedIds, vector] = await Promise.all([
    fetchTrackedGameIds(userId).catch(() => []),
    getTasteVector(userId).catch(() => null),
  ])
  for (const id of trackedIds) libraryIds.add(String(id))

  const excludeIds = new Set([
    ...libraryIds,
    ...getSwipeExcludeIds(),
  ])

  let cards
  let cursors
  let igdbRequests = 0
  try {
    const batch = await fetchBroadDiscoveryBatch({
      excludeIds,
      cursors: {},
      genreWeights: vector?.genreWeights || null,
    })
    cards = batch.cards
    cursors = batch.cursors
    igdbRequests = batch.igdbRequests
  } catch (err) {
    igdbRequests = err?.igdbRequests || igdbRequests
    if (import.meta.env.DEV) {
      const ms = Math.round(performance.now() - started)
      console.info(`[discover] cold deck IGDB requests: ${igdbRequests} (${ms}ms)`)
    }
    throw err
  }

  if (import.meta.env.DEV) {
    const ms = Math.round(performance.now() - started)
    console.info(`[discover] cold deck IGDB requests: ${igdbRequests} (${ms}ms, ${cards.length} cards)`)
  }

  const topGenres = topGenreNames(vector)
  const pool = cards.map((g) => gameToCard(g, topGenres))
  return {
    pool,
    currentIdx: 0,
    seenIds: pool.map((c) => String(c.id)),
    cursors,
    genreWeights: vector?.genreWeights || null,
  }
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * SwipeDeck — the "Swipe to discover" card stack on the Discover page.
 *
 * Source of truth: fetchBroadDiscoveryBatch (src/services/igdb.js) — the
 * FULL real IGDB catalog across EVERY major genre (Sports, Puzzle, Strategy,
 * Simulation, Racing, Fighting, RPG, Shooter, everything), gated only by a
 * quality bar (total_rating + total_rating_count). Deliberately NOT scoped
 * to the user's own top genres/themes — that would structurally starve out
 * every genre the user hasn't already engaged with, which is the wrong
 * behavior here: coverage across every genre comes first.
 *
 * The user's taste vector (getTasteVector) is read ONLY to lightly bias
 * on-card copy (matchGenres) and result ORDER (see applyTasteOrderBias in
 * igdb.js) — it can move a liked-genre card a little earlier in the batch,
 * but it can never exclude a genre or narrow the pool. Coverage across every
 * genre comes first; personalization is secondary polish on top.
 *
 * Already-tracked games and previously-swiped games are excluded client-side
 * and also passed to fetchBroadDiscoveryBatch so they're never re-fetched.
 *
 * Infinite supply: because the pool is the whole catalog rather than a small
 * precomputed list, we background-fetch the next page (one multiquery,
 * cursors advanced per group) once the user gets within REFILL_THRESHOLD
 * cards of the end of the current batch — the deck should never dead-end
 * in a normal session. Every swipe is persisted via swipeService.recordSwipe:
 *   • ✕ Skip     → negative signal (recorded locally).
 *   • ♥ Backlog  → positive signal (recorded locally) AND written to the
 *                  cross-device library + game_trackers.
 *
 * We only ever show a "that's all for now" state if a page fetch genuinely
 * failed (e.g. IGDB/network unreachable) — never as a "ran out" state, since
 * the catalog-backed pool is effectively inexhaustible.
 */
export function SwipeDeck() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const deckKey = deckCacheKey(user?.id)
  const adoptedKeyRef = useRef(null)
  if (deckKey && adoptedKeyRef.current !== deckKey) {
    adoptedKeyRef.current = deckKey
    adoptTapSnapshot(deckKey)
  }

  const loadDeck = useCallback(async () => {
    const existing = peekSWR(deckKey)
    if (existing?.pool?.length) return existing
    return buildColdDeck(user.id)
  }, [deckKey, user?.id])

  const {
    data: deck,
    error: deckError,
    refresh: refreshDeck,
    mutate: mutateDeck,
  } = useCachedResource(deckKey, loadDeck, {
    enabled: !!deckKey,
    revalidateAfterMs: DECK_CACHE_TTL_MS,
  })

  // null pool = cold load still in flight. A cached deck is set before paint.
  const pool = deck ? deck.pool : null
  const currentIdx = deck?.currentIdx ?? 0
  const loadFailed = !!deckError && pool === null

  const [refillFailCount, setRefillFailCount] = useState(0)
  const [circleByGameId, setCircleByGameId] = useState({})
  const [mainHoursByGameId, setMainHoursByGameId] = useState({})

  const cancelRef          = useRef(false)
  const ttbFetchedRef      = useRef(new Set())
  const enrichedIdsRef     = useRef(new Set())
  const socialFetchTokenRef = useRef(0)
  const coverPrefetchRef    = useRef(new Map())

  // ── Per-deck-page social + TTB (one trackers query per batch, no per-swipe) ─

  const enrichDeckPage = useCallback(async (cards) => {
    if (!cards?.length || cancelRef.current) return
    const ids = cards.map((c) => c.id)
    const myToken = ++socialFetchTokenRef.current

    const ttbIds = ids.filter((id) => !ttbFetchedRef.current.has(String(id)))
    for (const id of ttbIds) ttbFetchedRef.current.add(String(id))

    const [circleMap, ...ttbResults] = await Promise.all([
      getFollowedTrackersForGames(ids),
      ...ttbIds.map((id) =>
        getTimeToBeat(id).then((data) => [String(id), data])
      ),
    ])

    if (cancelRef.current || myToken !== socialFetchTokenRef.current) return

    setCircleByGameId((prev) => ({ ...prev, ...circleMap }))

    if (ttbResults.length > 0) {
      const hoursPatch = {}
      for (const [id, data] of ttbResults) {
        const secs = data?.normallySeconds
        if (typeof secs === 'number' && secs > 0) {
          hoursPatch[id] = Math.round(secs / 3600)
        }
      }
      if (Object.keys(hoursPatch).length > 0) {
        setMainHoursByGameId((prev) => ({ ...prev, ...hoursPatch }))
      }
    }
  }, [])

  // ── Persist deck across a card-tap → GameDetail → back ───────────────────
  // The live queue already sits in swrCache. This snapshot is only for a
  // WebView kill while Game Detail is open; adoptTapSnapshot folds it back.

  const persistSessionState = useCallback(() => {
    const saved = peekSWR(deckKey)
    if (!saved?.pool?.length) return
    try {
      sessionStorage.setItem(
        DECK_SESSION_KEY,
        JSON.stringify({
          pool: saved.pool,
          currentIdx: saved.currentIdx,
          cursors: saved.cursors,
          seenIds: saved.seenIds,
          genreWeights: saved.genreWeights || null,
        })
      )
    } catch { /* storage full — non-fatal */ }
  }, [deckKey])

  // ── Background refill — one at a time, never during the cold load ────────

  const loadMore = useCallback(async () => {
    if (!deckKey) return
    if (deckRefillInFlight.has(deckKey)) return
    if (peekSWRInFlight(deckKey)) return

    const run = (async () => {
      const current = peekSWR(deckKey)
      if (!current?.pool?.length) return

      const libraryIds = buildLocalLibraryIds()
      try {
        const tracked = await fetchTrackedGameIds(user.id)
        for (const id of tracked) libraryIds.add(id)
      } catch { /* non-fatal */ }

      if (peekSWRInFlight(deckKey)) return

      const latest = peekSWR(deckKey) || current
      const excludeIds = new Set([
        ...libraryIds,
        ...getSwipeExcludeIds(),
        ...(latest.seenIds || []),
      ])
      const { cards, cursors, igdbRequests } = await fetchBroadDiscoveryBatch({
        excludeIds,
        cursors: latest.cursors || {},
        genreWeights: latest.genreWeights || null,
      })
      if (import.meta.env.DEV) {
        console.info(`[discover] refill IGDB requests: ${igdbRequests}`)
      }

      if (peekSWRInFlight(deckKey)) return

      const topGenres = topGenreNames({ genreWeights: latest.genreWeights })
      const newCards = cards.map((g) => gameToCard(g, topGenres))

      let appended = 0
      mutateDeck((prev) => {
        if (!prev?.pool) return prev
        const seen = new Set(prev.seenIds || [])
        const extra = []
        for (const card of newCards) {
          const id = String(card.id)
          if (seen.has(id)) continue
          seen.add(id)
          extra.push(card)
        }
        appended = extra.length
        return {
          ...prev,
          pool: extra.length ? [...prev.pool, ...extra] : prev.pool,
          seenIds: Array.from(seen),
          cursors,
        }
      })

      if (appended === 0) setRefillFailCount((n) => n + 1)
      else setRefillFailCount(0)
    })()

    deckRefillInFlight.set(deckKey, run)
    try {
      await run
    } catch {
      setRefillFailCount((n) => n + 1)
    } finally {
      if (deckRefillInFlight.get(deckKey) === run) deckRefillInFlight.delete(deckKey)
    }
  }, [deckKey, user?.id, mutateDeck])

  useEffect(() => {
    cancelRef.current = false
    return () => { cancelRef.current = true }
  }, [])

  useEffect(() => {
    setCircleByGameId({})
    setMainHoursByGameId({})
    enrichedIdsRef.current = new Set()
    ttbFetchedRef.current = new Set()
  }, [deckKey])

  // Social + time-to-beat for cards that just arrived. Swipes don't re-run this.
  useEffect(() => {
    if (!pool?.length) return
    const fresh = pool.filter((card) => !enrichedIdsRef.current.has(String(card.id)))
    if (fresh.length === 0) return
    for (const card of fresh) enrichedIdsRef.current.add(String(card.id))
    enrichDeckPage(fresh)
  }, [pool, enrichDeckPage])

  // Next page only once the cold deck is on screen and the user is near the end.
  useEffect(() => {
    if (!deckKey || pool === null || pool.length === 0) return
    if (peekSWRInFlight(deckKey)) return
    if (deckRefillInFlight.has(deckKey)) return
    if (refillFailCount >= MAX_REFILL_RETRIES) return
    if (pool.length - currentIdx <= REFILL_THRESHOLD) {
      loadMore()
    }
  }, [deckKey, pool, currentIdx, loadMore, refillFailCount])

  // Warm the next two covers at the size the card displays.
  useEffect(() => {
    if (pool === null || pool.length === 0) return
    if (currentIdx >= pool.length) return
    prefetchNextSwipeCovers(coverPrefetchRef, pool, currentIdx)
  }, [pool, currentIdx])

  const handleRetryRefill = useCallback(() => {
    setRefillFailCount(0)
  }, [])

  const handleRetryLoad = useCallback(() => {
    refreshDeck().catch(() => {})
  }, [refreshDeck])

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    mutateDeck((prev) => {
      if (!prev) return prev
      return { ...prev, currentIdx: (prev.currentIdx || 0) + 1 }
    })
  }, [mutateDeck])

  const handleSwipeRight = useCallback(
    (game) => {
      // Positive signal (local) + cross-device backlog write.
      recordSwipe(game, SWIPE_ACTIONS.BACKLOG)
      // Real backlog add — counts toward the "N added tonight" payoff
      // indicator next to the section header (never counts skips).
      incrementSessionAddCount()

      addGameToList('want-to-play', {
        id:        String(game.id),
        title:     game.title,
        image:     game.image || game.coverUrl || null,
        year:      game.year ?? null,
        genre:     game.genre ?? null,
        rating:    game.rating ?? null,
      })

      if (user?.id) {
        supabase
          .from('game_trackers')
          .upsert(
            {
              user_id:      user.id,
              igdb_game_id: String(game.id),
              status:       TRACKER_STATUS.want,
              game_title:   game.title,
              game_image:   game.image || game.coverUrl || null,
            },
            { onConflict: 'user_id,igdb_game_id' }
          )
          .then()
          .catch((err) => console.error('[SwipeDeck] game_trackers upsert failed:', err))
      }

      showToast(`Added to ${STATUS_META.want.label}`, 'success', 2500, null, null, {
        image: game.image || game.coverUrl || null,
        sub: game.title,
        tone: 'saved',
      })
      advance()
    },
    [user, advance]
  )

  const handleSwipeLeft = useCallback(
    (game) => {
      hapticImpact('Light')
      // Negative signal — recorded locally so the taste signal down-weights it.
      if (game) recordSwipe(game, SWIPE_ACTIONS.SKIP)
      advance()
    },
    [advance]
  )

  // Tap the card body → open game detail (preserve deck to restore on back).
  const handleTap = useCallback(
    (game) => {
      persistSessionState()
      navigate(`/game/${game.id}`, { state: getGameNavStub(game) })
    },
    [navigate, persistSessionState]
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  // Initial loading skeleton — same scene box as the live deck, so the
  // card does not jump when it arrives. A cached revisit skips this.
  if (pool === null && !loadFailed) {
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__scene" aria-busy="true" aria-label="Loading games">
          <div className="swipe-deck__skel swipe-deck__skel--2" />
          <div className="swipe-deck__skel swipe-deck__skel--1" />
          <div className="swipe-deck__skel swipe-deck__skel--0" />
        </div>
      </div>
    )
  }

  // The broad catalog pool should always return *something* — an empty pool
  // here means the initial fetch genuinely failed (network/IGDB down), not
  // "nothing left to show". Honest error state with a manual retry.
  if (pool.length === 0) {
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__empty" role="status">
          <div className="swipe-deck__empty-icon" aria-hidden="true">
            <Sparkles size={24} strokeWidth={2} />
          </div>
          <p className="swipe-deck__empty-title">
            {loadFailed ? "Couldn't load games right now" : 'Loading is taking a while'}
          </p>
          <p className="swipe-deck__empty-body">
            Check your connection and try again.
          </p>
          <button type="button" className="swipe-deck__retry-btn" onClick={handleRetryLoad}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  // Caught up with the currently-loaded page — a background refill is either
  // already in flight (useEffect above) or about to fire. This is a brief
  // loading beat, not a real "end of deck" state, since the pool is backed
  // by the full catalog. Only surface a manual-retry state after several
  // consecutive refill failures (a real connectivity problem).
  if (currentIdx >= pool.length) {
    if (refillFailCount >= MAX_REFILL_RETRIES) {
      return (
        <div className="swipe-deck">
          <div className="swipe-deck__empty" role="status">
            <div className="swipe-deck__empty-icon" aria-hidden="true">
              <Sparkles size={24} strokeWidth={2} />
            </div>
            <p className="swipe-deck__empty-title">Couldn't load more games</p>
            <p className="swipe-deck__empty-body">
              Check your connection and try again.
            </p>
            <button type="button" className="swipe-deck__retry-btn" onClick={handleRetryRefill}>
              Try again
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__scene" aria-busy="true" aria-label="Loading more games">
          <div className="swipe-deck__skel swipe-deck__skel--2" />
          <div className="swipe-deck__skel swipe-deck__skel--1" />
          <div className="swipe-deck__skel swipe-deck__skel--0" />
        </div>
      </div>
    )
  }

  // Active deck — render top 3 cards (back-to-front so the top card is on top).
  const topGame  = pool[currentIdx]
  const midGame  = pool[currentIdx + 1]
  const backGame = pool[currentIdx + 2]

  return (
    <div className="swipe-deck" role="region" aria-label="Swipe to discover games">
      <div className="swipe-deck__scene">
        {backGame && (
          <SwipeCard
            key={backGame.id}
            game={backGame}
            circleSignal={circleByGameId[String(backGame.id)]}
            mainHours={mainHoursByGameId[String(backGame.id)]}
            stackIndex={2}
            isTop={false}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
          />
        )}
        {midGame && (
          <SwipeCard
            key={midGame.id}
            game={midGame}
            circleSignal={circleByGameId[String(midGame.id)]}
            mainHours={mainHoursByGameId[String(midGame.id)]}
            stackIndex={1}
            isTop={false}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
          />
        )}
        {topGame && (
          <SwipeCard
            key={topGame.id}
            game={topGame}
            circleSignal={circleByGameId[String(topGame.id)]}
            mainHours={mainHoursByGameId[String(topGame.id)]}
            stackIndex={0}
            isTop={true}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
            onTap={handleTap}
          />
        )}
      </div>
    </div>
  )
}
