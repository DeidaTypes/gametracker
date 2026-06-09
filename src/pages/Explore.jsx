import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import {
  useTrendingThisWeek,
  useDiscoverGamesNew,
  useFollowingReviews,
  usePopularReviews,
  useMostPlayedThisWeek,
} from '../hooks/useExploreData'
import TrendingCard from '../components/explore/TrendingCard'
import NewReleaseCard from '../components/explore/NewReleaseCard'
import GameOfWeekHero from '../components/explore/GameOfWeekHero'
import MostPlayedRail from '../components/explore/MostPlayedRail'
import ReviewCard from '../components/ReviewCard'
import FindFriendsModal from '../components/FindFriendsModal'
import { GameCardSkeletonRow } from '../components/skeletons/GameCardSkeleton'
import { ReviewRowSkeletonList } from '../components/skeletons/ReviewRowSkeleton'
import { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import { useAuth } from '../contexts/AuthContext'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { getLikeCountsForReviews } from '../services/likeService'
import './Explore.css'

// ─── Helpers ───────────────────────────────────────────────────────────────

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

/** Map a raw Supabase review row → shape ReviewCard expects. */
function toReviewCardShape(row, likeCounts, commentCounts) {
  return {
    id: row.id,
    userId: row.user_id,
    game: {
      id: String(row.igdb_game_id || ''),
      name: row.game_title || 'Unknown Game',
      coverUrl: row.game_image || '',
      developer: '',
    },
    author: {
      username: row.users?.username || null,
      displayName: row.users?.display_name || 'Anonymous',
      userId: row.user_id,
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
    hoursPlayed: Number(row.hours_played) || 0,
    likeCount: likeCounts?.get(row.id) || 0,
    commentCount: commentCounts?.get(row.id) || 0,
    createdAt: row.created_at,
  }
}

/**
 * "Word / Word" slash toggle — left option default-selected.
 * Active label: var(--accent) cobalt. Inactive + slash: var(--color-text-tertiary).
 * options[0] = left (should be the default); options[1] = right.
 */
function SlashToggle({ options, value, onChange }) {
  return (
    <div className="discover-slash-toggle" role="group" aria-label="View options">
      <button
        type="button"
        className={`discover-slash-toggle__btn${value === options[0].value ? ' discover-slash-toggle__btn--active' : ''}`}
        onClick={() => onChange(options[0].value)}
        aria-pressed={value === options[0].value}
      >
        {options[0].label}
      </button>
      <span className="discover-slash-toggle__sep" aria-hidden="true">/</span>
      <button
        type="button"
        className={`discover-slash-toggle__btn${value === options[1].value ? ' discover-slash-toggle__btn--active' : ''}`}
        onClick={() => onChange(options[1].value)}
        aria-pressed={value === options[1].value}
      >
        {options[1].label}
      </button>
    </div>
  )
}

const GAMES_TABS = [
  { value: 'popular', label: 'Popular' },
  { value: 'new',     label: 'New' },
]

const REVIEWS_TABS = [
  { value: 'popular',   label: 'Popular' },
  { value: 'following', label: 'Following' },
]

// ─── Page ──────────────────────────────────────────────────────────────────

function Explore() {
  const navigate = useNavigate()
  const { isOpen, open } = useSearchOverlay()
  const reduced = useReducedMotion()
  const { user } = useAuth()

  const [gamesTab, setGamesTab]     = useState('popular')
  const [reviewsTab, setReviewsTab] = useState('popular')
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)

  // All data sources fire at mount in parallel (no sequential waterfall).
  const trending         = useTrendingThisWeek()   // games POPULAR tab
  const newGames         = useDiscoverGamesNew()    // games NEW tab
  const followingReviews = useFollowingReviews()    // reviews FOLLOWING tab
  const popularReviews   = usePopularReviews()      // reviews POPULAR tab
  const mostPlayed       = useMostPlayedThisWeek()  // most played this week rail

  // Unified like + comment counts for cards currently visible.
  const [likeCounts, setLikeCounts]       = useState(() => new Map())
  const [commentCounts, setCommentCounts] = useState(() => new Map())

  // Prefetch like + comment counts for whichever reviews are loaded.
  // Runs whenever either feed's data arrives so switching tabs shows counts
  // without waiting for a separate round-trip.
  useEffect(() => {
    const allRows = [
      ...(followingReviews.data || []),
      ...(popularReviews.data  || []),
    ]
    if (!allRows.length) return
    const ids = [...new Set(allRows.map((r) => r.id))]
    Promise.all([
      prefetchLikeStatesForReviews(ids),
      getCommentCountsForReviews(ids),
    ]).then(([, cCounts]) => {
      setCommentCounts(cCounts)
    }).catch(() => {})
    getLikeCountsForReviews(ids).then(setLikeCounts).catch(() => {})
  }, [followingReviews.data, popularReviews.data])

  // Active data for each section.
  const activeGamesState   = gamesTab   === 'popular' ? trending        : newGames
  const activeReviewsState = reviewsTab === 'popular'  ? popularReviews  : followingReviews

  // Gather all game ids across both carousel options so SharedCover
  // has exactly one layoutId source per game.
  const duplicateIds = useMemo(() => {
    const trendingGames = (trending.data || []).map((e) => e.game)
    const newGamesArr   = (newGames.data  || []).map((g) => ({ id: g.id, image: g.image }))
    const reviewGames   = [
      ...(followingReviews.data || []),
      ...(popularReviews.data   || []),
    ].map((r) => ({ id: r.igdb_game_id, image: r.game_image }))
    return findDuplicateGameIds(trendingGames, newGamesArr, reviewGames)
  }, [trending.data, newGames.data, followingReviews.data, popularReviews.data])

  // ── Reviews section helpers ─────────────────────────────────────────────

  const reviewsData = activeReviewsState.data

  // "Following" empty state: user follows nobody (or they have no reviews).
  const showFollowingEmpty =
    reviewsTab === 'following' &&
    !activeReviewsState.loading &&
    !activeReviewsState.error &&
    (!reviewsData || reviewsData.length === 0)

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
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

        {/* ── Game of the Week hero — editorial featured slot ── */}
        <GameOfWeekHero />

        {/* ── Section 1: Games carousel ── */}
        <section className="explore-section explore-section--0">
          <div className="explore-section__pad discover-section-header">
            <h2 className="discover-section-title">Trending this week</h2>
            <SlashToggle
              options={GAMES_TABS}
              value={gamesTab}
              onChange={setGamesTab}
            />
          </div>

          {activeGamesState.loading ? (
            <GameCardSkeletonRow count={6} />
          ) : activeGamesState.error ? (
            <ErrorBanner
              message={
                gamesTab === 'popular'
                  ? 'Could not load trending games.'
                  : 'Could not load new releases.'
              }
            />
          ) : activeGamesState.data && activeGamesState.data.length > 0 ? (
            <ScrollRow
              items={activeGamesState.data}
              render={
                gamesTab === 'popular'
                  ? (entry) => <TrendingCard key={entry.game.id} entry={entry} />
                  : (game) => <NewReleaseCard key={game.id} game={game} />
              }
            />
          ) : (
            <div className="explore-section__pad">
              <p className="explore-section-empty">
                {gamesTab === 'popular'
                  ? 'No trending activity yet — check back later.'
                  : 'No recent releases found.'}
              </p>
            </div>
          )}
        </section>

        {/* ── Section 2: Reviews feed ── */}
        <section className="explore-section explore-section--1">
          <div className="explore-section__pad discover-section-header">
            <h2 className="discover-section-title">Reviews</h2>
            <SlashToggle
              options={REVIEWS_TABS}
              value={reviewsTab}
              onChange={setReviewsTab}
            />
          </div>

          {activeReviewsState.loading ? (
            <ReviewRowSkeletonList count={4} />
          ) : activeReviewsState.error ? (
            <ErrorBanner message="Could not load reviews." />
          ) : showFollowingEmpty ? (
            /* Empty "Following" state — CTA to find people */
            <div className="discover-empty-following">
              <p className="discover-empty-following__msg">
                Follow people to see their reviews here.
              </p>
              <button
                type="button"
                className="discover-empty-following__cta"
                onClick={() => setFindFriendsOpen(true)}
              >
                Find people to follow
              </button>
            </div>
          ) : reviewsData && reviewsData.length > 0 ? (
            <div className="explore-review-feed">
              {reviewsData.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={toReviewCardShape(r, likeCounts, commentCounts)}
                />
              ))}
            </div>
          ) : (
            <div className="explore-section__pad">
              <p className="explore-section-empty">
                {reviewsTab === 'popular'
                  ? 'No popular reviews yet — check back later.'
                  : 'No reviews yet — be the first to write one.'}
              </p>
            </div>
          )}
        </section>

        {/* ── Section 3: Most played this week ── */}
        {(mostPlayed.loading || (mostPlayed.data && mostPlayed.data.length > 0)) && (
          <section className="explore-section explore-section--2">
            <div className="explore-section__pad discover-section-header">
              <h2 className="discover-section-title">Most played this week</h2>
            </div>
            <MostPlayedRail
              data={mostPlayed.data}
              loading={mostPlayed.loading}
              error={mostPlayed.error}
            />
          </section>
        )}

      </div>

      <FindFriendsModal
        isOpen={findFriendsOpen}
        onClose={() => setFindFriendsOpen(false)}
        currentUserId={user?.id || null}
      />
    </SharedCoverScope>
  )
}

export default Explore
