import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRecommendations, getTasteVector } from '../../services/tasteEngineService'
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
 * Top N genre names from a taste vector, highest weight first. Used to
 * find which of a candidate's genres actually overlap with what the user
 * likes across their WHOLE library — not just one seed game.
 */
function topGenreNames(vector, n = 6) {
  if (!vector?.genreWeights) return []
  return Object.entries(vector.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name)
}

/**
 * Map an E0 recommendation row → the card shape SwipeCard consumes.
 *
 * `matchGenres` is the overlap between this candidate's own genres and the
 * user's top taste-vector genres (broad, whole-library signal) — this is
 * what SwipeCard shows as the reason, NOT a single seed game. That framing
 * is reserved for the "Because You Played" rail so the two surfaces never
 * say the same thing about the same card.
 */
function recToCard(rec, topGenres) {
  const genres = Array.isArray(rec.game.genres) ? rec.game.genres : []
  const matchGenres = topGenres.length
    ? genres.filter((g) => topGenres.includes(g)).slice(0, 2)
    : []
  return {
    id: rec.game.id,
    title: rec.game.title,
    image: rec.game.image,
    year: rec.game.year ?? null,
    genre: genres.join(', ') || null,
    rating: rec.game.totalRating != null ? rec.game.totalRating / 20 : null,
    matchGenres,
    matchScore: rec.matchScore,
  }
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * SwipeDeck — the "Swipe to discover" card stack on the Discover page.
 *
 * Source of truth: the E0 taste engine. Cards are pulled from
 * getRecommendations (precomputed, taste-ranked) — NEVER random IGDB games.
 * Already-tracked games and previously-swiped games are excluded client-side
 * as a belt-and-suspenders on top of the engine's own exclusions.
 *
 * BROAD exploration by design (the deliberate contrast with the page's
 * "Because you played {seed}" closer, which is narrow/single-seed): each
 * card's on-card reason is the overlap between ITS genres and the user's
 * top genres across their WHOLE taste vector (getTasteVector), not a
 * "like {one game}" attribution. Two cards in the same deck can — and
 * should — cite different genres, since the deck spans the user's full
 * taste, not one anchor title.
 *
 * Every swipe is persisted via swipeService.recordSwipe:
 *   • ✕ Skip     → negative signal (recorded locally).
 *   • ♥ Backlog  → positive signal (recorded locally) AND written to the
 *                  cross-device library + game_trackers. The taste engine
 *                  reads game_trackers on its next run, so the like feeds
 *                  back into E0 wherever the engine supports it.
 *
 * When the finite recommendation list is exhausted (or the engine has none
 * yet) we show an honest empty/end state — we do not backfill with random
 * games.
 */
export function SwipeDeck() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [pool, setPool]             = useState(null) // null = initial loading
  const [currentIdx, setCurrentIdx] = useState(0)

  const libraryIdsRef = useRef(new Set())
  const cancelRef     = useRef(false)

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
            setPool(saved.pool)
            setCurrentIdx(typeof saved.currentIdx === 'number' ? saved.currentIdx : 0)
            return
          }
        }
      } catch { /* non-fatal — fall through to fresh fetch */ }

      let recs = []
      let vector = null
      try {
        ;[recs, vector] = await Promise.all([
          getRecommendations(user?.id, 40),
          getTasteVector(user?.id),
        ])
      } catch { recs = []; vector = null }

      if (cancelRef.current) return

      const excludeIds = new Set([
        ...libraryIdsRef.current,
        ...getSwipeExcludeIds(),
      ])

      const topGenres = topGenreNames(vector)
      const cards = recs
        .map((rec) => recToCard(rec, topGenres))
        .filter((c) => c.id != null && !excludeIds.has(String(c.id)))

      setPool(cards)
    }

    load().catch(() => {
      if (!cancelRef.current) setPool([])
    })

    return () => { cancelRef.current = true }
  }, [user?.id])

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

  // No recommendations from the engine yet — honest empty state (never random).
  if (pool.length === 0) {
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__empty" role="status">
          <div className="swipe-deck__empty-icon" aria-hidden="true">✦</div>
          <p className="swipe-deck__empty-title">Personalized picks are warming up</p>
          <p className="swipe-deck__empty-body">
            Rate a few games you've played and we'll tune this deck to your taste.
          </p>
        </div>
      </div>
    )
  }

  // Reached the end of the finite recommendation list.
  if (currentIdx >= pool.length) {
    return (
      <div className="swipe-deck">
        <div className="swipe-deck__empty" role="status">
          <div className="swipe-deck__empty-icon swipe-deck__empty-icon--done" aria-hidden="true">✓</div>
          <p className="swipe-deck__empty-title">That's all for now</p>
          <p className="swipe-deck__empty-body">
            You've been through today's picks — check back soon for more.
          </p>
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
