import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import useHomeFeed from '../../hooks/useHomeFeed'
import HomeReviewCard from './HomeReviewCard'
import FindFriendsModal from '../FindFriendsModal'
import './HomeFreshReviews.css'

const SUBLINE_BY_SCOPE = {
  following: 'From people you follow',
  mixed: 'From people you follow, plus the community',
  community: 'From the community',
}

function FeedSkeleton() {
  return (
    <div className="fresh-reviews__skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="fresh-reviews__skeleton-card">
          <div className="skeleton fresh-reviews__skeleton-avatar" />
          <div className="fresh-reviews__skeleton-lines">
            <div className="skeleton fresh-reviews__skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton fresh-reviews__skeleton-line" style={{ width: '90%' }} />
            <div className="skeleton fresh-reviews__skeleton-line" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * HomeFreshReviews — "Fresh reviews" section, lead content of the Home
 * feed-first spine (v3).
 *
 * Thin presentational wrapper around useHomeFeed + HomeReviewCard (both
 * out of scope to modify here — see communityService.getHomeFeed for the
 * following/community/mixed scope decision, which already defaults new
 * users with no follows to broad community reviews).
 *
 * Infinite scroll via an IntersectionObserver sentinel; hides entirely
 * (no header, no empty-state copy) once loaded with zero items, per the
 * hide-empty rule — never a fabricated placeholder.
 */
export default function HomeFreshReviews() {
  const { user } = useAuth()
  const { items, loading, loadingMore, hasMore, scope, loadMore } = useHomeFeed({ pageSize: 15 })
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore || loading) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadMore, items.length])

  if (!user) return null
  if (!loading && items.length === 0) return null

  return (
    <>
      <section className="fresh-reviews" aria-label="Fresh reviews">
        <div className="fresh-reviews__head">
          <h2 className="fresh-reviews__title">Fresh reviews</h2>
          <p className="fresh-reviews__subline">
            {SUBLINE_BY_SCOPE[scope] || SUBLINE_BY_SCOPE.following}
          </p>
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : (
          <>
            <div className="fresh-reviews__list">
              {items.map((item) => (
                <HomeReviewCard key={item.id} item={item} />
              ))}
            </div>

            {scope !== 'following' && (
              <button
                type="button"
                className="fresh-reviews__find-nudge"
                onClick={() => setFindFriendsOpen(true)}
              >
                Find people to follow
              </button>
            )}

            {hasMore && (
              <div ref={sentinelRef} className="fresh-reviews__sentinel" aria-hidden="true">
                {loadingMore && <span className="fresh-reviews__loading-more">Loading…</span>}
              </div>
            )}
          </>
        )}
      </section>

      <FindFriendsModal
        isOpen={findFriendsOpen}
        onClose={() => setFindFriendsOpen(false)}
        currentUserId={user?.id ?? null}
      />
    </>
  )
}
