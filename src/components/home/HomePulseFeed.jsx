import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import useHomeFeed from '../../hooks/useHomeFeed'
import HomeReviewCard from './HomeReviewCard'
import FindFriendsModal from '../FindFriendsModal'
import './HomePulseFeed.css'

// Home is the hub — the stream always includes the viewer's own activity
// alongside whichever scope communityService.getHomeFeed decided on, so
// the subline stays honest about that ("your circle" folds the viewer's
// own activity in too) rather than implying this is only other people's
// activity.
const SUBLINE_BY_SCOPE = {
  following: 'What your circle is up to',
  mixed: 'What your circle — and the community — is up to',
  community: 'What the community is up to',
}

function FeedSkeleton() {
  return (
    <div className="pulse-feed__skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="pulse-feed__skeleton-card">
          <div className="skeleton pulse-feed__skeleton-avatar" />
          <div className="pulse-feed__skeleton-lines">
            <div className="skeleton pulse-feed__skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton pulse-feed__skeleton-line" style={{ width: '90%' }} />
            <div className="skeleton pulse-feed__skeleton-line" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * HomePulseFeed — "The pulse" section, lead content of the Home
 * feed-first spine (v3), formerly "Fresh reviews".
 *
 * Thin presentational wrapper around useHomeFeed + HomeReviewCard (both
 * out of scope to modify here — see communityService.getHomeFeed for the
 * following/community/mixed scope decision, which already defaults new
 * users with no follows to broad community activity, and for the unified
 * event-type broadening: reviewed/rated (reviews table) plus started/
 * finished/listed/played activity_events rows, all rendered through the
 * same HomeReviewCard shell regardless of type).
 *
 * Infinite scroll via an IntersectionObserver sentinel; hides entirely
 * (no header, no empty-state copy) once loaded with zero items, per the
 * hide-empty rule — never a fabricated placeholder. In practice this only
 * fires for a signed-out viewer or a total fetch failure: getHomeFeed's
 * own community fallback means a real feed is populated even for a
 * brand-new user with no follows and no activity of their own.
 */
export default function HomePulseFeed() {
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
      <section className="pulse-feed" aria-label="The pulse">
        <div className="pulse-feed__head">
          <h2 className="pulse-feed__title">The pulse</h2>
          <p className="pulse-feed__subline">
            {SUBLINE_BY_SCOPE[scope] || SUBLINE_BY_SCOPE.following}
          </p>
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : (
          <>
            <div className="pulse-feed__list">
              {items.map((item) => (
                <HomeReviewCard key={item.id} item={item} />
              ))}
            </div>

            {scope !== 'following' && (
              <button
                type="button"
                className="pulse-feed__find-nudge"
                onClick={() => setFindFriendsOpen(true)}
              >
                Find people to follow
              </button>
            )}

            {hasMore && (
              <div ref={sentinelRef} className="pulse-feed__sentinel" aria-hidden="true">
                {loadingMore && <span className="pulse-feed__loading-more">Loading…</span>}
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
