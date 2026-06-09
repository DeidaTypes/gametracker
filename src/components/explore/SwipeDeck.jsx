import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchSwipeDeckPool } from '../../services/igdb'
import { getAllLists, addGameToList } from '../../services/libraryService'
import { supabase } from '../../services/supabase'
import { showToast } from '../Toast'
import { SwipeCard } from './SwipeCard'
import './SwipeDeck.css'

/**
 * SwipeDeck — "Swipe to discover" card stack on the Discover page.
 *
 * Pool source
 *   fetchSwipeDeckPool() → IGDB popular games (rating > 72, last 5 yrs),
 *   cached by igdbRequest's 5-min in-memory + Edge Function proxy cache.
 *
 * Exclusion
 *   On mount, reads ALL localStorage lists (want-to-play, currently-playing,
 *   played, dropped, custom lists) and removes any matching IGDB game ID from
 *   the candidate pool. Snapshot-at-mount — session additions are reflected
 *   immediately by the deck advancing past them via the right-swipe write.
 *
 * Right swipe / ♥ button
 *   Optimistic: addGameToList('want-to-play', game) — instant localStorage write
 *   + dispatches 'libraryUpdated'. Then fire-and-forget Supabase upsert to
 *   game_trackers (user_id, igdb_game_id, status='want', game_title, game_image).
 *
 * Left swipe / ✕ button
 *   Skip — session-local only; not persisted anywhere.
 *
 * Exhausted
 *   "That's all for now" state when currentIdx >= pool.length.
 */
export function SwipeDeck() {
  const { user } = useAuth()

  const [pool, setPool]           = useState(null) // null = loading
  const [currentIdx, setCurrentIdx] = useState(0)
  const cancelRef = useRef(false)

  // Fetch + filter pool on mount
  useEffect(() => {
    cancelRef.current = false

    fetchSwipeDeckPool(40)
      .then((games) => {
        if (cancelRef.current) return

        // Build a set of every game ID already in any localStorage list.
        const allLists = getAllLists()
        const trackedIds = new Set()
        for (const list of Object.values(allLists)) {
          for (const g of list.games ?? []) {
            if (g.id != null) trackedIds.add(String(g.id))
          }
        }

        // Filter out tracked games; cap deck at 25 cards.
        const filtered = games
          .filter((g) => !trackedIds.has(String(g.id)))
          .slice(0, 25)

        setPool(filtered)
      })
      .catch(() => {
        if (!cancelRef.current) setPool([])
      })

    return () => {
      cancelRef.current = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const handleSwipeRight = useCallback(
    (game) => {
      // 1. Optimistic localStorage write (immediate)
      addGameToList('want-to-play', {
        id:        String(game.id),
        title:     game.title,
        image:     game.image    || game.coverUrl || null,
        year:      game.year     ?? null,
        developer: game.developer ?? null,
        genre:     game.genre    ?? null,
        rating:    game.rating   ?? null,
      })

      // 2. Async Supabase upsert — fire-and-forget, never blocks the UI.
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
          .catch((err) =>
            console.error('[SwipeDeck] game_trackers upsert failed:', err)
          )
      }

      // 3. Confirm to the user
      showToast(`Added "${game.title}" to Backlog`, 'success', 2500)

      // 4. Advance the deck
      setCurrentIdx((i) => i + 1)
    },
    [user]
  )

  const handleSwipeLeft = useCallback(() => {
    setCurrentIdx((i) => i + 1)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Loading skeleton
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

  // Error / no games — section stays hidden (parent controls visibility)
  if (pool.length === 0) return null

  // Exhausted — all cards swiped
  if (currentIdx >= pool.length) {
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

  // Active deck — show top 3 cards in back-to-front DOM order so the top
  // card (rendered last) naturally appears above the others without
  // requiring explicit z-index juggling.
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
          />
        )}
      </div>

      {/* Tap-button alternatives — accessibility + reduced-motion safety */}
      <div className="swipe-deck__actions">
        <button
          type="button"
          className="swipe-deck__btn swipe-deck__btn--skip"
          onClick={() => handleSwipeLeft(topGame)}
          aria-label="Skip this game"
        >
          <span className="swipe-deck__btn-icon" aria-hidden="true">✕</span>
          <span className="swipe-deck__btn-label">Skip</span>
        </button>

        <button
          type="button"
          className="swipe-deck__btn swipe-deck__btn--add"
          onClick={() => topGame && handleSwipeRight(topGame)}
          aria-label={`Add ${topGame?.title ?? 'this game'} to backlog`}
        >
          <span className="swipe-deck__btn-icon" aria-hidden="true">♥</span>
          <span className="swipe-deck__btn-label">Backlog</span>
        </button>
      </div>

      {/* Hint text */}
      <p className="swipe-deck__hint" aria-hidden="true">
        Swipe right to add · left to skip
      </p>
    </div>
  )
}
