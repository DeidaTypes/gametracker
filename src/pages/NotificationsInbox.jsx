import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Bell } from 'lucide-react'
import { useNotifications } from '../contexts/NotificationsContext'
import AppShell from '../components/AppShell'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
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
 * Human-readable sentence for a notification type.
 * Returns { action, suffix } where action is the verb phrase
 * and suffix is any trailing clause (e.g. " your review" for comment).
 */
function notificationText(type) {
  switch (type) {
    case 'follow':
      return { action: 'started following you', suffix: '' }
    case 'reaction':
      return { action: 'reacted to', suffix: ' your review' }
    case 'comment':
      return { action: 'commented on', suffix: ' your review' }
    case 'friend_started':
      return { action: 'started playing', suffix: ' a game in your backlog' }
    default:
      return { action: 'interacted with you', suffix: '' }
  }
}

/**
 * Route to navigate to when the notification is tapped.
 * entity_id is the review UUID for reaction/comment, the IGDB game id
 * (string) for friend_started, or null for follow.
 */
function entityRoute(type, entityId, actor) {
  switch (type) {
    case 'follow':
      return actor?.username ? `/profile/${actor.username}` : '/'
    case 'reaction':
    case 'comment':
      return entityId ? `/review/${entityId}` : '/'
    case 'friend_started':
      return entityId ? `/game/${entityId}` : '/'
    default:
      return '/'
  }
}

/* ============================================================
   Notification item
   ============================================================ */

function NotificationItem({ notification, onTap }) {
  const { type, entity_id: entityId, read, created_at: createdAt, actor } = notification
  const actorName = actor?.display_name || actor?.username || 'Someone'
  const { action, suffix } = notificationText(type)
  const time = relativeTime(createdAt)

  return (
    <button
      type="button"
      className={`notif-item ${read ? '' : 'notif-item--unread'}`}
      onClick={onTap}
      aria-label={`${actorName} ${action}${suffix}`}
    >
      <div className="notif-item__avatar-wrap">
        <Avatar user={actor} name={actorName} size="md" className="notif-item__avatar" />
      </div>

      <div className="notif-item__body">
        <p className="notif-item__text">
          <span className="notif-item__actor">{actorName}</span>
          {' '}
          <span className="notif-item__action">{action}</span>
          {suffix && <span className="notif-item__suffix">{suffix}</span>}
        </p>
        <time className="notif-item__time" dateTime={createdAt}>
          {time}
        </time>
      </div>

      {!read && <span className="notif-item__dot" aria-hidden="true" />}
    </button>
  )
}

/* ============================================================
   Page
   ============================================================ */

function NotificationsInbox() {
  const navigate = useNavigate()
  const { notifications, markAllRead } = useNotifications()

  // Mark all read the moment the inbox opens.
  useEffect(() => {
    markAllRead()
  }, [markAllRead])

  function handleTap(notification) {
    const route = entityRoute(
      notification.type,
      notification.entity_id,
      notification.actor
    )
    navigate(route)
  }

  return (
    <AppShell>
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
          {notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              body="You'll see follows, reactions, comments, and friend activity here."
            />
          ) : (
            notifications.map((n) => (
              <div key={n.id} role="listitem">
                <NotificationItem
                  notification={n}
                  onTap={() => handleTap(n)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default NotificationsInbox
