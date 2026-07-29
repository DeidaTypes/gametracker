import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getActivitiesForUser,
  formatActivityMessage,
  getActivityHref,
} from '../services/activityService'
import { formatActivityDate } from '../utils/formatActivityDate'
import EmptyState from './EmptyState'
import './ActivityFeed.css'

const PAGE_SIZE = 50

/**
 * Per-type icon glyph + colour-coded class.
 *   amber  → status_changed
 *   purple → review_posted
 *   green  → list_created / game_added_to_list
 */
const TYPE_GLYPH = {
  status_changed: '\u2197',       // ↗
  review_posted: '\u2605',        // ★
  list_created: '\u2630',         // ☰
  game_added_to_list: '+',
}

/**
 * Renders the small avatar shown to the left of every activity row.
 * Falls back to coloured initials when no avatar URL / data is set.
 */
function ActorAvatar({ avatarUrl, avatarData, displayName, color }) {
  const src = avatarData || avatarUrl || null
  if (src) {
    return (
      <div className="activity-feed-avatar">
        <img src={src} alt="" loading="lazy" />
      </div>
    )
  }
  const initials = (displayName || 'U')
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return (
    <div
      className="activity-feed-avatar activity-feed-avatar--generated"
      style={{ backgroundColor: color || 'var(--color-bg-tertiary)' }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

/**
 * Vertical activity timeline for the Profile → Activity tab.
 *
 * Props:
 *   userId          — UUID of the user whose activity to load
 *   avatarUrl       — uploaded avatar URL (Supabase profile)
 *   avatarData      — base64 avatar (legacy local profile)
 *   displayName     — used for fallback avatar initials
 *   avatarColor     — used for fallback avatar background
 *
 * Behaviour:
 *   - Loads PAGE_SIZE (50) activities on mount.
 *   - "Show older activity" loads the next page.
 *   - Auto-refreshes when `activityUpdated` / `reviewAdded` /
 *     `libraryUpdated` events fire (so logging a new activity makes it
 *     show up within ~one network round trip).
 */
function ActivityFeed({ userId, avatarUrl, avatarData, displayName, avatarColor }) {
  const navigate = useNavigate()
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // Initial load + reload-on-event. Always fetches from offset 0 and
  // resets the pagination cursor so newly-logged events appear.
  const refresh = useCallback(async () => {
    if (!userId) {
      setActivities([])
      setLoading(false)
      setHasMore(false)
      return
    }
    try {
      const rows = await getActivitiesForUser(userId, { limit: PAGE_SIZE, offset: 0 })
      setActivities(rows)
      setHasMore(rows.length === PAGE_SIZE)
    } catch (err) {
      console.error('[activity] refresh failed:', err)
      setActivities([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('activityUpdated', handler)
    window.addEventListener('reviewAdded', handler)
    window.addEventListener('libraryUpdated', handler)
    return () => {
      window.removeEventListener('activityUpdated', handler)
      window.removeEventListener('reviewAdded', handler)
      window.removeEventListener('libraryUpdated', handler)
    }
  }, [refresh])

  const loadMore = useCallback(async () => {
    if (!userId || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const next = await getActivitiesForUser(userId, {
        limit: PAGE_SIZE,
        offset: activities.length,
      })
      setActivities((prev) => [...prev, ...next])
      if (next.length < PAGE_SIZE) setHasMore(false)
    } catch (err) {
      console.error('[activity] loadMore failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [userId, activities.length, loadingMore, hasMore])

  if (loading) {
    return (
      <div className="activity-feed activity-feed--loading" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="activity-feed-row-skeleton">
            <div className="skeleton activity-feed-sk-avatar" />
            <div className="activity-feed-sk-body">
              <div className="skeleton activity-feed-sk-line" />
              <div className="skeleton activity-feed-sk-line activity-feed-sk-line--short" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        variant="activity"
        copy="Your activity will show up here as you play, review, and curate."
      />
    )
  }

  return (
    <div className="activity-feed">
      <ul className="activity-feed-list">
        {activities.map((activity) => {
          const href = getActivityHref(activity)
          const message = formatActivityMessage(activity)
          const time = formatActivityDate(activity.createdAt)
          return (
            <li
              key={activity.id}
              className={`activity-feed-item activity-feed-item--${activity.activityType}${
                href ? '' : ' activity-feed-item--static'
              }`}
              onClick={href ? () => navigate(href) : undefined}
              role={href ? 'button' : undefined}
              tabIndex={href ? 0 : undefined}
              onKeyDown={
                href
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate(href)
                      }
                    }
                  : undefined
              }
            >
              <ActorAvatar
                avatarUrl={avatarUrl}
                avatarData={avatarData}
                displayName={displayName}
                color={avatarColor}
              />
              <span
                className="activity-feed-icon"
                aria-hidden="true"
              >
                {TYPE_GLYPH[activity.activityType] || '\u2022'}
              </span>
              <div className="activity-feed-body">
                <span className="activity-feed-message">{message}</span>
              </div>
              <span className="activity-feed-time">{time}</span>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <button
          type="button"
          className="activity-feed-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Show older activity'}
        </button>
      )}
    </div>
  )
}

export default ActivityFeed
