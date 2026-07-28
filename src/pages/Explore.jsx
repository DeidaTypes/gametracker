import React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import { SwipeDeck } from '../components/explore/SwipeDeck'
import CollectionsShelf from '../components/explore/CollectionsShelf'
import FollowingShelf from '../components/explore/FollowingShelf'
import HiddenGemsRail from '../components/explore/HiddenGemsRail'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
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
 *   4. Hidden gems for you — closer rail. High-rating, low-volume games
 *      scoped to the genres/themes the user's OWN taste vector shows
 *      real affinity for, passive/scannable. Never a mainstream title
 *      everyone already knows, and never overlaps with the Swipe deck's
 *      broad variety.
 */
function Explore() {
  const { isOpen, open } = useSearchOverlay()
  const reduced = useReducedMotion()

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
        </div>
        <SwipeDeck />
      </section>

      {/* ── 2. Collections — curated + community lists ── */}
      <CollectionsShelf />

      {/* ── 3. From people you follow — "Recently" ratings & reviews ── */}
      <FollowingShelf />

      {/* ── 4. Hidden gems for you — taste-scoped closer rail ── */}
      <HiddenGemsRail />

    </div>
  )
}

export default Explore
