import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { House, Compass, BookCopy, User } from 'lucide-react'
import { useUnreadMessages } from '../contexts/UnreadMessagesContext'
import './BottomNav.css'

// Fired by ListDetail's long-press drag-to-reorder interaction so this
// globally-mounted nav (rendered once in App.jsx, outside any page's
// component tree) can slide out of the way while a grid item is being
// dragged, and slide back once the drag session ends. detail: { active }.
export const LIST_REORDER_DRAG_EVENT = 'gt:listReorderDragActive'

/**
 * Cobalt-Modern floating-pill bottom navigation.
 *
 * Four icon-only tabs (Home, Discover, Library, Profile) sit in a centered
 * pill that floats 12 px above the bottom of the viewport. The active tab
 * is highlighted with a cobalt pill that visually slides from the
 * previously-active tab via Framer Motion's `layoutId` shared element.
 *
 * Notes:
 *   - "Discover" merges the legacy Explore + Search tabs. The /explore and
 *     /search routes both still resolve (App.jsx aliases /explore → the
 *     same component as /discover); this tab reads as active for any of
 *     /discover, /explore, /search, or /browse/*.
 *   - Reduced-motion users get an instant transition instead of the
 *     spring (no animation at all between tab states).
 *   - Capacitor Haptics fires a light impact on tap when running in the
 *     native iOS shell. The import is dynamic + try/catch so the web
 *     build is a no-op when the plugin is unavailable.
 */
const NAV_ITEMS = [
  {
    id: 'home',
    to: '/',
    label: 'Home',
    Icon: House,
    isActive: (path) => path === '/' || path === '/home',
  },
  {
    id: 'discover',
    to: '/discover',
    label: 'Discover',
    Icon: Compass,
    isActive: (path) =>
      path.startsWith('/discover') ||
      path.startsWith('/explore') ||
      path.startsWith('/search') ||
      path.startsWith('/browse'),
  },
  {
    id: 'library',
    to: '/library',
    label: 'Library',
    Icon: BookCopy,
    isActive: (path) =>
      path.startsWith('/library') ||
      path.startsWith('/wishlist') ||
      path.startsWith('/list/') ||
      path.startsWith('/smart-list/'),
  },
  {
    id: 'profile',
    to: '/profile',
    label: 'Profile',
    Icon: User,
    isActive: (path) =>
      path.startsWith('/profile') ||
      path.startsWith('/messages') ||
      path.startsWith('/stats'),
  },
]

// Light haptic on tab change. Mirrors src/utils/share.js — dynamic import
// + try/catch so missing-plugin / web builds quietly no-op.
async function triggerHaptic() {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}

function BottomNav() {
  const location = useLocation()
  const reduced = useReducedMotion()
  const { unreadCount } = useUnreadMessages()
  const [dragReorderActive, setDragReorderActive] = useState(false)

  useEffect(() => {
    const handler = (e) => setDragReorderActive(!!e.detail?.active)
    window.addEventListener(LIST_REORDER_DRAG_EVENT, handler)
    return () => window.removeEventListener(LIST_REORDER_DRAG_EVENT, handler)
  }, [])

  // Safety net — always show the nav again on route change, in case a
  // drag session was ever interrupted in a way that skipped its own
  // cleanup (e.g. the page unmounted mid-drag).
  useEffect(() => {
    setDragReorderActive(false)
  }, [location.pathname])

  // Hide on onboarding (App.jsx already guards auth/login screens).
  if (location.pathname === '/onboarding') return null

  // Per spec: spring stiffness 380 / damping 30; instant for reduced-motion.
  const pillTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 30 }

  return (
    <nav
      className={`bottom-nav${dragReorderActive ? ' bottom-nav--hidden' : ''}`}
      aria-label="Primary"
      aria-hidden={dragReorderActive || undefined}
    >
      {NAV_ITEMS.map(({ id, to, label, Icon, isActive }) => {
        const active = isActive(location.pathname)
        // Profile tab carries the unread-DM dot until messages get their
        // own slot (Prompt 4 will add a dedicated entry point).
        const showUnreadDot = id === 'profile' && unreadCount > 0
        return (
          <Link
            key={id}
            to={to}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic()
            }}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                className="bottom-nav-pill"
                transition={pillTransition}
                aria-hidden="true"
              />
            )}
            <span className="bottom-nav-icon-wrap">
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              {showUnreadDot && (
                <span
                  className="bottom-nav-unread"
                  aria-label={`${unreadCount} unread messages`}
                />
              )}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

export default BottomNav
