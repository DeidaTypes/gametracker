import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { House, Compass, BookCopy, User } from 'lucide-react'
import { useUnreadMessages } from '../contexts/UnreadMessagesContext'
import { hapticImpact } from '../utils/haptics'
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
 * is highlighted with a pill that visually slides from the previously-active
 * tab via Framer Motion's `layoutId` shared element. The nav bar chrome
 * (surface, border, shape, inactive icons) is identical on every screen —
 * only the active pill's gradient tints per tab, via the `data-tab`
 * attribute below driving the `--grad-nav-*` / `--glow-nav-*` tokens in
 * BottomNav.css (see theme.css for the token definitions).
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
        // Profile tab carries the unread-DM dot — there's no dedicated
        // Messages nav tab (out of scope, see BottomNav module docstring),
        // so this is what tells a user there's something to check. The
        // actual inbox entry point is a message-bubble icon in the
        // profile header (ProfilePlayerCard, own profile only), which
        // carries the same dot so the signal is consistent end to end.
        const showUnreadDot = id === 'profile' && unreadCount > 0
        return (
          <Link
            key={id}
            to={to}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            data-tab={id}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => {
              hapticImpact('Light')
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
