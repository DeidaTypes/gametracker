import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { UserPlus, WifiOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import useHomeFeed, { isQaPulseItem } from '../../hooks/useHomeFeed'
import { coverLoadingProps } from '../../services/imageUtils'
import HomeReviewCard from './HomeReviewCard'
import FeedRow, { FeedGroupRow, QaFeedRow } from './FeedRow'
import EmptyState from '../EmptyState'
import FindFriendsModal from '../FindFriendsModal'
import WindowedListItem from '../WindowedListItem'
import { groupPulseFeedItems } from '../../services/communityService'
import { coarseRelativeBucket } from '../../utils/formatActivityDate'
import { Arrive } from '../motion/ContentSwap'
import './HomePulseFeed.css'

// V4-01 — read once per mount, before this same mount's own unmount/
// background handler below overwrites it. This is intentionally the
// *previous* visit's checkpoint, not "now" — it's the baseline the
// subline's "{n} new since ___" count and bucket are computed against.
const LAST_SEEN_KEY = 'pulse:lastSeenAt'

function readLastSeenAt() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY)
  } catch {
    return null
  }
}

function writeLastSeenAt() {
  try {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString())
  } catch {
    // Soft-fail — worst case the subline falls back to a scope-based
    // message next visit instead of a real count.
  }
}

/**
 * Real-data-only subline under "The pulse" (task 5): a genuine new-
 * activity count bucketed against the last time this device saw Home,
 * else the honest reason there's nothing to count (community fallback
 * because follows are quiet), else the plain default. Never a
 * fabricated/sample string.
 */
function computeSubline({ items, scope, lastSeenAt }) {
  if (lastSeenAt) {
    const newCount = items.filter(
      (it) => !it.isOwn && new Date(it.createdAt) > new Date(lastSeenAt)
    ).length
    if (newCount > 0) {
      const bucket = coarseRelativeBucket(lastSeenAt)
      return `${newCount} new from your circle${bucket ? ` since ${bucket}` : ''}`
    }
  }
  if (scope !== 'following') return 'From the community while your circle is quiet'
  return 'What your circle is up to'
}

/**
 * FeedSkeleton — three FULL cards at HomeReviewCard's own metrics:
 * shell padding, 48px poster, title + second line, byline, action row.
 * Same classes as the real card so the feed doesn't grow when items land.
 */
function FeedSkeleton() {
  return (
    <div className="pulse-feed__skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="review-card-shell home-review-card pulse-feed__skeleton-card pulse-feed__item pulse-feed__item--full"
        >
          <div className="home-review-card__game">
            <div className="skeleton pulse-feed__skeleton-cover" />
            <div className="home-review-card__game-meta">
              <span className="skeleton pulse-feed__skeleton-line" />
              <span className="skeleton pulse-feed__skeleton-line pulse-feed__skeleton-line--short" />
            </div>
          </div>
          <div className="home-review-card__footer">
            <span className="skeleton pulse-feed__skeleton-byline" />
          </div>
          <div className="home-review-card__actions">
            <span className="skeleton pulse-feed__skeleton-pill" />
            <span className="skeleton pulse-feed__skeleton-pill" />
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
 * Thin presentational wrapper around useHomeFeed. See
 * communityService.getHomeFeed for the following/community/mixed scope
 * decision.
 *
 * V4-01 density pass: every fetched item is classified as opinion-
 * bearing (a rating and/or text) or not — see
 * communityService.groupPulseFeedItems, which also collapses runs of
 * same-actor/same-verb non-opinion items within 24h into one grouped
 * row. Opinion-bearing items render through <HomeReviewCard/> (the FULL
 * card); everything else renders through <FeedRow/> or, for a grouped
 * run, <FeedGroupRow/> (both in ./FeedRow.jsx). This is purely a
 * rendering decision — it doesn't change which rows getHomeFeed
 * selected or reorder them.
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

  // V4-01 task 5 — captured once on mount, before this same effect's own
  // cleanup (unmount) overwrites the stored value for next visit.
  const [lastSeenAt] = useState(readLastSeenAt)

  // Persist the new checkpoint on unmount and on backgrounding
  // (visibilitychange -> hidden). Best-effort — a killed process with
  // neither event firing just falls back to the scope-based subline
  // next launch instead of a real count, same soft-fail convention as
  // every other localStorage read/write in this file.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') writeLastSeenAt()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      writeLastSeenAt()
    }
  }, [])

  const subline = useMemo(
    () => computeSubline({ items, scope, lastSeenAt }),
    [items, scope, lastSeenAt]
  )

  // task 1 (classification) + task 4 (grouping) — display-only reshaping
  // of the already-fetched, already-ordered `items`; does not change
  // what getHomeFeed returned or touch stored data. See
  // communityService.groupPulseFeedItems.
  const displayList = useMemo(() => groupPulseFeedItems(items), [items])

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
          {(loading || !isEmpty) && (
            <p className="pulse-feed__subline">
              <Arrive as="span" ready={!loading} placeholder={'\u00a0'}>
                {subline}
              </Arrive>
            </p>
          )}
        </div>

        <Arrive ready={!loading} placeholder={<FeedSkeleton />}>
        {loading ? null : isEmpty ? (
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
              {displayList.map((entry, index) => {
                const coverPriority = coverLoadingProps(index, 3)
                if (entry.kind === 'full') {
                  return (
                    <WindowedListItem key={entry.item.id} className="pulse-feed__item pulse-feed__item--full">
                      <HomeReviewCard item={entry.item} coverPriority={coverPriority} />
                    </WindowedListItem>
                  )
                }
                if (entry.kind === 'group') {
                  return (
                    <WindowedListItem key={`group-${entry.items[0].id}`} className="pulse-feed__item pulse-feed__item--compact">
                      <FeedGroupRow items={entry.items} coverPriority={coverPriority} />
                    </WindowedListItem>
                  )
                }
                if (isQaPulseItem(entry.item)) {
                  return (
                    <WindowedListItem key={entry.item.id} className="pulse-feed__item pulse-feed__item--compact">
                      <QaFeedRow item={entry.item} coverPriority={coverPriority} />
                    </WindowedListItem>
                  )
                }
                return (
                  <WindowedListItem key={entry.item.id} className="pulse-feed__item pulse-feed__item--compact">
                    <FeedRow item={entry.item} coverPriority={coverPriority} />
                  </WindowedListItem>
                )
              })}
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
        </Arrive>
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
