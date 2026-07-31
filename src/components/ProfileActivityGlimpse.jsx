import React from 'react'
import { LuChevronRight } from 'react-icons/lu'
import { formatActivityMessage, getActivityHref } from '../services/activityService'
import Skeleton from './Skeleton'
import './ProfileActivityGlimpse.css'

// A glimpse, not a feed — the full history lives behind "See all".
const MAX_ITEMS = 3

/**
 * Colour family per event type, matching the verbs used elsewhere in the
 * app: green for rating/reviewing, purple for list work, cobalt for play
 * sessions and status changes.
 */
const DOT_CLASS = {
  review_posted: 'pag__dot--review',
  list_created: 'pag__dot--list',
  game_added_to_list: 'pag__dot--list',
  journal_written: 'pag__dot--list',
  session_logged: 'pag__dot--session',
  status_changed: 'pag__dot--session',
}

/**
 * Relative timestamp, tightening to an absolute date past a week so a
 * month-old entry reads "Jul 28" rather than "31d ago".
 */
function formatWhen(iso) {
  if (!iso) return ''
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * ProfileActivityGlimpse — the Recent activity section on Profile Home.
 *
 * Up to three events, one line each: a colour-coded dot for the event
 * type, the sentence activityService already formats, and a timestamp.
 * No reactions, no thumbnails, no emoji — the full activity view behind
 * "See all" is where the detail lives.
 *
 * Hides entirely when the user has no activity; renders placeholder rows
 * while the fetch is in flight so the section doesn't pop in.
 */
export default function ProfileActivityGlimpse({
  activities,
  loading,
  onSeeAll,
  onItemClick,
}) {
  if (loading) {
    return (
      <section className="pag" aria-label="Recent activity" aria-busy="true">
        <div className="pag__header">
          <h3 className="pag__title">Recent activity</h3>
        </div>
        <div className="pag__list">
          {[0, 1].map((i) => (
            <div key={i} className="pag__row pag__row--placeholder">
              <span className="pag__dot pag__dot--placeholder" />
              <Skeleton variant="text" width={i === 0 ? '62%' : '48%'} height={15} />
            </div>
          ))}
        </div>
      </section>
    )
  }

  const items = (activities || []).slice(0, MAX_ITEMS)
  if (items.length === 0) return null

  return (
    <section className="pag" aria-label="Recent activity">
      <div className="pag__header">
        <h3 className="pag__title">Recent activity</h3>
        <button type="button" className="pag__see-all" onClick={onSeeAll}>
          See all
          <LuChevronRight size={15} aria-hidden="true" />
        </button>
      </div>

      <ul className="pag__list">
        {items.map((activity) => {
          const href = getActivityHref(activity)
          const message = formatActivityMessage(activity)
          const when = formatWhen(activity.createdAt)
          return (
            <li key={activity.id} className="pag__item">
              <button
                type="button"
                className="pag__row"
                onClick={() => href && onItemClick(href)}
                disabled={!href}
                aria-label={`${message}, ${when}`}
              >
                <span
                  className={`pag__dot ${
                    DOT_CLASS[activity.activityType] || 'pag__dot--session'
                  }`}
                  aria-hidden="true"
                />
                <span className="pag__body">
                  <span className="pag__message">{message}</span>
                  <span className="pag__when">{when}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
