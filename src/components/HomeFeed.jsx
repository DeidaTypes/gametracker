import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getFollowingCount } from '../services/followService'
import {
  formatActivityEventMessage,
  getActivityEventHref,
  getRecentGlobalActivityEvents,
} from '../services/activityEventsService'
import { useCircleActivity } from '../hooks/useCircleActivity'
import { useForYouBlend } from '../hooks/useForYouBlend'
import { usePresence } from '../hooks/usePresence'
import Reactions from './Reactions'
import FindFriendsModal from './FindFriendsModal'
import './HomeFeed.css'

const FEED_PAGE_SIZE = 15
const TIMEOUT_MS = 10_000

function safeWithTimeout(promise, fallback, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1d'
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Live presence row ──────────────────────────────────────────────────────────

function PresenceRow({ entry, navigate }) {
  const name = entry.displayName || 'Someone'
  const { gameTitle, gameImage, gameId } = entry
  const label = `${name} is playing ${gameTitle || 'a game'} now`

  const onActivate = () => {
    if (!gameId) return
    navigate(`/game/${gameId}`, gameImage ? { state: { coverImage: gameImage } } : undefined)
  }

  return (
    <div
      className="hf-row hf-presence-row"
      role={gameId ? 'button' : undefined}
      tabIndex={gameId ? 0 : undefined}
      onClick={gameId ? onActivate : undefined}
      onKeyDown={gameId ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } } : undefined}
      aria-label={label}
    >
      <div className="hf-presence-live-dot" aria-hidden="true" />
      <div className="hf-row__cover">
        {gameImage ? (
          <img src={gameImage} alt="" loading="lazy" />
        ) : (
          <span className="hf-row__cover-fallback">{(gameTitle || '?').charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="hf-row__body">
        <p className="hf-row__sentence">
          <span className="hf-actor">{name}</span>
          {' is playing '}
          <span className="hf-game">{gameTitle || 'a game'}</span>
          {' now'}
        </p>
      </div>
      <span className="hf-presence-badge" aria-hidden="true">Live</span>
    </div>
  )
}

// ── Activity event row ─────────────────────────────────────────────────────────

function EventRow({ event, navigate }) {
  const href = getActivityEventHref(event)
  const sentence = formatActivityEventMessage(event)
  const meta = event.metadata || {}
  const cover = meta.game_image || null
  const title = meta.game_title || ''
  const when = relativeTime(event.created_at)

  const onActivate = () => {
    if (!href) return
    navigate(href, cover ? { state: { coverImage: cover } } : undefined)
  }

  const onKeyDown = (e) => {
    if (!href) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }

  return (
    <div
      className={`hf-row hf-event-row${href ? '' : ' hf-row--static'}`}
      onClick={href ? onActivate : undefined}
      onKeyDown={href ? onKeyDown : undefined}
      role={href ? 'button' : undefined}
      tabIndex={href ? 0 : undefined}
      aria-label={sentence}
    >
      <div className="hf-row__cover">
        {cover ? (
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <span className="hf-row__cover-fallback">
            {(title || event.type || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="hf-row__body">
        <p className="hf-row__sentence">{sentence}</p>
        <div
          className="hf-row__reactions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Reactions targetType="activity" targetId={event.id} />
        </div>
      </div>
      <span className="hf-row__time" aria-hidden="true">{when}</span>
    </div>
  )
}

// ── For-you discovery row ─────────────────────────────────────────────────────

function ForYouRow({ event, navigate }) {
  const href = getActivityEventHref(event)
  const sentence = formatActivityEventMessage(event)
  const meta = event.metadata || {}
  const cover = meta.game_image || null
  const title = meta.game_title || ''
  const when = relativeTime(event.created_at)

  const onActivate = () => {
    if (!href) return
    navigate(href, cover ? { state: { coverImage: cover } } : undefined)
  }

  return (
    <div className="hf-foryou-wrapper">
      <p className="hf-foryou-label" aria-label="Recommended for you">✦ people like you loved this</p>
      <div
        className={`hf-row hf-event-row hf-event-row--foryou${href ? '' : ' hf-row--static'}`}
        onClick={href ? onActivate : undefined}
        onKeyDown={href ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } } : undefined}
        role={href ? 'button' : undefined}
        tabIndex={href ? 0 : undefined}
        aria-label={sentence}
      >
        <div className="hf-row__cover">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            <span className="hf-row__cover-fallback">
              {(title || event.type || '?').charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="hf-row__body">
          <p className="hf-row__sentence">{sentence}</p>
        </div>
        <span className="hf-row__time" aria-hidden="true">{when}</span>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function FeedSkeleton({ rows = 4 }) {
  return (
    <div className="hf-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="hf-skeleton-row">
          <div className="skeleton hf-skeleton-cover" />
          <div className="hf-skeleton-lines">
            <div className="skeleton hf-skeleton-line" style={{ width: `${48 + (i % 3) * 10}%` }} />
            <div className="skeleton hf-skeleton-line" style={{ width: '30%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Blend helper ──────────────────────────────────────────────────────────────

function weaveForYouItems(followEvents, blendItems) {
  if (!blendItems.length) return followEvents.map((e) => ({ event: e, _blend: false }))

  const result = []
  let blendIdx = 0

  for (let i = 0; i < followEvents.length; i++) {
    result.push({ event: followEvents[i], _blend: false })
    if ((i + 1) % 4 === 0 && blendIdx < blendItems.length) {
      result.push({ event: blendItems[blendIdx], _blend: true })
      blendIdx++
    }
  }

  return result
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * HomeFeed — full-width activity feed for the Home screen.
 *
 * Section order:
 *   1. Live presence rows — followed users currently playing ("X is playing Y now")
 *   2. Follow-graph activity rows — worded events from people you follow, newest-first,
 *      with inline F3 reactions. For-you blend items woven in at 1:4 ratio.
 *   3. Pagination ("Show more") at the tail of follow events.
 *
 * Cold-start fallback (no follows OR circle quiet):
 *   Show real broader community activity — not a blank island. A small secondary
 *   "Find people to follow" nudge appears below, never as the only content.
 */
export default function HomeFeed() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)

  // ── Live presence ─────────────────────────────────────────────────────────
  const { playingNow } = usePresence()

  // ── Circle activity ───────────────────────────────────────────────────────
  const {
    events: activityEvents,
    loading: activityLoading,
    loadingMore: activityLoadingMore,
    hasMore: activityHasMore,
    loadMore: loadMoreActivity,
  } = useCircleActivity({ pageSize: FEED_PAGE_SIZE })

  // ── For-you blend items ───────────────────────────────────────────────────
  const { items: forYouItems } = useForYouBlend()

  // ── Follow count (for no-follows vs. quiet-circle distinction) ────────────
  const [followCount, setFollowCount] = useState(null)
  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    safeWithTimeout(getFollowingCount(user.id), 0).then((count) => {
      if (!cancelled) setFollowCount(Number(count) || 0)
    })
    return () => { cancelled = true }
  }, [user])

  // ── Broad community fallback ──────────────────────────────────────────────
  // Fires when the circle is empty (or user has no follows) so the feed
  // shows real content instead of a blank island.
  const [broadEvents, setBroadEvents] = useState([])
  const [broadLoading, setBroadLoading] = useState(false)
  const broadFetchedRef = useRef(false)

  const activityStatus = useMemo(() => {
    if (!user) return 'idle'
    if (activityLoading && activityEvents.length === 0) return 'loading'
    if (followCount === 0) return 'no-follows'
    if (activityEvents.length === 0) return 'empty'
    return 'loaded'
  }, [user, activityLoading, activityEvents.length, followCount])

  useEffect(() => {
    if (activityStatus !== 'empty' && activityStatus !== 'no-follows') return
    if (broadFetchedRef.current) return
    broadFetchedRef.current = true
    setBroadLoading(true)
    getRecentGlobalActivityEvents({ limit: 15 })
      .then((rows) => setBroadEvents(rows || []))
      .catch(() => setBroadEvents([]))
      .finally(() => setBroadLoading(false))
  }, [activityStatus])

  const openFindFriends = useCallback(() => setFindFriendsOpen(true), [])
  const woven = useMemo(
    () => (activityStatus === 'loaded' ? weaveForYouItems(activityEvents, forYouItems) : []),
    [activityEvents, forYouItems, activityStatus],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  function renderFeedContent() {
    if (activityStatus === 'idle' || activityStatus === 'loading') {
      return <FeedSkeleton rows={4} />
    }

    // Cold-start: no follows OR circle quiet → show community activity
    if (activityStatus === 'no-follows' || activityStatus === 'empty') {
      if (broadLoading) return <FeedSkeleton rows={4} />
      if (broadEvents.length > 0) {
        return (
          <>
            <p className="hf-community-label">Recent community activity</p>
            {broadEvents.map((event) => (
              <EventRow key={event.id} event={event} navigate={navigate} />
            ))}
            <button
              type="button"
              className="hf-find-nudge"
              onClick={openFindFriends}
            >
              Find people to follow
            </button>
          </>
        )
      }
      // Broad community also empty (very new instance) — minimal fallback
      return (
        <div className="hf-empty-state">
          <p className="hf-empty-state__text">No recent activity yet.</p>
          <button type="button" className="hf-find-nudge" onClick={openFindFriends}>
            Find people to follow
          </button>
        </div>
      )
    }

    // Loaded: follow-graph events + for-you blend
    return (
      <>
        {woven.map(({ event, _blend }) =>
          _blend ? (
            <ForYouRow key={`fy-${event.id}`} event={event} navigate={navigate} />
          ) : (
            <EventRow key={event.id} event={event} navigate={navigate} />
          )
        )}
        {activityHasMore && (
          <button
            type="button"
            className="hf-load-more"
            onClick={loadMoreActivity}
            disabled={activityLoadingMore}
          >
            {activityLoadingMore ? 'Loading\u2026' : 'Show more'}
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <section className="hf-section" aria-label="The Feed">
        <h2 className="hf-title">The Feed</h2>

        {/* Live presence rows — users currently playing */}
        {playingNow.length > 0 && (
          <div className="hf-presence-strip" aria-label="Playing now">
            {playingNow.map((entry) => (
              <PresenceRow key={entry.userId} entry={entry} navigate={navigate} />
            ))}
            <div className="hf-presence-divider" aria-hidden="true" />
          </div>
        )}

        {/* Activity + cold-start content */}
        <div className="hf-event-list">
          {renderFeedContent()}
        </div>
      </section>

      <FindFriendsModal
        isOpen={findFriendsOpen}
        onClose={() => setFindFriendsOpen(false)}
        currentUserId={user?.id ?? null}
      />
    </>
  )
}
