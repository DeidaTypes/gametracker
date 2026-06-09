import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getDiscoveryDeck } from '../../services/igdb'
import { getAllLists, addGameToList, getGamesFromList } from '../../services/libraryService'
import { supabase } from '../../services/supabase'
import { showToast } from '../Toast'
import { SwipeCard } from './SwipeCard'
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

// ── Component ──────────────────────────────────────────────────────────────

/**
 * SwipeDeck — "Swipe to discover" randomised card stack on the Discover page.
 *
 * Pool source
 *   getDiscoveryDeck() fires 3 parallel IGDB queries with randomised genre,
 *   era, and offset axes — so every session surfaces a different mix of
 *   classics, indie gems, and genre surprises. Quality-gated on total_rating
 *   and total_rating_count; not sorted by popularity.
 *
 * Exclusion
 *   On mount, reads every localStorage list AND queries Supabase game_trackers
 *   for the signed-in user, then removes any matching IGDB game ID from the
 *   candidate pool. seenIds is tracked in a ref across the entire session so
 *   refill batches never repeat earlier cards.
 *
 * Refill
 *   When the deck reaches REFILL_THRESHOLD cards from the end, a fresh batch
 *   (new randomised axes) is fetched in the background and appended. The deck
 *   only shows "That's all for now" when IGDB truly returns nothing new.
 *
 * Right swipe / ♥
 *   Optimistic addGameToList('want-to-play') + async Supabase upsert.
 *
 * Left swipe / ✕
 *   Session-local skip — not persisted.
 */
export function SwipeDeck() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [pool, setPool]             = useState(null)  // null = initial loading
  const [currentIdx, setCurrentIdx] = useState(0)
  const [refilling, setRefilling]   = useState(false)
  const [exhausted, setExhausted]   = useState(false)

  // Refs persist across renders / refills without triggering re-renders.
  const seenIdsRef    = useRef(new Set()) // all IDs shown this session
  const libraryIdsRef = useRef(new Set()) // all IDs in user's library
  const cancelRef     = useRef(false)

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    cancelRef.current = false

    async function load() {
      // 1. Snapshot localStorage library IDs.
      libraryIdsRef.current = buildLocalLibraryIds()

      // 2. Merge in Supabase game_trackers (cross-device accuracy; best-effort).
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

      // 3. Restore deck state when returning from a card-tap to GameDetail.
      //    The tap handler serialises pool + currentIdx to sessionStorage before
      //    navigating; we pick it up here so the same card is still on top.
      try {
        const raw = sessionStorage.getItem(DECK_SESSION_KEY)
        if (raw) {
          sessionStorage.removeItem(DECK_SESSION_KEY)
          const saved = JSON.parse(raw)
          if (Array.isArray(saved.pool) && saved.pool.length > 0 && !cancelRef.current) {
            for (const g of saved.pool) seenIdsRef.current.add(String(g.id))
            setPool(saved.pool)
            setCurrentIdx(typeof saved.currentIdx === 'number' ? saved.currentIdx : 0)
            return
          }
        }
      } catch { /* non-fatal — fall through to fresh fetch */ }

      // 4. Taste seed: top-rated played games drive similar_games suggestions.
      const tasteGameIds = getTopRatedPlayedIds(3)

      // 5. Fetch the first randomised batch.
      const excludeIds = new Set([...libraryIdsRef.current, ...seenIdsRef.current])
      let games = []
      try {
        games = await getDiscoveryDeck({ excludeIds, tasteGameIds, limit: 30 })
      } catch { games = [] }

      if (cancelRef.current) return

      for (const g of games) seenIdsRef.current.add(String(g.id))
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

    const excludeIds   = new Set([...libraryIdsRef.current, ...seenIdsRef.current])
    const tasteGameIds = getTopRatedPlayedIds(3)

    getDiscoveryDeck({ excludeIds, tasteGameIds, limit: 30 })
      .then((newGames) => {
        if (cancelRef.current) return

        // Only keep games not already seen this session.
        const fresh = newGames.filter((g) => !seenIdsRef.current.has(String(g.id)))

        if (fresh.length === 0) {
          setExhausted(true)
          return
        }

        for (const g of fresh) seenIdsRef.current.add(String(g.id))
        setPool((prev) => [...prev, ...fresh])
      })
      .catch(() => { if (!cancelRef.current) setExhausted(true) })
      .finally(() => { if (!cancelRef.current) setRefilling(false) })
  }, [currentIdx, pool, refilling, exhausted])

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const handleSwipeRight = useCallback(
    (game) => {
      // Optimistic: write to localStorage immediately.
      addGameToList('want-to-play', {
        id:        String(game.id),
        title:     game.title,
        image:     game.image    || game.coverUrl || null,
        year:      game.year     ?? null,
        developer: game.developer ?? null,
        genre:     game.genre    ?? null,
        rating:    game.rating   ?? null,
      })

      // Async Supabase upsert — fire-and-forget, never blocks UI.
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
      setCurrentIdx((i) => i + 1)
    },
    [user]
  )

  const handleSwipeLeft = useCallback(() => {
    setCurrentIdx((i) => i + 1)
  }, [])

  // Tap the card body → open game detail. Saves deck state so returning from
  // GameDetail restores the same card as the top of the deck.
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
        <div className="swipe-deck__actions swipe-deck__actions--ghost" aria-hidden="true">
          <div className="swipe-deck__btn-ghost" />
          <div className="swipe-deck__btn-ghost" />
        </div>
      </div>
    )
  }

  // Empty result — hide section (parent controls outer visibility)
  if (pool.length === 0) return null

  // Deck exhausted and no refill coming — show end state
  if (currentIdx >= pool.length && (exhausted || !refilling)) {
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
          onClick={(e) => { e.stopPropagation(); handleSwipeLeft(topGame) }}
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

      <p className="swipe-deck__hint" aria-hidden="true">
        Swipe right to add · left to skip
      </p>
    </div>
  )
}
