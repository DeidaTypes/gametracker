import React, { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import {
  LuPlay,
  LuCheck,
  LuStar,
  LuPlus,
  LuChevronRight,
  LuBookOpen,
} from 'react-icons/lu'
import { formatActivityMessage } from '../services/activityService'

/* ============================================================
   Reactions — localStorage, keyed by activity id
   Key: 'gt:reactions:v1' → { [activityId]: { '🔥': true, ... } }
   ============================================================ */

const REACTIONS = ['🔥', '👍', '😮']
const LS_KEY = 'gt:reactions:v1'

function loadReactions() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveReactions(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {}
}

/* ============================================================
   Day grouping — activities are newest-first from the service.
   Group into calendar days (local time), then within each day
   collapse consecutive session_logged rows for the same game
   into a single merged entry.
   ============================================================ */

function toDateKey(isoString) {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function formatDateLabel(isoString) {
  const d = new Date(isoString)
  const today = new Date()
  const todayKey = toDateKey(today.toISOString())
  const yest = new Date(today)
  yest.setDate(yest.getDate() - 1)
  const yesterdayKey = toDateKey(yest.toISOString())
  const key = toDateKey(isoString)
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function groupActivities(activities) {
  // activities: newest-first
  const groups = []
  const dayIndex = new Map()

  for (const a of activities) {
    const dayKey = toDateKey(a.createdAt)
    if (!dayIndex.has(dayKey)) {
      dayIndex.set(dayKey, groups.length)
      groups.push({ dayKey, label: formatDateLabel(a.createdAt), entries: [] })
    }
    const group = groups[dayIndex.get(dayKey)]
    const entries = group.entries
    const last = entries[entries.length - 1]

    // Collapse consecutive session_logged rows for the same game
    if (
      a.activityType === 'session_logged' &&
      last &&
      last.activityType === 'session_logged' &&
      last.igdbGameId != null &&
      last.igdbGameId === a.igdbGameId
    ) {
      const prevHours = last._totalHours ?? (last.metadata?.added_hours ?? 0)
      const thisHours = a.metadata?.added_hours ?? 0
      last._totalHours = prevHours + thisHours
      last._collapsedCount = (last._collapsedCount ?? 1) + 1
      last.metadata = { ...last.metadata, added_hours: last._totalHours }
    } else {
      entries.push({ ...a, _totalHours: a.metadata?.added_hours ?? null })
    }
  }

  return groups
}

/* ============================================================
   Milestone detection — chronologically FIRST matching event
   in the dataset. Since activities are newest-first, the LAST
   element of any filtered array is the chronological first.
   We only mark a milestone if it appears in the dataset we hold.
   ============================================================ */

function detectMilestoneIds(activities) {
  const ids = new Set()

  // First 5-star review
  const fiveStars = activities.filter(
    (a) => a.activityType === 'review_posted' && Number(a.reviewRating) === 5
  )
  if (fiveStars.length > 0) ids.add(fiveStars[fiveStars.length - 1].id)

  // First game beaten (status → 'played')
  const beaten = activities.filter(
    (a) => a.activityType === 'status_changed' && a.metadata?.to_status === 'played'
  )
  if (beaten.length > 0) ids.add(beaten[beaten.length - 1].id)

  return ids
}

const MILESTONE_META = {
  review_posted: { emoji: '⭐', label: 'First 5-star review' },
  status_changed: { emoji: '🏆', label: 'First game beaten' },
}

/* ============================================================
   Activity icon
   ============================================================ */

function getActivityIcon(activity) {
  const t = activity.activityType
  const to = activity.metadata?.to_status
  if (t === 'status_changed') {
    if (to === 'played') return LuCheck
    if (to === 'currently') return LuPlay
    if (to === 'want') return LuPlus
    if (to === 'dropped') return LuPlay
  }
  if (t === 'review_posted') return LuStar
  if (t === 'list_created' || t === 'game_added_to_list') return LuPlus
  if (t === 'journal_written') return LuBookOpen
  return LuPlay
}

/* ============================================================
   ReactionBar — 3 emoji toggles, localStorage-persisted
   ============================================================ */

function ReactionBar({ activityId, reactions, onToggle }) {
  const state = reactions[activityId] || {}
  return (
    <div className="at-reaction-bar" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji) => {
        const active = Boolean(state[emoji])
        return (
          <button
            key={emoji}
            type="button"
            className={`at-reaction-btn${active ? ' at-reaction-btn--active' : ''}`}
            onClick={() => onToggle(activityId, emoji)}
            aria-pressed={active}
            aria-label={`${emoji} reaction${active ? ', active' : ''}`}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ============================================================
   ActivityEntry — single row
   ============================================================ */

function ActivityEntry({
  activity,
  image,
  isMilestone,
  milestoneLabel,
  reactions,
  onToggleReaction,
  onNavigate,
  isOwnProfile,
}) {
  const Icon = getActivityIcon(activity)
  const message = formatActivityMessage(activity)
  const timeStr = formatTime(activity.createdAt)

  return (
    <div className={`at-entry${isMilestone ? ' at-entry--milestone' : ''}`}>
      {/* Left — vertical timeline connector + icon */}
      <div className="at-entry__track">
        <div className={`at-entry__dot${isMilestone ? ' at-entry__dot--milestone' : ''}`}>
          <Icon size={11} aria-hidden="true" />
        </div>
        <div className="at-entry__line" aria-hidden="true" />
      </div>

      {/* Right — content */}
      <div className="at-entry__body">
        {/* Milestone badge — subtle strip above the message */}
        {isMilestone && (
          <div className="at-milestone-badge" role="img" aria-label={milestoneLabel}>
            <span aria-hidden="true">{milestoneLabel.split(' ')[0]}</span>
            <span className="at-milestone-badge__text">{milestoneLabel.slice(milestoneLabel.indexOf(' ') + 1)}</span>
          </div>
        )}

        {/* Cover + message */}
        <button
          type="button"
          className="at-entry__main"
          onClick={() => onNavigate(activity)}
          aria-label={message}
        >
          {image && (
            <div className="at-entry__cover">
              <img src={image} alt="" loading="lazy" />
            </div>
          )}
          <div className="at-entry__text">
            <span className="at-entry__message">{message}</span>
            <span className="at-entry__time">{timeStr}</span>
          </div>
        </button>

        {/* Reaction bar — visible to visitors too */}
        <ReactionBar
          activityId={activity.id}
          reactions={reactions}
          onToggle={onToggleReaction}
        />
      </div>
    </div>
  )
}

/* ============================================================
   ActivityTimeline — public component
   ============================================================ */

/**
 * @param {{
 *   activities: Array,          full activity array (newest-first)
 *   gameImageMap: Map,          igdbGameId (string) → image URL
 *   onNavigate?: Function,      override nav; defaults to useNavigate
 *   isOwnProfile?: boolean,
 *   onSeeAll?: Function,        chevron callback
 * }} props
 */
export default function ActivityTimeline({
  activities = [],
  gameImageMap = new Map(),
  onNavigate: onNavigateProp,
  isOwnProfile = false,
  onSeeAll,
}) {
  const navigate = useNavigate()
  const reducedMotion = useReducedMotion()

  const [reactions, setReactions] = useState(() => loadReactions())

  const handleToggleReaction = useCallback((activityId, emoji) => {
    setReactions((prev) => {
      const current = { ...prev }
      const entry = { ...(current[activityId] || {}) }
      if (entry[emoji]) {
        delete entry[emoji]
      } else {
        entry[emoji] = true
      }
      current[activityId] = entry
      saveReactions(current)
      return current
    })
  }, [])

  const handleNavigate = useCallback(
    (activity) => {
      if (onNavigateProp) {
        onNavigateProp(activity)
        return
      }
      // Default: route by activity type
      const { activityType, igdbGameId, targetId, metadata } = activity
      if (activityType === 'status_changed' || activityType === 'session_logged' || activityType === 'journal_written') {
        if (igdbGameId) navigate(`/game/${igdbGameId}`)
      } else if (activityType === 'review_posted') {
        if (igdbGameId) {
          const href = targetId
            ? `/game/${igdbGameId}?review=${encodeURIComponent(targetId)}`
            : `/game/${igdbGameId}`
          navigate(href)
        }
      } else if (activityType === 'list_created' || activityType === 'game_added_to_list') {
        if (igdbGameId) navigate(`/game/${igdbGameId}`)
        else if (targetId) navigate(`/list/${targetId}`)
      }
    },
    [navigate, onNavigateProp]
  )

  const groups = useMemo(() => groupActivities(activities), [activities])
  const milestoneIds = useMemo(() => detectMilestoneIds(activities), [activities])

  if (activities.length === 0) return null

  return (
    <section className="at-timeline profile-home__section" aria-label="Activity timeline">
      <div className="profile-home__section-header">
        <h3 className="profile-home__section-title">Activity</h3>
        {onSeeAll && (
          <button
            type="button"
            className="profile-home__chevron-btn"
            onClick={onSeeAll}
            aria-label="See full activity log"
          >
            <LuChevronRight size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="at-groups">
        {groups.map((group) => (
          <div key={group.dayKey} className="at-day-group">
            <p className="at-day-label" aria-label={`Activities on ${group.label}`}>
              {group.label}
            </p>
            <div className="at-entries">
              {group.entries.map((activity) => {
                const image = activity.igdbGameId
                  ? gameImageMap.get(String(activity.igdbGameId)) ?? null
                  : null
                const isMilestone = milestoneIds.has(activity.id)
                const milestoneMeta = isMilestone
                  ? MILESTONE_META[activity.activityType]
                  : null
                return (
                  <ActivityEntry
                    key={activity.id}
                    activity={activity}
                    image={image}
                    isMilestone={isMilestone}
                    milestoneLabel={milestoneMeta?.emoji && milestoneMeta?.label
                      ? `${milestoneMeta.emoji} ${milestoneMeta.label}`
                      : null}
                    reactions={reactions}
                    onToggleReaction={handleToggleReaction}
                    onNavigate={handleNavigate}
                    isOwnProfile={isOwnProfile}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
