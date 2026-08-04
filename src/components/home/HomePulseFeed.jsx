import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { UserPlus, WifiOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import useHomeFeed from '../../hooks/useHomeFeed'
import HomeReviewCard from './HomeReviewCard'
import EmptyState from '../EmptyState'
import FindFriendsModal from '../FindFriendsModal'
import WindowedListItem from '../WindowedListItem'
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
 * Infinite scroll via an IntersectionObserver sentinel.
 *
 * Zero items is a real state, not a nothing-state: this is the lead
 * content of Home, so an empty feed keeps its header and explains itself
 * through the shared EmptyState with "Find people to follow" as the next
 * action, rather than vanishing and leaving a brand-new account with a
 * page that ends after the first-game topper. It reaches that state
 * whenever getHomeFeed's community fallback also comes back empty — an
 * early beta where nobody has logged anything yet is exactly that — and a
 * failed fetch gets its own retry copy instead of being indistinguishable
 * from a quiet community.
 *
 * Exposes `refresh` via an imperative handle so Home.jsx's pull-to-
 * refresh can force this feed's own cache-bypassing reload
 * (useHomeFeed's `refresh`) without lifting the hook itself up a level —
 * Home doesn't otherwise need this feed's items/loading/etc, only the
 * ability to trigger a refetch.
 */
const HomePulseFeed = forwardRef(function HomePulseFeed(_props, ref) {
  const { user } = useAuth()
  const { items, loading, loadingMore, hasMore, scope, error, loadMore, refresh } = useHomeFeed({ pageSize: 15 })
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)
  const sentinelRef = useRef(null)

  useImperativeHandle(ref, () => ({ refresh }), [refresh])

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

  const isEmpty = !loading && items.length === 0

  return (
    <>
      <section className="pulse-feed" aria-label="The pulse">
        <div className="pulse-feed__head">
          <h2 className="pulse-feed__title">The pulse</h2>
          {/* Held back until the fetch resolves the scope: the initial
              value is 'following', which would tell a viewer with no
              follows their circle is up to something. */}
          {!loading && !isEmpty && (
            <p className="pulse-feed__subline">
              {SUBLINE_BY_SCOPE[scope] || SUBLINE_BY_SCOPE.following}
            </p>
          )}
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : isEmpty ? (
          error ? (
            <EmptyState
              icon={WifiOff}
              size="compact"
              title="Couldn't load the pulse."
              body="Check your connection and try again."
              cta="Try again"
              ctaVariant="secondary"
              onCta={refresh}
            />
          ) : (
            <EmptyState
              icon={UserPlus}
              size="compact"
              title="Nothing on the pulse yet."
              body="Follow a few players and what they rate, review and finish shows up right here."
              cta="Find people to follow"
              onCta={() => setFindFriendsOpen(true)}
            />
          )
        ) : (
          <>
            <div className="pulse-feed__list">
              {items.map((item) => (
                <WindowedListItem key={item.id}>
                  <HomeReviewCard item={item} />
                </WindowedListItem>
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
})

export default HomePulseFeed
