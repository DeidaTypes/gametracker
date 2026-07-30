import React, { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import { SwipeDeck } from '../components/explore/SwipeDeck'
import CollectionsShelf from '../components/explore/CollectionsShelf'
import FollowingShelf from '../components/explore/FollowingShelf'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import {
  getSessionAddCount,
  SESSION_ADD_COUNT_CHANGED_EVENT,
} from '../services/swipeService'
import './Explore.css'

// ─── Page ──────────────────────────────────────────────────────────────────

/**
 * Explore (Discover) — editorial discovery surface.
 *
 * Section spine, top to bottom:
 *   1. Swipe to discover  — full-catalog Tinder deck. Sources from EVERY
 *      major IGDB genre (quality-gated, not taste-restricted) so genres the
 *      user has never engaged with still surface; the taste vector only
 *      lightly nudges card order, never which genres are eligible. Backed
 *      by the real IGDB catalog + background pagination, so it never runs
 *      out mid-session — for active browsing/decision-making (skip/backlog).
 *   2. Collections        — curated ("by Checkpoint") + popular community
 *                            lists as mosaic cards (hidden if none qualify)
 *   3. From people you follow — "Recently": followed users' real ratings
 *      + reviews, each with an algorithmic taste-match strip. Falls back
 *      to broader community activity so it's never empty.
 */
function Explore() {
  const { isOpen, open } = useSearchOverlay()
  const reduced = useReducedMotion()

  // "N added tonight" payoff indicator — real backlog adds from the swipe
  // deck this session (see swipeService.incrementSessionAddCount). Hidden
  // entirely at zero, never rendered as "0 added tonight".
  const [addedTonight, setAddedTonight] = useState(0)

  useEffect(() => {
    setAddedTonight(getSessionAddCount())
    const onChange = (e) => setAddedTonight(e.detail?.count ?? getSessionAddCount())
    window.addEventListener(SESSION_ADD_COUNT_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SESSION_ADD_COUNT_CHANGED_EVENT, onChange)
  }, [])

  return (
    <div className="explore-page">

      {/* ── Page header ── */}
      <div className="explore-header">
        <h1 className="explore-header__title">Discover</h1>
        <button
          type="button"
          className="explore-search-btn"
          onClick={open}
          aria-label="Search"
        >
          <motion.div
            layoutId={isOpen ? undefined : 'search-bar'}
            className="explore-search-btn__inner"
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 380, damping: 30 }
            }
          >
            <Search size={22} aria-hidden="true" />
          </motion.div>
        </button>
      </div>

      {/* ── 1. Swipe to discover — full-catalog, all-genres deck ── */}
      <section className="explore-section explore-section--swipe-deck">
        <div className="explore-section__pad discover-section-header">
          <h2 className="discover-section-title">Swipe to discover</h2>
          {addedTonight > 0 && (
            <span className="discover-payoff-indicator">
              {addedTonight} added tonight
            </span>
          )}
        </div>
        <SwipeDeck />
      </section>

      {/* ── 2. Collections — curated + community lists ── */}
      <CollectionsShelf />

      {/* ── 3. From people you follow — "Recently" ratings & reviews ── */}
      <FollowingShelf />

    </div>
  )
}

export default Explore
