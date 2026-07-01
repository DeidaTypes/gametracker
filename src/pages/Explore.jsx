import React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import GameOfWeekHero from '../components/explore/GameOfWeekHero'
import { SwipeDeck } from '../components/explore/SwipeDeck'
import CollectionsShelf from '../components/explore/CollectionsShelf'
import FollowingShelf from '../components/explore/FollowingShelf'
import NotesWorthReading from '../components/explore/NotesWorthReading'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import './Explore.css'

// ─── Page ──────────────────────────────────────────────────────────────────

/**
 * Explore (Discover) — editorial discovery surface.
 *
 * Section spine, top to bottom:
 *   1. Game of the Day    — daily-rotating hero (community pick / curated)
 *   2. Swipe to discover  — E0 taste-ranked Tinder deck
 *   3. Collections        — scaffold slot (E2 owns internals)
 *   4. From people you follow — scaffold slot (E3 owns internals)
 *   5. Notes worth reading — real community pull-quotes (hidden if none)
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

      {/* ── 1. Game of the Day — daily-rotating editorial hero ── */}
      <GameOfWeekHero cadence="day" />

      {/* ── 2. Swipe to discover — E0 taste-ranked deck ── */}
      <section className="explore-section explore-section--swipe-deck">
        <div className="explore-section__pad discover-section-header">
          <h2 className="discover-section-title">Swipe to discover</h2>
        </div>
        <SwipeDeck />
      </section>

      {/* ── 3. Collections — E2 slot ── */}
      <CollectionsShelf />

      {/* ── 4. From people you follow — E3 slot ── */}
      <FollowingShelf />

      {/* ── 5. Notes worth reading — real community pull-quotes ── */}
      <NotesWorthReading />

    </div>
  )
}

export default Explore
