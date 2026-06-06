import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import {
  useTrendingThisWeek,
  useJustFinished,
  useRecentReviews,
  useNewReleases,
} from '../hooks/useExploreData'
import SectionHeader from '../components/SectionHeader'
import TrendingCard from '../components/explore/TrendingCard'
import JustFinishedCard from '../components/explore/JustFinishedCard'
import ReviewFeedRow from '../components/explore/ReviewFeedRow'
import NewReleaseCard from '../components/explore/NewReleaseCard'
import { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { GameCardSkeletonRow } from '../components/skeletons/GameCardSkeleton'
import { ReviewRowSkeletonList } from '../components/skeletons/ReviewRowSkeleton'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import './Explore.css'

// ─── Section primitives ────────────────────────────────────────────────────

function ErrorBanner({ message }) {
  return (
    <div className="explore-section__pad">
      <div className="explore-error-banner">
        <p>{message}</p>
      </div>
    </div>
  )
}

function ScrollRow({ items, render }) {
  return (
    <div className="explore-scroll-row">
      {items.map(render)}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

function Explore() {
  const navigate = useNavigate()
  const { isOpen, open } = useSearchOverlay()
  const reduced = useReducedMotion()

  // Each hook fires immediately on mount; they run concurrently.
  // The community mock service shares a single in-flight pool fetch so the
  // three community sections only pay one IGDB roundtrip between them.
  const trending = useTrendingThisWeek()
  const finished = useJustFinished()
  const reviews = useRecentReviews()
  const releases = useNewReleases()

  const sections = []

  // 1. Trending this week
  sections.push(
    <section key="trending" className="explore-section">
      <div className="explore-section__pad">
        <SectionHeader title="Trending this week" />
      </div>
      {trending.loading ? (
        <GameCardSkeletonRow count={6} />
      ) : trending.error ? (
        <ErrorBanner message="Could not load trending games." />
      ) : trending.data && trending.data.length > 0 ? (
        <ScrollRow
          items={trending.data}
          render={(entry) => <TrendingCard key={entry.game.id} entry={entry} />}
        />
      ) : (
        <div className="explore-section__pad">
          <p className="explore-section-empty">No trending activity yet — check back later.</p>
        </div>
      )}
    </section>
  )

  // 2. Just finished
  sections.push(
    <section key="finished" className="explore-section">
      <div className="explore-section__pad">
        <SectionHeader title="Just finished" />
      </div>
      {finished.loading ? (
        <GameCardSkeletonRow count={6} />
      ) : finished.error ? (
        <ErrorBanner message="Could not load recently finished games." />
      ) : finished.data && finished.data.length > 0 ? (
        <ScrollRow
          items={finished.data}
          render={(entry) => <JustFinishedCard key={entry.id} entry={entry} />}
        />
      ) : (
        <div className="explore-section__pad">
          <p className="explore-section-empty">No recently finished games yet.</p>
        </div>
      )}
    </section>
  )

  // 3. Recent reviews (vertical feed)
  sections.push(
    <section key="reviews" className="explore-section">
      <div className="explore-section__pad">
        <SectionHeader
          title="Recent reviews"
          action="Your reviews"
          onAction={() => navigate('/reviews')}
        />
      </div>
      {reviews.loading ? (
        <ReviewRowSkeletonList count={4} />
      ) : reviews.error ? (
        <ErrorBanner message="Could not load reviews." />
      ) : reviews.data && reviews.data.length > 0 ? (
        <div className="explore-review-feed">
          {reviews.data.map((r) => (
            <ReviewFeedRow key={r.id} review={r} />
          ))}
        </div>
      ) : (
        <div className="explore-section__pad">
          <p className="explore-section-empty">No reviews yet — be the first to write one.</p>
        </div>
      )}
    </section>
  )

  // 4. New releases
  sections.push(
    <section key="releases" className="explore-section">
      <div className="explore-section__pad">
        <SectionHeader title="New releases" />
      </div>
      {releases.loading ? (
        <GameCardSkeletonRow count={6} />
      ) : releases.error ? (
        <ErrorBanner message="Could not load upcoming releases." />
      ) : releases.data && releases.data.length > 0 ? (
        <ScrollRow
          items={releases.data}
          render={(g) => <NewReleaseCard key={g.id} game={g} />}
        />
      ) : (
        <div className="explore-section__pad">
          <p className="explore-section-empty">No new releases in the next 30 days.</p>
        </div>
      )}
    </section>
  )

  // The same game can show up across Trending / Just Finished / Recent
  // Reviews / New Releases. Drop the layoutId on duplicates so Motion has
  // exactly one source for the cover-to-hero flight.
  const duplicateIds = useMemo(() => {
    const trendingGames = (trending.data || []).map((e) => e.game)
    const finishedGames = (finished.data || []).map((e) => e.game)
    // Real Supabase review rows expose `igdb_game_id`; the legacy mock
    // shape exposes `r.game.id`. Coerce both into the { id, image } shape
    // findDuplicateGameIds expects.
    const reviewGames = (reviews.data || []).map((r) =>
      r.game ? r.game : { id: r.igdb_game_id, image: r.game_image }
    )
    const releaseGames = releases.data || []
    return findDuplicateGameIds(
      trendingGames,
      finishedGames,
      reviewGames,
      releaseGames
    )
  }, [trending.data, finished.data, reviews.data, releases.data])

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="explore-page">
        {/* Page header — title on the left, search icon on the right.
            The motion.div wrapping the icon carries layoutId="search-bar"
            (when the overlay is closed) so Framer Motion can morph the
            icon into the overlay's input bar on open. */}
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

        {sections}
      </div>
    </SharedCoverScope>
  )
}

export default Explore
