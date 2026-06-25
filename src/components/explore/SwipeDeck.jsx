import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getDiscoveryDeck, getMoodDeck } from '../../services/igdb'
import { getAllLists, addGameToList, getGamesFromList } from '../../services/libraryService'
import { supabase } from '../../services/supabase'
import { showToast } from '../Toast'
import { SwipeCard } from './SwipeCard'
import SessionEndPick from './SessionEndPick'
import {
  recordSwipe,
  getTasteSignal,
  getSwipeExcludeIds,
  pickTonightsMatch,
  SWIPE_ACTIONS,
} from '../../services/swipeService'
import './SwipeDeck.css'

// sessionStorage key used to preserve deck state when the user taps a card
// to view its detail page and then navigates back.
const DECK_SESSION_KEY = 'gt:swipe-deck-state:v1'

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
 * Return up to `n` numeric IGDB game IDs from the user's "played" list,
 * sorted by rating (highest first). Used as the taste-seed input.
 */
function getTopRatedPlayedIds(n = 3) {
  try {
    const played = getGamesFromList('played')
    return played
      .filter((g) => g.id && g.rating != null)
      .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
      .slice(0, n)
      .map((g) => Number(g.id))
      .filter(Boolean)
  } catch {
    return []
  }
}

// How many cards from the end of the pool to trigger a background refill.
const REFILL_THRESHOLD = 5

// After this many swipes in a session AND at least one backlog, the "I'm
// done — pick for me" action becomes available without waiting for the
// deck to exhaust. The number is intentionally low so the feature surfaces
// within a normal session; users with short attention spans get a payoff.
const PICK_AVAILABLE_AFTER_SWIPES = 6

// ── Component ──────────────────────────────────────────────────────────────

/**
 * SwipeDeck — "Swipe to discover" learning card stack on the Discover page.
 *
 * Props:
 *   moodId      — optional mood chip ID (e.g. 'spooky', 'coop'). When set,
 *                 the deck is seeded via getMoodDeck() instead of the default
 *                 multi-axis getDiscoveryDeck(). The parent uses React key to
 *                 remount when mood changes, so moodId is stable per mount.
 *   onMoodEmpty — called with moodId when a mood deck returns zero results so
 *                 the parent can hide the chip and reset to the default deck.
 *
 * Sprint 7A — "swipe that learns":
 *   • Every swipe (skip / backlog / not-interested) is persisted via
 *     swipeService.recordSwipe so the next batch can bias on it.
 *   • Each card carries a `whyLine` derived from the taste signal
 *     (library + swipe history). Annotated client-side in getDiscoveryDeck.
 *   • The deck calls getDiscoveryDeck with the taste signal so subsequent
 *     refills pin one axis to a top-liked genre.
 *   • When the deck exhausts (or the user explicitly hits "I'm done"
 *     after ≥ 6 swipes and ≥ 1 backlog), SessionEndPick is rendered with
 *     a concrete recommendation deep-linked to /game/:id.
 *
 * Pool source
 *   getDiscoveryDeck() fires a single IGDB multiquery (3 axis sub-queries)
 *   with randomised genre/era/offset axes; quality-gated on rating +
 *   cover. Falls back to parallel `games` queries when the proxy lacks
 *   multiquery support.
 *
 * Exclusion
 *   localStorage library ∪ Supabase game_trackers ∪ session seenIdsRef ∪
 *   swipeService persistent exclusion list (not-interested 1y / skip 30d /
 *   already backlogged). seenIdsRef + the persistent set together
 *   guarantee no resurfacing within a session or for a meaningful TTL
 *   across sessions.
 *
 * Right swipe / ♥ Backlog
 *   recordSwipe('backlog') + optimistic addGameToList('want-to-play') +
 *   async Supabase game_trackers upsert.
 *
 * Left swipe / ✕ Skip
 *   recordSwipe('skip') — persistent for 30 days. Feeds the taste signal
 *   as a light negative (genre weight 1).
 *
 * "Not for me" button (tertiary action)
 *   recordSwipe('not_interested') — persistent for 1 year. Heavy negative
 *   (genre weight 4) — soft-filters the same genre from future batches.
 */
export function SwipeDeck({ moodId = null, onMoodEmpty } = {}) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [pool, setPool]             = useState(null)  // null = initial loading
  const [currentIdx, setCurrentIdx] = useState(0)
  const [refilling, setRefilling]   = useState(false)
  const [exhausted, setExhausted]   = useState(false)

  // Counters drive the end-of-session pick gating.
  const [swipeCount, setSwipeCount]     = useState(0)
  const [backlogCount, setBacklogCount] = useState(0)
  const [showEndPick, setShowEndPick]   = useState(false)

  // Refs persist across renders / refills without triggering re-renders.
  const seenIdsRef     = useRef(new Set()) // all IDs shown this session
  const libraryIdsRef  = useRef(new Set()) // all IDs in user's library
  const cancelRef      = useRef(false)
  const sessionPoolRef = useRef([])         // every game *seen* this session
  const sessionBacklogRef = useRef(new Set()) // ids backlogged this session

  // Taste signal is recomputed on swipe events; consumers (refill + whyLine
  // annotator on the next batch) read the latest value via the ref.
  const tasteRef = useRef(getTasteSignal())
  useEffect(() => {
    const refresh = () => { tasteRef.current = getTasteSignal() }
    window.addEventListener('gt:swipe-recorded', refresh)
    window.addEventListener('libraryUpdated', refresh)
    return () => {
      window.removeEventListener('gt:swipe-recorded', refresh)
      window.removeEventListener('libraryUpdated', refresh)
    }
  }, [])

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    cancelRef.current = false

    async function load() {
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
            for (const g of saved.pool) seenIdsRef.current.add(String(g.id))
            sessionPoolRef.current = saved.pool.slice()
            setPool(saved.pool)
            setCurrentIdx(typeof saved.currentIdx === 'number' ? saved.currentIdx : 0)
            return
          }
        }
      } catch { /* non-fatal — fall through to fresh fetch */ }

      const tasteGameIds = getTopRatedPlayedIds(3)
      const tasteSignal = tasteRef.current
      const excludeIds = new Set([
        ...libraryIdsRef.current,
        ...seenIdsRef.current,
        ...getSwipeExcludeIds(),
      ])

      let games = []
      try {
        if (moodId) {
          games = await getMoodDeck(moodId, { excludeIds, limit: 30 })
        } else {
          games = await getDiscoveryDeck({
            excludeIds,
            tasteGameIds,
            tasteSignal,
            limit: 30,
          })
        }
      } catch { games = [] }

      if (cancelRef.current) return

      // Notify parent when a mood deck returns nothing so the chip can be hidden
      if (moodId && games.length === 0 && onMoodEmpty) {
        onMoodEmpty(moodId)
      }

      for (const g of games) {
        seenIdsRef.current.add(String(g.id))
        sessionPoolRef.current.push(g)
      }
      setPool(games)
    }

    load().catch(() => {
      if (!cancelRef.current) setPool([])
    })

    return () => { cancelRef.current = true }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background refill ─────────────────────────────────────────────────────

  useEffect(() => {
    if (
      pool === null ||
      exhausted ||
      refilling ||
      pool.length === 0 ||
      currentIdx < pool.length - REFILL_THRESHOLD
    ) return

    setRefilling(true)

    const excludeIds = new Set([
      ...libraryIdsRef.current,
      ...seenIdsRef.current,
      ...getSwipeExcludeIds(),
    ])
    const tasteGameIds = getTopRatedPlayedIds(3)
    const tasteSignal  = tasteRef.current

    const refillPromise = moodId
      ? getMoodDeck(moodId, { excludeIds, limit: 30 })
      : getDiscoveryDeck({ excludeIds, tasteGameIds, tasteSignal, limit: 30 })

    refillPromise
      .then((newGames) => {
        if (cancelRef.current) return

        const fresh = newGames.filter((g) => !seenIdsRef.current.has(String(g.id)))

        if (fresh.length === 0) {
          setExhausted(true)
          return
        }

        for (const g of fresh) {
          seenIdsRef.current.add(String(g.id))
          sessionPoolRef.current.push(g)
        }
        setPool((prev) => [...prev, ...fresh])
      })
      .catch(() => { if (!cancelRef.current) setExhausted(true) })
      .finally(() => { if (!cancelRef.current) setRefilling(false) })
  }, [currentIdx, pool, refilling, exhausted])

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    setSwipeCount((n) => n + 1)
    setCurrentIdx((i) => i + 1)
  }, [])

  const handleSwipeRight = useCallback(
    (game) => {
      // Persistent swipe record + taste-signal refresh (auto-fires via event).
      recordSwipe(game, SWIPE_ACTIONS.BACKLOG)
      sessionBacklogRef.current.add(String(game.id))
      setBacklogCount((n) => n + 1)

      addGameToList('want-to-play', {
        id:        String(game.id),
        title:     game.title,
        image:     game.image    || game.coverUrl || null,
        year:      game.year     ?? null,
        developer: game.developer ?? null,
        genre:     game.genre    ?? null,
        rating:    game.rating   ?? null,
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
      if (game) recordSwipe(game, SWIPE_ACTIONS.SKIP)
      advance()
    },
    [advance]
  )

  // Stronger negative: marked "not for me". Soft-filters the genre from
  // future batches. Tertiary action — not a swipe direction; the button
  // sits below the primary action row.
  const handleNotInterested = useCallback(
    (game) => {
      if (!game) return
      recordSwipe(game, SWIPE_ACTIONS.NOT_INTERESTED)
      showToast(`We'll show you less like that`, 'info', 1800)
      advance()
    },
    [advance]
  )

  // Tap the card body → open game detail.
  const handleTap = useCallback(
    (game) => {
      try {
        sessionStorage.setItem(
          DECK_SESSION_KEY,
          JSON.stringify({ pool, currentIdx })
        )
      } catch { /* storage full — non-fatal */ }
      navigate(`/game/${game.id}`)
    },
    [navigate, pool, currentIdx]
  )

  // ── Compute the end-of-session pick on demand ─────────────────────────────

  const tonightsMatch = useMemo(() => {
    if (!showEndPick && !exhausted) return null
    return pickTonightsMatch(
      sessionPoolRef.current,
      sessionBacklogRef.current,
      tasteRef.current
    )
  }, [showEndPick, exhausted, swipeCount, backlogCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const canShowPick =
    swipeCount >= PICK_AVAILABLE_AFTER_SWIPES && backlogCount >= 1 && !showEndPick

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
        <div className="swipe-deck__actions swipe-deck__actions--ghost" aria-hidden="true">
          <div className="swipe-deck__btn-ghost" />
          <div className="swipe-deck__btn-ghost" />
        </div>
      </div>
    )
  }

  // Empty result — hide section (parent controls outer visibility)
  if (pool.length === 0) return null

  // ── End-of-session pick ─────────────────────────────────────────────────
  // Trigger paths:
  //   1) Deck exhausted with at least one signal seen → always show pick
  //      (replaces the generic "That's all for now" message).
  //   2) User explicitly tapped "I'm done" after ≥ 6 swipes & ≥ 1 backlog.
  const shouldShowEndPick =
    (showEndPick || (currentIdx >= pool.length && (exhausted || !refilling))) &&
    sessionPoolRef.current.length > 0

  if (shouldShowEndPick) {
    if (tonightsMatch) {
      return (
        <div className="swipe-deck">
          <SessionEndPick
            game={tonightsMatch}
            sessionStats={{ swipeCount, backlogCount }}
            onKeepSwiping={
              currentIdx < pool.length && !exhausted
                ? () => setShowEndPick(false)
                : undefined
            }
          />
        </div>
      )
    }

    // Truly nothing to recommend — fall back to the original exhausted state.
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__exhausted" role="status">
          <div className="swipe-deck__exhausted-icon" aria-hidden="true">✓</div>
          <p className="swipe-deck__exhausted-title">That's all for now</p>
          <p className="swipe-deck__exhausted-body">
            We'll surface more games soon — check back later!
          </p>
        </div>
      </div>
    )
  }

  // Waiting for the refill batch to arrive — brief loading interstitial
  if (currentIdx >= pool.length && refilling) {
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__scene" aria-busy="true" aria-label="Loading more games">
          <div className="swipe-deck__skel swipe-deck__skel--2" />
          <div className="swipe-deck__skel swipe-deck__skel--1" />
          <div className="swipe-deck__skel swipe-deck__skel--0" />
        </div>
        <div className="swipe-deck__actions swipe-deck__actions--ghost" aria-hidden="true">
          <div className="swipe-deck__btn-ghost" />
          <div className="swipe-deck__btn-ghost" />
        </div>
      </div>
    )
  }

  // Active deck — render top 3 cards (back-to-front so top card is on top).
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

      {/* Tap-button alternatives — accessibility + reduced-motion safety.
          stopPropagation prevents button taps from bubbling to the card body
          and accidentally triggering card-tap navigation. */}
      <div className="swipe-deck__actions">
        <button
          type="button"
          className="swipe-deck__btn swipe-deck__btn--skip"
          onClick={(e) => { e.stopPropagation(); topGame && handleSwipeLeft(topGame) }}
          aria-label="Skip this game"
        >
          <span className="swipe-deck__btn-icon" aria-hidden="true">✕</span>
          <span className="swipe-deck__btn-label">Skip</span>
        </button>

        <button
          type="button"
          className="swipe-deck__btn swipe-deck__btn--add"
          onClick={(e) => { e.stopPropagation(); topGame && handleSwipeRight(topGame) }}
          aria-label={`Add ${topGame?.title ?? 'this game'} to backlog`}
        >
          <span className="swipe-deck__btn-icon" aria-hidden="true">♥</span>
          <span className="swipe-deck__btn-label">Backlog</span>
        </button>
      </div>

      {/* Tertiary actions row — "Not for me" + optional "I'm done" pick CTA */}
      <div className="swipe-deck__tertiary">
        <button
          type="button"
          className="swipe-deck__link"
          onClick={(e) => { e.stopPropagation(); topGame && handleNotInterested(topGame) }}
        >
          Not for me
        </button>

        {canShowPick && (
          <button
            type="button"
            className="swipe-deck__link swipe-deck__link--accent"
            onClick={() => setShowEndPick(true)}
          >
            Pick for tonight →
          </button>
        )}
      </div>

      <p className="swipe-deck__hint" aria-hidden="true">
        Swipe right to add · left to skip
      </p>
    </div>
  )
}
