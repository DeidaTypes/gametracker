import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getTasteVector } from '../../services/tasteEngineService'
import { fetchBroadDiscoveryBatch } from '../../services/igdb'
import { getAllLists, addGameToList } from '../../services/libraryService'
import { supabase } from '../../services/supabase'
import { showToast } from '../Toast'
import { SwipeCard } from './SwipeCard'
import {
  recordSwipe,
  getSwipeExcludeIds,
  SWIPE_ACTIONS,
} from '../../services/swipeService'
import './SwipeDeck.css'

// sessionStorage key used to preserve deck state when the user taps a card
// to view its detail page and then navigates back.
const DECK_SESSION_KEY = 'gt:swipe-deck-state:v1'

// How many un-swiped cards must remain before we background-fetch the next
// page of the broad discovery pool. Large enough that the fetch (a couple of
// batched /multiquery requests) has time to land before the user runs dry.
const REFILL_THRESHOLD = 8

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
    year: game.year ?? null,
    genre: genres.join(', ') || null,
    rating: game.totalRating != null ? game.totalRating / 20 : null,
    matchGenres,
  }
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * SwipeDeck — the "Swipe to discover" card stack on the Discover page.
 *
 * Source of truth: fetchBroadDiscoveryBatch (src/services/igdb.js) — the
 * FULL real IGDB catalog across EVERY major genre (Sports, Puzzle, Strategy,
 * Simulation, Racing, Fighting, RPG, Shooter, everything), gated only by a
 * quality bar (total_rating + total_rating_count). Deliberately NOT sourced
 * from the E0 taste engine's user_hidden_gems table — that pool only ever
 * contains candidates from the user's own top genres/themes, which
 * structurally starves out every genre the user hasn't already engaged
 * with. That's the right behavior for the page's "Hidden gems for you"
 * closer (intentionally narrow) but the wrong one here.
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
 * precomputed list, we background-fetch the next page (advancing a
 * per-genre offset cursor) once the user gets within REFILL_THRESHOLD cards
 * of the end of the current batch — the deck should never dead-end in a
 * normal session. Every swipe is persisted via swipeService.recordSwipe:
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

  const [pool, setPool]             = useState(null) // null = initial loading
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [refillFailCount, setRefillFailCount] = useState(0)

  const libraryIdsRef      = useRef(new Set())
  const cancelRef          = useRef(false)
  const tasteVectorRef     = useRef(null)
  const genreCursorsRef    = useRef({})
  const seenIdsRef         = useRef(new Set())
  const fetchingMoreRef    = useRef(false)
  const reloadTokenRef     = useRef(0)

  // ── Persist / restore deck state across a card-tap → GameDetail → back ────

  const persistSessionState = useCallback((poolArg, idxArg) => {
    try {
      sessionStorage.setItem(
        DECK_SESSION_KEY,
        JSON.stringify({
          pool: poolArg,
          currentIdx: idxArg,
          cursors: genreCursorsRef.current,
          seenIds: Array.from(seenIdsRef.current),
        })
      )
    } catch { /* storage full — non-fatal */ }
  }, [])

  // ── Background refill ─────────────────────────────────────────────────────

  const loadMore = useCallback(async () => {
    if (fetchingMoreRef.current || cancelRef.current) return
    fetchingMoreRef.current = true
    try {
      const excludeIds = new Set([
        ...libraryIdsRef.current,
        ...getSwipeExcludeIds(),
        ...seenIdsRef.current,
      ])
      const { cards, cursors } = await fetchBroadDiscoveryBatch({
        excludeIds,
        cursors: genreCursorsRef.current,
        genreWeights: tasteVectorRef.current?.genreWeights || null,
      })
      genreCursorsRef.current = cursors
      if (cancelRef.current) return

      if (cards.length === 0) {
        setRefillFailCount((n) => n + 1)
        return
      }

      const topGenres = topGenreNames(tasteVectorRef.current)
      const newCards = cards.map((g) => gameToCard(g, topGenres))
      for (const c of newCards) seenIdsRef.current.add(String(c.id))

      setPool((prev) => (Array.isArray(prev) ? [...prev, ...newCards] : newCards))
      setRefillFailCount(0)
    } catch {
      if (!cancelRef.current) setRefillFailCount((n) => n + 1)
    } finally {
      fetchingMoreRef.current = false
    }
  }, [])

  // ── Initial load ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const myToken = ++reloadTokenRef.current
    setLoadFailed(false)
    libraryIdsRef.current = buildLocalLibraryIds()

    if (user?.id) {
      try {
        const { data } = await supabase
          .from('game_trackers')
          .select('igdb_game_id')
          .eq('user_id', user.id)
        for (const row of data ?? []) {
          if (row.igdb_game_id) {
            libraryIdsRef.current.add(String(row.igdb_game_id))
          }
        }
      } catch { /* non-fatal */ }
    }

    // Restore deck state when returning from a card-tap to GameDetail.
    try {
      const raw = sessionStorage.getItem(DECK_SESSION_KEY)
      if (raw) {
        sessionStorage.removeItem(DECK_SESSION_KEY)
        const saved = JSON.parse(raw)
        if (Array.isArray(saved.pool) && saved.pool.length > 0 && !cancelRef.current) {
          genreCursorsRef.current = saved.cursors && typeof saved.cursors === 'object' ? saved.cursors : {}
          seenIdsRef.current = new Set(Array.isArray(saved.seenIds) ? saved.seenIds : [])
          setPool(saved.pool)
          setCurrentIdx(typeof saved.currentIdx === 'number' ? saved.currentIdx : 0)
          // Taste vector still needed for future refills' order bias.
          try { tasteVectorRef.current = await getTasteVector(user?.id) } catch { tasteVectorRef.current = null }
          return
        }
      }
    } catch { /* non-fatal — fall through to fresh fetch */ }

    let vector = null
    try { vector = await getTasteVector(user?.id) } catch { vector = null }
    if (cancelRef.current || myToken !== reloadTokenRef.current) return
    tasteVectorRef.current = vector

    const excludeIds = new Set([
      ...libraryIdsRef.current,
      ...getSwipeExcludeIds(),
    ])

    genreCursorsRef.current = {}
    seenIdsRef.current = new Set()

    const { cards, cursors } = await fetchBroadDiscoveryBatch({
      excludeIds,
      cursors: {},
      genreWeights: vector?.genreWeights || null,
    })
    if (cancelRef.current || myToken !== reloadTokenRef.current) return

    genreCursorsRef.current = cursors
    const topGenres = topGenreNames(vector)
    const cardList = cards.map((g) => gameToCard(g, topGenres))
    for (const c of cardList) seenIdsRef.current.add(String(c.id))

    setPool(cardList)
  }, [user?.id])

  useEffect(() => {
    cancelRef.current = false

    load().catch(() => {
      if (!cancelRef.current) {
        setPool([])
        setLoadFailed(true)
      }
    })

    return () => { cancelRef.current = true }
  }, [load])

  // Background-fetch the next page once the user is close to the end of the
  // current batch, so the deck never dead-ends in a normal session.
  useEffect(() => {
    if (pool === null || pool.length === 0) return
    if (refillFailCount >= MAX_REFILL_RETRIES) return
    if (pool.length - currentIdx <= REFILL_THRESHOLD) {
      loadMore()
    }
  }, [pool, currentIdx, loadMore, refillFailCount])

  const handleRetryRefill = useCallback(() => {
    setRefillFailCount(0)
  }, [])

  const handleRetryLoad = useCallback(() => {
    load().catch(() => {
      if (!cancelRef.current) {
        setPool([])
        setLoadFailed(true)
      }
    })
  }, [load])

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    setCurrentIdx((i) => i + 1)
  }, [])

  const handleSwipeRight = useCallback(
    (game) => {
      // Positive signal (local) + cross-device backlog write.
      recordSwipe(game, SWIPE_ACTIONS.BACKLOG)

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
              status:       'want',
              game_title:   game.title,
              game_image:   game.image || game.coverUrl || null,
            },
            { onConflict: 'user_id,igdb_game_id' }
          )
          .then()
          .catch((err) => console.error('[SwipeDeck] game_trackers upsert failed:', err))
      }

      showToast(`Added "${game.title}" to Backlog`, 'success', 2500)
      advance()
    },
    [user, advance]
  )

  const handleSwipeLeft = useCallback(
    (game) => {
      // Negative signal — recorded locally so the taste signal down-weights it.
      if (game) recordSwipe(game, SWIPE_ACTIONS.SKIP)
      advance()
    },
    [advance]
  )

  // Tap the card body → open game detail (preserve deck to restore on back).
  const handleTap = useCallback(
    (game) => {
      persistSessionState(pool, currentIdx)
      navigate(`/game/${game.id}`)
    },
    [navigate, pool, currentIdx, persistSessionState]
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  // Initial loading skeleton
  if (pool === null) {
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
          <div className="swipe-deck__empty-icon" aria-hidden="true">✦</div>
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
            <div className="swipe-deck__empty-icon" aria-hidden="true">✦</div>
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
