import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Search } from 'lucide-react'
import {
  useTrendingThisWeek,
  useDiscoverGamesNew,
  useFollowingReviews,
  usePopularReviews,
  useMostPlayedThisWeek,
  useCircleMostPlayed,
} from '../hooks/useExploreData'
import { usePresence } from '../hooks/usePresence'
import TrendingCard from '../components/explore/TrendingCard'
import NewReleaseCard from '../components/explore/NewReleaseCard'
import GameOfWeekHero from '../components/explore/GameOfWeekHero'
import EventWeekBanner from '../components/explore/EventWeekBanner'
import MostPlayedRail from '../components/explore/MostPlayedRail'
import GotAnHourRail, {
  TimeBucketChips,
  TTB_BUCKETS,
  mainStoryHours,
  inBucket,
} from '../components/explore/GotAnHourRail'
import { SwipeDeck } from '../components/explore/SwipeDeck'
import { MoodChips } from '../components/explore/MoodChips'
import IOSSwitch from '../components/IOSSwitch'
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
import { getTimeToBeat } from '../services/timeToBeatService'
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
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
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

  // ── Mood deck state ────────────────────────────────────────────────────────
  // activeMood: the currently selected mood chip ID, or null for default deck.
  // emptyMoods: chips whose deck returned 0 results — hidden from the row.
  const [activeMood, setActiveMood]   = useState(null)
  const [emptyMoods, setEmptyMoods]   = useState(() => new Set())

  // ── Blind Date mode — hides title/year/whyLine until the user swipes ───────
  const [blindDate, setBlindDate] = useState(false)

  const handleMoodEmpty = useCallback((moodId) => {
    if (!moodId) return
    setEmptyMoods((prev) => new Set([...prev, moodId]))
    // Reset to default deck when the selected mood comes up empty
    setActiveMood((prev) => (prev === moodId ? null : prev))
  }, [])

  // ── "Got an hour?" state ──────────────────────────────────────────────────
  const [ttbBucket, setTtbBucket]       = useState('short') // default "Short"
  const [gamesWithTtb, setGamesWithTtb] = useState([])      // enriched candidate pool
  const [ttbLoading, setTtbLoading]     = useState(false)
  // Ref prevents cancelled effects from updating state after unmount.
  const ttbCancelRef = useRef(false)

  // All data sources fire at mount in parallel (no sequential waterfall).
  const trending         = useTrendingThisWeek()   // games POPULAR tab
  const newGames         = useDiscoverGamesNew()    // games NEW tab
  const followingReviews = useFollowingReviews()    // reviews FOLLOWING tab
  const popularReviews   = usePopularReviews()      // reviews POPULAR tab
  const mostPlayed       = useMostPlayedThisWeek()  // most played this week rail (global fallback)
  const circlePlayed     = useCircleMostPlayed()    // circle-aware most-played rail

  // Presence — realtime follow-graph "playing now" state.
  // playingNow is [] when presence is disabled or circle has no live members.
  const { playingNow } = usePresence()

  // Unified like + comment counts for cards currently visible.
  const [likeCounts, setLikeCounts]       = useState(() => new Map())
  const [commentCounts, setCommentCounts] = useState(() => new Map())

  // Map game_id → count of friends actively playing right now (from presence).
  const liveByGame = useMemo(() => {
    const map = new Map()
    for (const p of playingNow) {
      if (!p.gameId) continue
      const key = String(p.gameId)
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [playingNow])

  // Circle data annotated with live friend counts. Presence is injected here
  // so MostPlayedRail stays purely presentational.
  const circleDataWithLive = useMemo(() => {
    if (!circlePlayed.data) return null
    return circlePlayed.data.map((item) => ({
      ...item,
      liveCount: liveByGame.get(String(item.igdb_game_id)) || 0,
    }))
  }, [circlePlayed.data, liveByGame])

  // Show the circle section when loading or when it has results.
  // Falls back to the global rail only when circle has returned 0 items.
  const showCircleSection =
    circlePlayed.loading || (circleDataWithLive && circleDataWithLive.length > 0)
  const showGlobalSection =
    !showCircleSection &&
    (mostPlayed.loading || (mostPlayed.data && mostPlayed.data.length > 0))

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

  // ── "Got an hour?" — enrich candidate pool with real IGDB TTB data ────────
  // Pool = trending games ∪ new-release games (both already fetched, no new
  // broad IGDB query). TTB results are cached (mem 5 min + localStorage 24 h)
  // so re-running this effect on tab return is essentially free.
  useEffect(() => {
    // Wait until at least one pool is loaded (undefined = still loading).
    const hasTrending = Array.isArray(trending.data)
    const hasNew      = Array.isArray(newGames.data)
    if (!hasTrending && !hasNew) return

    // Merge both pools, dedup by IGDB game ID.
    const seen = new Set()
    const pool = []

    for (const entry of (trending.data || [])) {
      const g = entry.game
      if (!g?.id) continue
      const key = String(g.id)
      if (seen.has(key)) continue
      seen.add(key)
      pool.push({ id: key, title: g.title, image: g.image })
    }
    for (const g of (newGames.data || [])) {
      if (!g?.id) continue
      const key = String(g.id)
      if (seen.has(key)) continue
      seen.add(key)
      pool.push({ id: key, title: g.title, image: g.image })
    }

    if (!pool.length) return

    ttbCancelRef.current = false
    setTtbLoading(true)

    Promise.all(
      pool.map(async (g) => {
        const ttb = await getTimeToBeat(g.id)
        const hrs = mainStoryHours(ttb) // null when IGDB has no data
        if (hrs === null) return null    // exclude — never fake a time
        return { ...g, mainStoryHours: hrs }
      })
    )
      .then((results) => {
        if (ttbCancelRef.current) return
        setGamesWithTtb(results.filter(Boolean))
      })
      .catch(() => {
        if (!ttbCancelRef.current) setGamesWithTtb([])
      })
      .finally(() => {
        if (!ttbCancelRef.current) setTtbLoading(false)
      })

    return () => {
      ttbCancelRef.current = true
    }
  }, [trending.data, newGames.data]) // re-run only when pool data changes

  // Active data for each section.
  const activeGamesState   = gamesTab   === 'popular' ? trending        : newGames
  const activeReviewsState = reviewsTab === 'popular'  ? popularReviews  : followingReviews

  // "Got an hour?" — bucket filtering (pure derivation, no extra fetch).
  const activeTtbBucket  = TTB_BUCKETS.find((b) => b.id === ttbBucket) || TTB_BUCKETS[1]
  const filteredTtbGames = useMemo(
    () => gamesWithTtb.filter((g) => inBucket(g.mainStoryHours, activeTtbBucket)),
    [gamesWithTtb, activeTtbBucket]
  )
  // Only show the section once we know there's at least one game with TTB data.
  const showGotAnHour = ttbLoading || gamesWithTtb.length > 0

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

        {/* ── Event Week — themed game set + activity leaderboard ── */}
        <section className="explore-section explore-section--event-week">
          <EventWeekBanner />
        </section>

        {/* ── Section: Swipe to discover ── */}
        <section className="explore-section explore-section--swipe-deck">
          <div className="explore-section__pad discover-section-header">
            <h2 className="discover-section-title">Swipe to discover</h2>
            <label className="blind-date-toggle" htmlFor="blind-date-switch">
              <span className="blind-date-toggle__label">Blind Date</span>
              <IOSSwitch
                id="blind-date-switch"
                checked={blindDate}
                onChange={setBlindDate}
                label="Blind Date mode — hide game titles until you swipe"
              />
            </label>
          </div>
          <MoodChips
            activeMood={activeMood}
            onSelect={setActiveMood}
            emptyMoods={emptyMoods}
          />
          <SwipeDeck
            key={activeMood ?? 'default'}
            moodId={activeMood}
            onMoodEmpty={handleMoodEmpty}
            blindDate={blindDate}
          />
        </section>

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

        {/* ── Section 2: Reviews feed (preview — 3 cards max) ── */}
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
            <ReviewRowSkeletonList count={3} />
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
            <>
              <div className="explore-review-feed">
                {reviewsData.slice(0, 3).map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={toReviewCardShape(r, likeCounts, commentCounts)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="discover-see-all-btn"
                onClick={() =>
                  navigate('/discover/reviews', {
                    state: { tab: reviewsTab },
                  })
                }
              >
                See all reviews
                <svg
                  className="discover-see-all-btn__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
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

        {/* ── Section 3: Most played — circle (follow-graph) or global fallback ── */}
        {showCircleSection && (
          <section className="explore-section explore-section--2">
            <div className="explore-section__pad discover-section-header">
              <h2 className="discover-section-title">In your circle</h2>
            </div>
            <MostPlayedRail
              data={circleDataWithLive}
              loading={circlePlayed.loading}
              error={circlePlayed.error}
              mode="circle"
            />
          </section>
        )}

        {showGlobalSection && (
          <section className="explore-section explore-section--2">
            <div className="explore-section__pad discover-section-header">
              <h2 className="discover-section-title">Most played this week</h2>
            </div>
            <MostPlayedRail
              data={mostPlayed.data}
              loading={mostPlayed.loading}
              error={mostPlayed.error}
              mode="global"
            />
          </section>
        )}

        {/* ── Section 4: Got an hour? — time-to-beat discovery rail ── */}
        {showGotAnHour && (
          <section className="explore-section explore-section--3">
            <div className="explore-section__pad discover-section-header">
              <h2 className="discover-section-title">Got an hour?</h2>
            </div>
            <TimeBucketChips activeBucket={ttbBucket} onChange={setTtbBucket} />
            <GotAnHourRail games={filteredTtbGames} loading={ttbLoading} />
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
