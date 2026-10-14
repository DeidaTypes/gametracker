import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { SwipeDeck } from '../components/explore/SwipeDeck'
import ThemedDropCard from '../components/explore/ThemedDropCard'
import NewNotableRail from '../components/explore/NewNotableRail'
import CollectionsShelf from '../components/explore/CollectionsShelf'
import PullToRefresh from '../components/PullToRefresh'
import { refetchAllExploreSections } from '../hooks/useExploreData'
import {
  getSessionAddCount,
  SESSION_ADD_COUNT_CHANGED_EVENT,
} from '../services/swipeService'
import { partOfDay } from '../utils/partOfDay'
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
 *   2. This week's drop   — the one live themed drop as a single card
 *      (theme, pitch, four covers, +N), tapping through to the whole
 *      drop. Absent, not empty, between drops.
 *   3. New & Notable      — recent releases newest-first, continuing
 *      backward in time on its see-all.
 *   4. Collections        — curated ("by Checkpoint") + popular community
 *                            lists as mosaic cards (hidden if none qualify)
 *
 * Discover shows no ratings. Not on a rail, not on a card, not on any of
 * its see-all grids — covers and titles only. A score under a cover turns
 * browsing into judging, and the whole surface is for games the viewer
 * hasn't judged yet; ratings live on the game detail page, one tap in.
 */
function Explore() {
  const navigate = useNavigate()

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
    // Pull-to-refresh force-refetches every rail below (New & Notable,
    // Collections, the themed drop — see refetchAllExploreSections) by
    // bypassing the swrCache the same way resume already does. The swipe
    // deck deliberately sits outside this: its queue lives in
    // discover:deck:{uid} for the session, and resetting un-swiped cards
    // on every pull would be destructive, not refreshing.
    <PullToRefresh onRefresh={refetchAllExploreSections}>
    <div className="explore-page">

      {/* ── Page header ── */}
      <div className="explore-header">
        <h1 className="explore-header__title">Discover</h1>
        <div className="explore-header__actions">
          {addedTonight > 0 && (
            <span className="discover-payoff-indicator" aria-live="polite">
              {addedTonight} added {partOfDay()}
            </span>
          )}
          <button
            type="button"
            className="explore-search-btn"
            onClick={() => navigate('/search')}
            aria-label="Search"
          >
            <Search size={22} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── 1. Swipe deck — full-catalog, all-genres deck ── */}
      <section className="explore-section explore-section--swipe-deck">
        <SwipeDeck />
      </section>

      {/* ── 2. This week's drop — the one live themed drop ── */}
      <ThemedDropCard />

      {/* ── 3. New & Notable — recent releases, clean covers ── */}
      <NewNotableRail />

      {/* ── 4. Collections — curated + community lists ── */}
      <CollectionsShelf />

    </div>
    </PullToRefresh>
  )
}

export default Explore
