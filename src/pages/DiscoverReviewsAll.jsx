import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import ReviewCard from '../components/ReviewCard'
import {
  getPopularReviews,
  getReviewsFromFollowing,
} from '../services/reviewService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { getLikeCountsForReviews } from '../services/likeService'
import './DiscoverReviewsAll.css'

// ─── Constants ──────────────────────────────────────────────────────────────

const REVIEWS_TABS = [
  { value: 'popular',   label: 'Popular' },
  { value: 'following', label: 'Following' },
]

const POPULAR_LIMIT  = 50
const FOLLOWING_PAGE_SIZE = 20

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map a raw Supabase review row → shape ReviewCard expects. */
function toReviewCardShape(row, likeCounts, commentCounts) {
  return {
    id:     row.id,
    userId: row.user_id,
    game: {
      id:       String(row.igdb_game_id || ''),
      name:     row.game_title || 'Unknown Game',
      coverUrl: row.game_image || '',
      developer: '',
    },
    author: {
      username:    row.users?.username    || null,
      displayName: row.users?.display_name || 'Anonymous',
      userId:      row.user_id,
      avatarUrl:   row.users?.avatar_url  || '',
    },
    title:        null,
    body:         row.body || '',
    rating:       Number(row.rating)       || 0,
    hoursPlayed:  Number(row.hours_played) || 0,
    likeCount:    likeCounts?.get(row.id)    || 0,
    commentCount: commentCounts?.get(row.id) || 0,
    createdAt:    row.created_at,
  }
}

/**
 * "Word / Word" slash toggle — mirrors the one in Explore.jsx.
 * Kept local to avoid a shared module dependency; identical in behaviour.
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

function SkeletonCard() {
  return (
    <div className="dra-skeleton-card" aria-hidden="true">
      <div className="dra-sk-cover skeleton" />
      <div className="dra-sk-body">
        <div className="dra-sk-line skeleton" style={{ width: '55%' }} />
        <div className="dra-sk-line skeleton" style={{ width: '35%' }} />
        <div className="dra-sk-line skeleton" style={{ width: '75%' }} />
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DiscoverReviewsAll() {
  const navigate  = useNavigate()
  const location  = useLocation()

  // Inherit the tab that was active on Discover when the user tapped "See all".
  const initialTab = location.state?.tab === 'following' ? 'following' : 'popular'
  const [tab, setTab] = useState(initialTab)

  // ── Popular feed (one-shot ranked list) ──────────────────────────────────
  const [popularReviews,   setPopularReviews]   = useState([])
  const [popularLoading,   setPopularLoading]   = useState(false)
  const [popularLoaded,    setPopularLoaded]    = useState(false)
  const [popularError,     setPopularError]     = useState(false)

  // ── Following feed (paginated) ───────────────────────────────────────────
  const [followReviews,    setFollowReviews]    = useState([])
  const [followPage,       setFollowPage]       = useState(1)
  const [followHasMore,    setFollowHasMore]    = useState(true)
  const [followInitial,    setFollowInitial]    = useState(false)
  const [followLoadingMore,setFollowLoadingMore]= useState(false)
  const [followLoaded,     setFollowLoaded]     = useState(false)
  const [followEmpty,      setFollowEmpty]      = useState(false)

  // ── Shared like + comment counts (both feeds merged) ─────────────────────
  const [likeCounts,    setLikeCounts]    = useState(() => new Map())
  const [commentCounts, setCommentCounts] = useState(() => new Map())

  const sentinelRef    = useRef(null)
  const isFetchingRef  = useRef(false)

  // ── Fetch popular reviews (once) ─────────────────────────────────────────
  useEffect(() => {
    if (popularLoaded || popularLoading) return
    setPopularLoading(true)
    setPopularError(false)
    getPopularReviews({ days: 30, limit: POPULAR_LIMIT })
      .then((rows) => {
        setPopularReviews(rows || [])
        setPopularLoaded(true)
        const ids = (rows || []).map((r) => r.id)
        if (ids.length === 0) return
        return Promise.all([
          prefetchLikeStatesForReviews(ids),
          getCommentCountsForReviews(ids),
          getLikeCountsForReviews(ids),
        ]).then(([, cCounts, lCounts]) => {
          setCommentCounts((prev) => {
            const next = new Map(prev)
            for (const [id, c] of cCounts) next.set(id, c)
            return next
          })
          setLikeCounts((prev) => {
            const next = new Map(prev)
            for (const [id, c] of lCounts) next.set(id, c)
            return next
          })
        })
      })
      .catch(() => {
        setPopularError(true)
        setPopularLoaded(true)
      })
      .finally(() => setPopularLoading(false))
  }, [popularLoaded, popularLoading])

  // ── Fetch a page of following reviews ────────────────────────────────────
  const fetchFollowPage = useCallback(async (pageNum) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true

    try {
      const { items, hasMore } = await getReviewsFromFollowing({
        page:  pageNum,
        limit: FOLLOWING_PAGE_SIZE,
      })
      setFollowReviews((prev) => (pageNum === 1 ? items : [...prev, ...items]))
      setFollowHasMore(hasMore)
      setFollowPage(pageNum)
      if (pageNum === 1 && (!items || items.length === 0)) {
        setFollowEmpty(true)
      }

      const ids = (items || []).map((r) => r.id)
      if (ids.length > 0) {
        const [, cCounts, lCounts] = await Promise.all([
          prefetchLikeStatesForReviews(ids),
          getCommentCountsForReviews(ids),
          getLikeCountsForReviews(ids),
        ])
        setCommentCounts((prev) => {
          const next = new Map(prev)
          for (const [id, c] of cCounts) next.set(id, c)
          return next
        })
        setLikeCounts((prev) => {
          const next = new Map(prev)
          for (const [id, c] of lCounts) next.set(id, c)
          return next
        })
      }
    } catch {
      // silent — already showed data if partial
    } finally {
      isFetchingRef.current = false
      setFollowInitial(false)
      setFollowLoadingMore(false)
      setFollowLoaded(true)
    }
  }, [])

  // Initial following load (deferred until that tab is first visited)
  useEffect(() => {
    if (tab !== 'following' || followLoaded || followInitial) return
    setFollowInitial(true)
    fetchFollowPage(1)
  }, [tab, followLoaded, followInitial, fetchFollowPage])

  // ── IntersectionObserver for following infinite scroll ───────────────────
  useEffect(() => {
    if (tab !== 'following') return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          followHasMore &&
          !isFetchingRef.current
        ) {
          setFollowLoadingMore(true)
          fetchFollowPage(followPage + 1)
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [tab, followHasMore, followPage, fetchFollowPage])

  // ── Render ────────────────────────────────────────────────────────────────

  const isPopularTab  = tab === 'popular'
  const isFollowTab   = tab === 'following'

  const popularReady  = popularLoaded && !popularLoading
  const followReady   = followLoaded  && !followInitial

  return (
    <div className="dra-page">

      {/* ── Sticky header ── */}
      <div className="dra-header">
        <button
          className="dra-header-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <h1 className="dra-header-title">Reviews</h1>

        {/* Right-side spacer keeps the title centred */}
        <div className="dra-header-spacer" aria-hidden="true" />
      </div>

      {/* ── Toggle below header ── */}
      <div className="dra-toggle-row">
        <SlashToggle
          options={REVIEWS_TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      {/* ── Review list ── */}
      <div className="dra-list">

        {/* ── Popular tab ── */}
        {isPopularTab && (
          popularLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : popularError ? (
            <p className="dra-empty-text">Could not load reviews.</p>
          ) : popularReady && popularReviews.length === 0 ? (
            <p className="dra-empty-text">No popular reviews yet — check back later.</p>
          ) : (
            popularReviews.map((r) => (
              <ReviewCard
                key={r.id}
                review={toReviewCardShape(r, likeCounts, commentCounts)}
              />
            ))
          )
        )}

        {/* ── Following tab ── */}
        {isFollowTab && (
          followInitial ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : followEmpty ? (
            <p className="dra-empty-text">Follow people to see their reviews here.</p>
          ) : followReady && followReviews.length === 0 ? (
            <p className="dra-empty-text">No reviews yet — be the first to write one.</p>
          ) : (
            <>
              {followReviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={toReviewCardShape(r, likeCounts, commentCounts)}
                />
              ))}

              {/* Loading-more skeleton */}
              {followLoadingMore && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}

              {/* Infinite-scroll sentinel */}
              {!followInitial && followHasMore && (
                <div ref={sentinelRef} className="dra-sentinel" aria-hidden="true" />
              )}
            </>
          )
        )}

      </div>
    </div>
  )
}
