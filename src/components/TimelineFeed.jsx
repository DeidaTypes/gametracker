import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Users } from 'lucide-react'
import ReviewCard from './ReviewCard'
import EmptyState from './EmptyState'
import { getReviewsForTimeline, getReviewsFromFollowing } from '../services/reviewService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { getFollowingCount } from '../services/followService'
import { useAuth } from '../contexts/AuthContext'
import './TimelineFeed.css'

const PAGE_SIZE = 10
// Fetch a single window of recent reviews up-front, batch-fetch their
// like counts in one query, sort by COUNT DESC, and paginate the
// in-memory result client-side. Sprint 6 P0 wired the real likes
// table so this is finally a true "popular reviews" sort.
const FETCH_WINDOW_LIMIT = 200
const SINCE_DAYS = 14

/**
 * Map a raw Supabase review row (joined with users) into the canonical
 * ReviewCard prop shape. Mirrors the adapter used in GameDetail.jsx and
 * GameReviewsAll.jsx — kept inline (rather than extracted) to avoid
 * touching those files in Sprint 5; will consolidate in Sprint 6.
 */
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

function SkeletonReviewCard() {
  return (
    <div className="tf-skeleton-card" aria-hidden="true">
      <div className="tf-sk-cover-row">
        <div className="skeleton tf-sk-thumb" />
        <div className="tf-sk-cover-meta">
          <div className="skeleton tf-sk-line" style={{ width: '60%' }} />
          <div className="skeleton tf-sk-line" style={{ width: '40%' }} />
        </div>
      </div>
      <div className="skeleton tf-sk-line" style={{ width: '90%' }} />
      <div className="skeleton tf-sk-line" style={{ width: '80%' }} />
      <div className="skeleton tf-sk-line" style={{ width: '70%' }} />
    </div>
  )
}

/**
 * Sprint 5 P5 — Home → Timeline feed.
 *
 * Two tabs (Popular default / Friends) with the same look as the
 * Popular/New section above. Refresh icon on the right of the tab row
 * re-fetches the active tab.
 *
 * Popular tab:
 *   - Fetches up to FETCH_WINDOW_LIMIT recent reviews from the last
 *     SINCE_DAYS days, sorts by localStorage like-count desc, then
 *     paginates 10 per page with an IntersectionObserver sentinel
 *     (rootMargin '400px').
 *   - Skeleton: 3 cards while the first window is loading.
 *
 * Friends tab (Sprint 5 P7):
 *   - Lazy-loaded on first tab switch. Calls getFollowingCount to branch:
 *       0 follows  → "Follow people" empty state with Find people CTA.
 *       >0 follows → true server-side paginated feed via
 *                    getReviewsFromFollowing, 10 per page, newest first.
 *       follows but no reviews → distinct fallback empty state.
 *   - IntersectionObserver sentinel mirrors the Popular tab pattern.
 *   - Refresh button re-fetches the active tab (works for Friends too).
 *
 * Friends tab state machine:
 *   'idle'      — not yet loaded (initial)
 *   'loading'   — first-page fetch in flight (shows skeleton)
 *   'no-follows'— user has zero follows (show Find people CTA)
 *   'no-reviews'— user has follows but they have written no reviews
 *   'loaded'    — at least one review row rendered
 */
function TimelineFeed({ refreshKey = 0 }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tab, setTab] = useState('popular')

  // ── Popular tab state ──────────────────────────────────────────────
  // allRows: null = not loaded yet
  // likeCounts: Map<reviewId, count> seeded once per fetch; the same
  // Map is threaded into toReviewCardShape so every visible card
  // reads the same number that drove the sort.
  const [allRows, setAllRows] = useState(null)
  const [likeCounts, setLikeCounts] = useState(() => new Map())
  // Sprint 6 P1 — real comment counts per visible review id, fetched in
  // one batched query after the timeline rows load. Threaded into
  // toReviewCardShape so every card's comment-icon badge matches the
  // actual row count in the comments table.
  const [commentCounts, setCommentCounts] = useState(() => new Map())
  const [page, setPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)

  const sentinelRef = useRef(null)
  const isFetchingRef = useRef(false)

  // ── Friends tab state ──────────────────────────────────────────────
  const [friendsStatus, setFriendsStatus] = useState('idle')
  const [friendsRows, setFriendsRows] = useState([])
  const [friendsPage, setFriendsPage] = useState(1)
  const [friendsHasMore, setFriendsHasMore] = useState(false)
  const [friendsLikeCounts, setFriendsLikeCounts] = useState(() => new Map())
  const [friendsCommentCounts, setFriendsCommentCounts] = useState(() => new Map())

  const friendsSentinelRef = useRef(null)
  const friendsFetchingRef = useRef(false)

  const loadPopular = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    try {
      const rows = await getReviewsForTimeline({
        sinceDays: SINCE_DAYS,
        limit: FETCH_WINDOW_LIMIT,
      })
      // Sprint 6 P0: batch-fetch real like counts in ONE round-trip
      // and use them both for sort and for each card's displayed
      // count. prefetchLikeStatesForReviews ALSO seeds the in-process
      // useLikeState cache with the signed-in user's liked-set so
      // hearts render filled-in without per-card round-trips.
      const ids = rows.map((r) => r.id)
      const [counts, cCounts] = await Promise.all([
        prefetchLikeStatesForReviews(ids),
        getCommentCountsForReviews(ids),
      ])
      // Sort by likeCount desc, then by created_at desc as the
      // tiebreaker so equal-likes fall back to recency rather than
      // arbitrary order.
      const sorted = [...rows].sort((a, b) => {
        const lc = (counts.get(b.id) || 0) - (counts.get(a.id) || 0)
        if (lc !== 0) return lc
        const ta = new Date(a.created_at).getTime() || 0
        const tb = new Date(b.created_at).getTime() || 0
        return tb - ta
      })
      setLikeCounts(counts)
      setCommentCounts(cCounts)
      setAllRows(sorted)
      setPage(1)
    } catch (err) {
      console.error('[TimelineFeed] loadPopular failed:', err)
      setAllRows([])
    } finally {
      isFetchingRef.current = false
    }
  }, [])

  // Initial load — Popular is the default tab so we fetch on mount.
  useEffect(() => {
    loadPopular()
  }, [loadPopular])

  // Tracks the last refreshKey we acted on. Declared here (next to the
  // Popular state) but the refresh effect itself lives further down,
  // AFTER loadFriends is declared — otherwise referencing loadFriends in
  // the effect's dependency array hits the const temporal dead zone and
  // throws on render, taking the whole Home page down with it.
  const prevRefreshKeyRef = useRef(refreshKey)

  const visibleRows = allRows ? allRows.slice(0, page * PAGE_SIZE) : []
  const hasMore = allRows ? visibleRows.length < allRows.length : false
  const initialLoading = allRows === null

  // ── IntersectionObserver sentinel — Popular tab ────────────────────
  useEffect(() => {
    if (tab !== 'popular') return undefined
    const node = sentinelRef.current
    if (!node || !hasMore) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setPage((p) => p + 1)
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [tab, hasMore, visibleRows.length])

  // ── Friends: fetch a single server-side page ───────────────────────
  // append=false resets the list (initial load / refresh).
  // append=true accumulates (infinite scroll).
  const loadFriendsPage = useCallback(async (pageNum, append) => {
    if (friendsFetchingRef.current) return
    friendsFetchingRef.current = true
    try {
      const { items, hasMore: more } = await getReviewsFromFollowing({
        page: pageNum,
        limit: PAGE_SIZE,
      })
      const ids = items.map((r) => r.id)
      const [counts, cCounts] =
        ids.length > 0
          ? await Promise.all([
              prefetchLikeStatesForReviews(ids),
              getCommentCountsForReviews(ids),
            ])
          : [new Map(), new Map()]

      setFriendsHasMore(more)
      setFriendsPage(pageNum)

      if (append) {
        setFriendsRows((prev) => [...prev, ...items])
        setFriendsLikeCounts((prev) => new Map([...prev, ...counts]))
        setFriendsCommentCounts((prev) => new Map([...prev, ...cCounts]))
        // Status stays 'loaded' while appending — we already have rows.
      } else {
        setFriendsRows(items)
        setFriendsLikeCounts(counts)
        setFriendsCommentCounts(cCounts)
        setFriendsStatus(items.length === 0 ? 'no-reviews' : 'loaded')
      }
    } catch (err) {
      console.error('[TimelineFeed] loadFriendsPage failed:', err)
      if (!append) setFriendsStatus('no-reviews')
    } finally {
      friendsFetchingRef.current = false
    }
  }, [])

  // Orchestrates the Friends tab initial load / refresh:
  // checks follow count first to pick the right empty state.
  const loadFriends = useCallback(async () => {
    if (!user) return
    setFriendsStatus('loading')
    setFriendsRows([])
    setFriendsPage(1)
    setFriendsHasMore(false)
    try {
      const count = await getFollowingCount(user.id)
      if (count === 0) {
        setFriendsStatus('no-follows')
        return
      }
      await loadFriendsPage(1, false)
    } catch (err) {
      console.error('[TimelineFeed] loadFriends failed:', err)
      setFriendsStatus('no-reviews')
    }
  }, [user, loadFriendsPage])

  // Lazy-load Friends on first switch to that tab.
  useEffect(() => {
    if (tab === 'friends' && friendsStatus === 'idle') {
      loadFriends()
    }
  }, [tab, friendsStatus, loadFriends])

  // When the parent Home page triggers a pull-to-refresh (refreshKey
  // increments), re-fetch whichever tab is active and reset the idle
  // Friends tab so it re-loads next time the user switches to it.
  // NOTE: must stay below loadFriends/loadPopular so the dependency
  // array doesn't reference them before they're initialized.
  useEffect(() => {
    if (refreshKey === prevRefreshKeyRef.current) return
    prevRefreshKeyRef.current = refreshKey
    if (tab === 'popular') {
      setAllRows(null)
      loadPopular()
    } else {
      loadFriends()
    }
    // Reset Friends so it reloads if user switches to it post-refresh.
    if (tab !== 'friends') {
      setFriendsStatus('idle')
      setFriendsRows([])
    }
  }, [refreshKey, tab, loadPopular, loadFriends])

  // ── IntersectionObserver sentinel — Friends tab ────────────────────
  useEffect(() => {
    if (tab !== 'friends') return undefined
    const node = friendsSentinelRef.current
    if (!node || !friendsHasMore) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          friendsHasMore &&
          !friendsFetchingRef.current
        ) {
          loadFriendsPage(friendsPage + 1, true)
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [tab, friendsHasMore, friendsPage, loadFriendsPage])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (tab === 'popular') {
        setAllRows(null)
        await loadPopular()
      } else {
        await loadFriends()
      }
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section
      className="tf-section"
      aria-labelledby="tf-section-heading"
    >
      <h2 id="tf-section-heading" className="sr-only">
        Reviews timeline
      </h2>

      <div className="tf-tab-row">
        <div className="tf-tabs" role="tablist" aria-label="Timeline tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'popular'}
            className={`tf-tab${tab === 'popular' ? ' tf-tab--active' : ''}`}
            onClick={() => setTab('popular')}
          >
            Popular
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'friends'}
            className={`tf-tab${tab === 'friends' ? ' tf-tab--active' : ''}`}
            onClick={() => setTab('friends')}
          >
            Following
          </button>
        </div>

        <button
          type="button"
          className={`tf-refresh-btn${refreshing ? ' tf-refresh-btn--spinning' : ''}`}
          onClick={handleRefresh}
          aria-label="Refresh timeline"
          disabled={refreshing}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>

      {tab === 'popular' ? (
        <div className="tf-list">
          {initialLoading ? (
            <>
              <SkeletonReviewCard />
              <SkeletonReviewCard />
              <SkeletonReviewCard />
            </>
          ) : visibleRows.length === 0 ? (
            <div className="tf-empty">
              <p className="tf-empty-text">
                No reviews yet — be the first to write one.
              </p>
            </div>
          ) : (
            <>
              {visibleRows.map((row) => (
                <ReviewCard
                  key={row.id}
                  review={toReviewCardShape(row, likeCounts, commentCounts)}
                  variant="default"
                />
              ))}
              {hasMore && (
                <div ref={sentinelRef} className="tf-sentinel" aria-hidden="true" />
              )}
            </>
          )}
        </div>
      ) : (
        <div className="tf-list">
          {friendsStatus === 'idle' || friendsStatus === 'loading' ? (
            <>
              <SkeletonReviewCard />
              <SkeletonReviewCard />
              <SkeletonReviewCard />
            </>
          ) : friendsStatus === 'no-follows' ? (
            <EmptyState
              icon={Users}
              title="It's quiet in here."
              body="Follow people to see their reviews, lists, and what they're playing."
              cta="Find people to follow"
              onCta={() => navigate('/search')}
            />
          ) : friendsStatus === 'no-reviews' ? (
            <EmptyState
              icon={Users}
              title="Nothing from following yet."
              body="The people you follow haven't reviewed anything yet. Check back later."
            />
          ) : (
            <>
              {friendsRows.map((row) => (
                <ReviewCard
                  key={row.id}
                  review={toReviewCardShape(row, friendsLikeCounts, friendsCommentCounts)}
                  variant="default"
                />
              ))}
              {friendsHasMore && (
                <div ref={friendsSentinelRef} className="tf-sentinel" aria-hidden="true" />
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default TimelineFeed
