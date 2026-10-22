import React, { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Bell, Flag, Users } from 'lucide-react'
import { useNotifications } from '../contexts/NotificationsContext'
import AppShell from '../components/AppShell'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
import PullToRefresh from '../components/PullToRefresh'
import { coverUrlFromImageId } from '../services/igdb'
import './NotificationsInbox.css'

/* ============================================================
   Helpers
   ============================================================ */

function relativeTime(timestamp) {
  if (!timestamp) return ''
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'now'
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w`
  const months = Math.round(d / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(d / 365)}y`
}

/**
 * Copy per type. `actor: false` rows are anonymous by design (the stuck
 * notice, and admin reports, which never name the reporter). Types not
 * listed here are not rendered.
 */
const COPY = {
  follow: { actor: true, text: () => 'started following you' },
  reaction: { actor: true, text: () => 'reacted to your review' },
  comment: { actor: true, text: () => 'commented on your review' },
  friend_started: { actor: true, text: () => 'started playing a game in your backlog' },
  review_like: { actor: true, text: () => 'liked your review' },
  list_comment: { actor: true, text: () => 'commented on your list', title: (p) => p.list_title },
  mention: { actor: true, text: () => 'mentioned you' },
  qa_answer: { actor: true, text: () => 'answered your question' },
  qa_best: { actor: true, text: () => 'picked your answer as best' },
  qa_stuck_answered: { actor: false, text: () => "A question you're stuck on was answered", icon: Users },
  admin_report: { actor: false, text: () => 'New report to review', icon: Flag },
}

/** Bursts on the same thing collapse into one row: "nightowl and 4 others…". */
const GROUPABLE = new Set(['review_like', 'reaction', 'comment', 'list_comment', 'qa_answer'])
const GROUP_WINDOW_MS = 48 * 60 * 60 * 1000

function groupKey(n) {
  if (!GROUPABLE.has(n.type)) return null
  const target = n.type === 'qa_answer' ? n.payload?.question_id : n.entity_id
  return target ? `${n.type}:${target}` : null
}

function actorName(actor) {
  return actor?.display_name || actor?.username || null
}

/** Rows arrive newest first; each group is led by its newest row. */
function groupNotifications(rows) {
  const groups = []
  const open = new Map()
  for (const n of rows) {
    if (!COPY[n.type]) continue
    const key = groupKey(n)
    const existing = key ? open.get(key) : null
    if (
      existing &&
      new Date(existing.lead.created_at).getTime() - new Date(n.created_at).getTime() <= GROUP_WINDOW_MS
    ) {
      existing.rows.push(n)
      if (n.actor?.id) existing.actorIds.add(n.actor.id)
      continue
    }
    const group = { lead: n, rows: [n], actorIds: new Set(n.actor?.id ? [n.actor.id] : []) }
    if (key) open.set(key, group)
    groups.push(group)
  }
  return groups
}

function othersLabel(count) {
  if (count <= 0) return ''
  return count === 1 ? ' and 1 other' : ` and ${count} others`
}

function thumbnailFor(payload) {
  if (!payload) return null
  if (payload.game_image) return payload.game_image
  if (payload.game_cover_image_id) return coverUrlFromImageId(payload.game_cover_image_id, 'cover_small')
  if (payload.cover_image_url) return payload.cover_image_url
  return null
}

function qaRoute(payload) {
  if (!payload?.question_id) return null
  return {
    to: `/qa/q/${payload.question_id}`,
    state: payload.answer_id ? { focusAnswerId: payload.answer_id } : undefined,
  }
}

/** Where a tap goes. null = nothing to open (row stays inert). */
function routeFor(n) {
  const p = n.payload || {}
  switch (n.type) {
    case 'follow':
      return n.actor?.username ? { to: `/user/${n.actor.username}` } : null
    case 'reaction':
    case 'comment':
    case 'review_like':
      return n.entity_id ? { to: `/review/${n.entity_id}` } : null
    case 'friend_started':
      return n.entity_id ? { to: `/game/${n.entity_id}` } : null
    case 'list_comment':
      return p.list_id || n.entity_id ? { to: `/list/${p.list_id || n.entity_id}` } : null
    case 'qa_answer':
    case 'qa_stuck_answered':
    case 'qa_best':
      return qaRoute(p)
    case 'mention':
      if (p.source === 'review_comment' && p.review_id) return { to: `/reviews/${p.review_id}/comments` }
      if (p.source === 'activity_comment' && p.activity_event_id) {
        return { to: `/activity/${p.activity_event_id}/comments` }
      }
      if (p.source === 'list_comment' && p.list_id) return { to: `/list/${p.list_id}` }
      if (p.source === 'qa_answer') return qaRoute(p)
      return null
    case 'admin_report':
      return { to: '/settings/moderation' }
    default:
      return null
  }
}

/* ============================================================
   Notification item
   ============================================================ */

function NotificationItem({ group, onTap }) {
  const { lead, rows, actorIds } = group
  const copy = COPY[lead.type]
  const read = rows.every((r) => r.read)
  const name = copy.actor ? actorName(lead.actor) : null
  const others = copy.actor ? othersLabel(actorIds.size - 1) : ''
  const action = copy.text(lead.payload || {})
  const title = copy.title ? copy.title(lead.payload || {}) : null
  const thumb = thumbnailFor(lead.payload)
  const Icon = copy.icon || Bell
  const time = relativeTime(lead.created_at)

  const sentence = copy.actor
    ? `${name || 'Someone'}${others} ${action}${title ? ` ${title}` : ''}`
    : action

  return (
    <button
      type="button"
      className={`notif-item ${read ? '' : 'notif-item--unread'}`}
      onClick={onTap}
      aria-label={sentence}
    >
      <div className="notif-item__avatar-wrap">
        {copy.actor ? (
          <Avatar user={lead.actor} name={name || ''} size="md" className="notif-item__avatar" />
        ) : (
          <span className="notif-item__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div className="notif-item__body">
        <p className="notif-item__text">
          {copy.actor ? (
            <>
              <span className="notif-item__actor">{name || 'Someone'}</span>
              {others && <span className="notif-item__actor">{others}</span>}{' '}
              <span className="notif-item__action">{action}</span>
              {title && (
                <>
                  {' '}
                  <span className="notif-item__title">{title}</span>
                </>
              )}
            </>
          ) : (
            <span className="notif-item__actor">{action}</span>
          )}
        </p>
        <time className="notif-item__time" dateTime={lead.created_at}>
          {time}
        </time>
      </div>

      {thumb && <img className="notif-item__thumb" src={thumb} alt="" loading="lazy" />}

      {!read && <span className="notif-item__dot" aria-hidden="true" />}
    </button>
  )
}

/* ============================================================
   Page
   ============================================================ */

function NotificationsInbox() {
  const navigate = useNavigate()
  const { notifications, markRead, refresh } = useNotifications()

  const groups = useMemo(() => groupNotifications(notifications), [notifications])

  const handlePullToRefresh = useCallback(
    () => refresh().catch(() => undefined),
    [refresh]
  )

  // Every row on screen counts as seen, including ones that arrive while open.
  useEffect(() => {
    const unread = []
    for (const g of groups) {
      for (const r of g.rows) if (!r.read) unread.push(r.id)
    }
    if (unread.length > 0) markRead(unread)
  }, [groups, markRead])

  function handleTap(group) {
    const route = routeFor(group.lead)
    if (!route) return
    navigate(route.to, route.state ? { state: route.state } : undefined)
  }

  return (
    <AppShell>
      <PullToRefresh onRefresh={handlePullToRefresh}>
      <div className="notif-inbox">
        {/* Header */}
        <header className="notif-inbox__header">
          <button
            type="button"
            className="notif-inbox__back"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <LuChevronLeft size={22} />
          </button>
          <h1 className="notif-inbox__title">Notifications</h1>
          {/* Spacer keeps title centered */}
          <span className="notif-inbox__header-spacer" aria-hidden="true" />
        </header>

        {/* List */}
        <div className="notif-inbox__list" role="list">
          {groups.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              body="You'll see follows, likes, comments, mentions and answers to your questions here."
            />
          ) : (
            groups.map((g) => (
              <div key={g.lead.id} role="listitem">
                <NotificationItem group={g} onTap={() => handleTap(g)} />
              </div>
            ))
          )}
        </div>
      </div>
      </PullToRefresh>
    </AppShell>
  )
}

export default NotificationsInbox
