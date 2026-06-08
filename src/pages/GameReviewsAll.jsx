import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReviewCard from '../components/ReviewCard'
import { getGameById } from '../services/igdb'
import { getReviewsForGamePaginated } from '../services/reviewService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import './GameReviewsAll.css'

const PAGE_SIZE = 20

// ── Shape adapter (same logic as GameDetail) ────────────────────────────────
function toReviewCardShape(row, game, likeCounts, commentCounts) {
  return {
    id: row.id,
    userId: row.user_id,
    game: {
      id: String(row.igdb_game_id || game?.id || ''),
      name: row.game_title || game?.title || 'Unknown Game',
      coverUrl: row.game_image || game?.image || '',
      developer: game?.developers?.[0] || '',
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
    likeCount: likeCounts?.get(row.id) || 0,
    commentCount: commentCounts?.get(row.id) || 0,
    createdAt: row.created_at,
  }
}

// ── Skeleton card (3-card placeholder while the first page loads) ────────────
function SkeletonCard() {
  return (
    <div className="gra-skeleton-card" aria-hidden="true">
      <div className="gra-sk-cover skeleton" />
      <div className="gra-sk-body">
        <div className="gra-sk-line skeleton" style={{ width: '60%' }} />
        <div className="gra-sk-line skeleton" style={{ width: '40%' }} />
        <div className="gra-sk-line skeleton" style={{ width: '80%' }} />
      </div>
    </div>
  )
}

export default function GameReviewsAll() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [game, setGame] = useState(null)
  const [reviews, setReviews] = useState([])
  // Sprint 6 P0 — like count per visible review id. Grows as more
  // pages are loaded via the infinite-scroll sentinel.
  const [reviewLikeCounts, setReviewLikeCounts] = useState(() => new Map())
  // Sprint 6 P1 — comment counts per visible review id. Grows with the
  // accumulated reviews list as the user scrolls.
  const [reviewCommentCounts, setReviewCommentCounts] = useState(() => new Map())
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)

  const sentinelRef = useRef(null)
  const kebabRef = useRef(null)
  const isFetchingRef = useRef(false)

  // ── Fetch game metadata ────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return
    getGameById(gameId)
      .then(setGame)
      .catch(() => {})
  }, [gameId])

  // ── Fetch a page of reviews ────────────────────────────────────────────
  const fetchPage = useCallback(
    async (pageNum) => {
      if (isFetchingRef.current) return
      isFetchingRef.current = true

      try {
        const { items, hasMore: more } = await getReviewsForGamePaginated({
          gameId,
          page: pageNum,
          limit: PAGE_SIZE,
        })
        setReviews((prev) =>
          pageNum === 1 ? items : [...prev, ...items]
        )
        setHasMore(more)
        setPage(pageNum)
        // Pull real like + comment counts for this page only and merge
        // into the accumulated Maps. Cheaper than re-fetching the whole
        // list, and prefetchLikeStatesForReviews also seeds the user's
        // liked-set into the shared useLikeState cache.
        try {
          const ids = items.map((r) => r.id)
          const [pageCounts, pageCommentCounts] = await Promise.all([
            prefetchLikeStatesForReviews(ids),
            getCommentCountsForReviews(ids),
          ])
          setReviewLikeCounts((prev) => {
            if (pageNum === 1) return pageCounts
            const next = new Map(prev)
            for (const [id, c] of pageCounts) next.set(id, c)
            return next
          })
          setReviewCommentCounts((prev) => {
            if (pageNum === 1) return pageCommentCounts
            const next = new Map(prev)
            for (const [id, c] of pageCommentCounts) next.set(id, c)
            return next
          })
        } catch (err) {
          console.error('[GameReviewsAll] like/comment count prefetch failed:', err)
        }
      } catch (err) {
        console.error('[GameReviewsAll] fetchPage failed:', err)
      } finally {
        isFetchingRef.current = false
        setLoadingInitial(false)
        setLoadingMore(false)
      }
    },
    [gameId]
  )

  // Initial load
  useEffect(() => {
    setLoadingInitial(true)
    fetchPage(1)
  }, [fetchPage])

  // ── IntersectionObserver sentinel for infinite scroll ──────────────────
  // rootMargin '400px' means we start loading 400 px before the sentinel
  // enters the viewport — gives enough runway that the next page is ready
  // before the user reaches the end.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !isFetchingRef.current
        ) {
          setLoadingMore(true)
          fetchPage(page + 1)
        }
      },
      { rootMargin: '400px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, page, fetchPage])

  // ── Kebab outside-click close ──────────────────────────────────────────
  useEffect(() => {
    if (!kebabOpen) return
    function handleOutside(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [kebabOpen])

  // ── Open the single review composer (keyboard-aware ReviewNew popup) ───
  // Pass the loaded game in route state so it renders without a refetch.
  const openReviewComposer = useCallback(() => {
    navigate(`/review/new?gameId=${gameId}`, { state: { game } })
  }, [navigate, gameId, game])

  // After the composer posts and navigates back, reload from page 1 so the
  // new review shows up. ReviewNew dispatches `reviewAdded`.
  useEffect(() => {
    const handleReviewAdded = () => {
      setLoadingInitial(true)
      fetchPage(1)
    }
    window.addEventListener('reviewAdded', handleReviewAdded)
    return () => window.removeEventListener('reviewAdded', handleReviewAdded)
  }, [fetchPage])

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="gra-page margins-style">

      {/* ── Page header ── */}
      <div className="gra-header">
        <button
          className="gra-header-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <h1 className="gra-header-title">
          {game?.title || 'Reviews'}
        </h1>

        <div className="gra-header-kebab" ref={kebabRef}>
          <button
            className="gra-header-btn"
            onClick={() => setKebabOpen((v) => !v)}
            aria-label="More options"
            aria-expanded={kebabOpen}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1" fill="currentColor" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="12" cy="19" r="1" fill="currentColor" />
            </svg>
          </button>
          {kebabOpen && (
            <div className="gra-kebab-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setKebabOpen(false)
                  openReviewComposer()
                }}
              >
                Write a review
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Review list ── */}
      <div className="gra-list">
        {loadingInitial ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : reviews.length === 0 ? (
          <div className="gra-empty">
            <p className="gra-empty-text">No reviews yet.</p>
            <button
              className="gra-empty-cta"
              onClick={openReviewComposer}
            >
              Be the first to review
            </button>
          </div>
        ) : (
          reviews.map((row) => {
            const shaped = toReviewCardShape(
              row,
              game,
              reviewLikeCounts,
              reviewCommentCounts
            )
            const own = row.user_id === user?.id
            return (
              <ReviewCard
                key={row.id}
                review={shaped}
                variant="default"
                showOwnPill={own}
                isOwn={own}
                onEdit={openReviewComposer}
              />
            )
          })
        )}

        {/* Loading-more skeleton — 3 cards */}
        {loadingMore && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* Sentinel: IntersectionObserver watches this div */}
        {!loadingInitial && hasMore && (
          <div ref={sentinelRef} className="gra-sentinel" aria-hidden="true" />
        )}
      </div>

    </div>
  )
}
