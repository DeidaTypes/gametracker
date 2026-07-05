import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchActivitiesForDay,
  formatActivityMessage,
  getActivityHref,
} from '../services/activityService'
import StarRating from './StarRating'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './DayLogSheet.css'

/**
 * DayLogSheet — bottom sheet showing every activity logged on a given day.
 *
 * Rows with an associated game (everything except 'list_created') render
 * a cover thumbnail + title + a colored type tag, per the Calendar
 * day-detail spec:
 *   Reviewed/Rated      → green tag  (--accent-review), stars shown
 *   Added to list       → purple tag (--accent-journal), "→ list name" shown
 *   everything else     → neutral tag, plain sentence (unchanged look)
 *
 * Props:
 *   dateKey  {'YYYY-MM-DD' | null}  — day to display; null = closed
 *   onClose  {() => void}
 */

const ACTIVITY_ICONS = {
  status_changed:     '📚',
  review_posted:      '⭐',
  list_created:       '📋',
  game_added_to_list: '➕',
  session_logged:     '🎮',
  journal_written:    '📝',
}

const STATUS_TAG_LABEL = {
  want: 'Want to Play',
  currently: 'Playing',
  played: 'Played',
  dropped: 'Dropped',
}

/**
 * Type tag { label, tone } for an activity row.
 * tone: 'review' (green) | 'journal' (purple) | 'neutral' (default)
 */
function activityTag(activity) {
  switch (activity.activityType) {
    case 'review_posted':
      return { label: 'Reviewed', tone: 'review' }
    case 'game_added_to_list':
      return { label: 'Added to list', tone: 'journal' }
    case 'list_created':
      return { label: 'New list', tone: 'journal' }
    case 'status_changed':
      return { label: STATUS_TAG_LABEL[activity.metadata?.to_status] || 'Status', tone: 'neutral' }
    case 'session_logged':
      return { label: 'Played', tone: 'neutral' }
    case 'journal_written':
      return { label: 'Journal', tone: 'neutral' }
    default:
      return { label: 'Activity', tone: 'neutral' }
  }
}

function formatDayTitle(dateKey) {
  if (!dateKey) return ''
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.getTime() === today.getTime())     return 'Today'
  if (date.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  })
}

function formatTime(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString(undefined, {
    hour:   'numeric',
    minute: '2-digit',
  })
}

export default function DayLogSheet({ dateKey, onClose }) {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const { reduced } = useMotionPreference()

  const isOpen = !!dateKey

  const [activities, setActivities] = useState([])
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!isOpen || !user?.id || !dateKey) return

    let cancelled = false
    setLoading(true)
    setActivities([])

    fetchActivitiesForDay(user.id, dateKey).then((rows) => {
      if (!cancelled) {
        setActivities(rows)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [isOpen, user?.id, dateKey])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const springProps = reduced
    ? {}
    : { type: 'spring', stiffness: 380, damping: 34 }

  function handleActivityTap(activity) {
    const href = getActivityHref(activity)
    if (href) {
      onClose()
      navigate(href)
    }
  }

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="dls-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            className="dls-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Activity log for ${formatDayTitle(dateKey)}`}
            initial={reduced ? {} : { y: '100%' }}
            animate={reduced ? {} : { y: 0 }}
            exit={reduced ? {} : { y: '100%' }}
            transition={springProps}
          >
            <div className="dls-handle" aria-hidden="true" />

            <div className="dls-header">
              <div className="dls-header-text">
                <h2 className="dls-title">{formatDayTitle(dateKey)}</h2>
                {!loading && activities.length > 0 && (
                  <p className="dls-subtitle">
                    {activities.length} {activities.length === 1 ? 'thing' : 'things'} logged
                  </p>
                )}
              </div>
              <button
                type="button"
                className="dls-close-btn"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="dls-body">
              {loading && (
                <p className="dls-loading" aria-live="polite">Loading…</p>
              )}

              {!loading && activities.length === 0 && (
                <div className="dls-empty">
                  <span className="dls-empty-icon" aria-hidden="true">🎮</span>
                  <p className="dls-empty-text">No activity logged this day.</p>
                </div>
              )}

              {!loading && activities.length > 0 && (
                <ul className="dls-list" role="list">
                  {activities.map((act) => {
                    const href = getActivityHref(act)
                    const msg  = formatActivityMessage(act)
                    const icon = ACTIVITY_ICONS[act.activityType] ?? '•'
                    const tag  = activityTag(act)
                    // Every type except 'list_created' is anchored to a
                    // specific game — those get the rich cover+tag+meta
                    // row; 'list_created' keeps the original sentence row
                    // since there's no single game to show a cover for.
                    const hasGameRow = act.activityType !== 'list_created'

                    return (
                      <li key={act.id} className="dls-item">
                        <button
                          type="button"
                          className={`dls-item-btn${href ? '' : ' dls-item-btn--static'}`}
                          onClick={() => href && handleActivityTap(act)}
                          disabled={!href}
                          aria-label={msg}
                        >
                          {hasGameRow ? (
                            <>
                              <img
                                className="dls-item-cover"
                                src={act.gameImage || COVER_FALLBACK}
                                alt=""
                                loading="lazy"
                                onError={(e) => { e.target.src = COVER_FALLBACK }}
                              />
                              <div className="dls-item-content">
                                <span className={`dls-item-tag dls-item-tag--${tag.tone}`}>
                                  {tag.label}
                                </span>
                                <span className="dls-item-title">
                                  {act.gameTitle || 'Untitled game'}
                                </span>
                                {act.activityType === 'review_posted' && act.reviewRating != null ? (
                                  <StarRating rating={act.reviewRating} size={12} />
                                ) : act.activityType === 'game_added_to_list' ? (
                                  <span className="dls-item-list-target">
                                    → {act.listName || 'a list'}
                                  </span>
                                ) : null}
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="dls-item-icon" aria-hidden="true">{icon}</span>
                              <span className="dls-item-text">{msg}</span>
                            </>
                          )}
                          <span className="dls-item-time">{formatTime(act.createdAt)}</span>
                          {href && (
                            <ChevronRight
                              size={14}
                              className="dls-item-chevron"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}
