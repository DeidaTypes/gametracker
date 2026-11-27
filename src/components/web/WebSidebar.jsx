import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, MessageCircle, Search, Settings, Plus } from 'lucide-react'
import {
  FIVE_ITEMS,
  TAB_ROOT_ORIGIN,
  TAB_RESELECT_EVENT,
  syncTabOrigin,
} from '../BottomNav'
import { RADIAL_ITEMS } from '../HomeFAB'
import { useAuth } from '../../contexts/AuthContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { useUnreadMessages } from '../../contexts/UnreadMessagesContext'
import { useLevel } from '../../hooks/useLevel'
import { useQuickAddActions } from '../../hooks/useQuickAddActions'
import { hapticImpact } from '../../utils/haptics'
import Avatar from '../Avatar'
import './WebSidebar.css'

function isTextFieldTarget(el) {
  if (!el || typeof el !== 'object') return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

function CountBadge({ count, className = '' }) {
  if (!count || count < 1) return null
  return (
    <span className={`web-sidebar__count ${className}`.trim()} aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function WebSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { unreadCount: notifUnread } = useNotifications()
  const { unreadCount: messageUnread } = useUnreadMessages()
  const { level } = useLevel(user?.id)
  const [newOpen, setNewOpen] = useState(false)
  const newWrapRef = useRef(null)

  syncTabOrigin(location.pathname)

  const onTabRoot = TAB_ROOT_ORIGIN[location.pathname]
  const displayName = profile?.displayName || profile?.username || 'Account'

  const closeNewMenu = useCallback(() => setNewOpen(false), [])

  const { runQuickAction, quickAddPortals } = useQuickAddActions({
    onInvoke: closeNewMenu,
  })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextFieldTarget(document.activeElement)) return
      e.preventDefault()
      navigate('/search')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => {
    if (!newOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') closeNewMenu()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [newOpen, closeNewMenu])

  useEffect(() => {
    if (!newOpen) return undefined
    const onPointer = (e) => {
      const root = newWrapRef.current
      if (root && !root.contains(e.target)) closeNewMenu()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [newOpen, closeNewMenu])

  const secondaryLinks = [
    { to: '/search', label: 'Search', Icon: Search, count: 0 },
    { to: '/notifications', label: 'Notifications', Icon: Bell, count: notifUnread },
    { to: '/messages', label: 'Messages', Icon: MessageCircle, count: messageUnread },
  ]

  return (
    <>
      <aside className="web-sidebar" aria-label="App navigation">
        <div className="web-sidebar__scroll">
          <Link to="/" className="web-sidebar__brand" aria-label="Checkpoint home">
            <img
              className="web-sidebar__mascot"
              src="/brand/checkpoint-splash-1x.png"
              srcSet="/brand/checkpoint-splash-1x.png 1x, /brand/checkpoint-splash-2x.png 2x, /brand/checkpoint-splash-3x.png 3x"
              alt=""
              width={26}
              height={42}
              decoding="async"
            />
            <span className="web-sidebar__wordmark text-title">Checkpoint</span>
          </Link>

          <nav className="web-sidebar__tabs" aria-label="Primary tabs">
            {FIVE_ITEMS.map(({ id, to, label, Icon, isActive }) => {
              const active = isActive(location.pathname)
              return (
                <Link
                  key={id}
                  to={to}
                  aria-label={label}
                  className={`web-sidebar__tab${active ? ' web-sidebar__tab--active' : ''}`}
                  data-tab={id}
                  aria-current={active ? 'page' : undefined}
                  onClick={(e) => {
                    hapticImpact('Light')
                    if (onTabRoot === id) {
                      e.preventDefault()
                      window.dispatchEvent(new CustomEvent(TAB_RESELECT_EVENT))
                    }
                  }}
                >
                  <Icon className="web-sidebar__tab-icon" size={20} aria-hidden="true" />
                  <span className="web-sidebar__tab-label">{label}</span>
                </Link>
              )
            })}
          </nav>

          <hr className="web-sidebar__rule" />

          <nav className="web-sidebar__secondary" aria-label="Tools">
            {secondaryLinks.map(({ to, label, Icon, count }) => {
              const active = location.pathname === to || location.pathname.startsWith(`${to}/`)
              return (
                <Link
                  key={to}
                  to={to}
                  className={`web-sidebar__secondary-link${active ? ' web-sidebar__secondary-link--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="web-sidebar__secondary-icon-wrap">
                    <Icon size={20} aria-hidden="true" />
                    {count > 0 && (
                      <>
                        <CountBadge count={count} className="web-sidebar__count--wide" />
                        <span className="web-sidebar__dot" aria-hidden="true" />
                      </>
                    )}
                  </span>
                  <span className="web-sidebar__secondary-label">{label}</span>
                  {count > 0 && (
                    <CountBadge
                      count={count}
                      className="web-sidebar__count--trail"
                    />
                  )}
                  {count > 0 && (
                    <span className="web-sidebar__sr-only">{`, ${count} unread`}</span>
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="web-sidebar__new-wrap" ref={newWrapRef}>
            <button
              type="button"
              className="web-sidebar__new-btn"
              aria-expanded={newOpen}
              aria-haspopup="menu"
              onClick={() => setNewOpen((v) => !v)}
            >
              <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
              <span className="web-sidebar__new-label">New</span>
            </button>
            {newOpen && (
              <div className="web-sidebar__new-menu" role="menu" aria-label="Quick actions">
                {RADIAL_ITEMS.map(({ id, Icon, ariaLabel }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className="web-sidebar__new-item"
                    onClick={() => runQuickAction(id)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{ariaLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="web-sidebar__account">
          <Link to="/profile" className="web-sidebar__account-main">
            <Avatar user={profile} userId={user?.id} name={displayName} size="sm" />
            <span className="web-sidebar__account-text">
              <span className="web-sidebar__account-name text-body">{displayName}</span>
              <span className="web-sidebar__account-level text-caption">
                {`Level ${level ?? '…'}`}
              </span>
            </span>
          </Link>
          <Link
            to="/settings"
            className="web-sidebar__settings"
            aria-label="Settings"
          >
            <Settings size={20} aria-hidden="true" />
          </Link>
        </div>
      </aside>
      {quickAddPortals}
    </>
  )
}

export default WebSidebar