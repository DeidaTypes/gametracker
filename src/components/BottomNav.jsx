import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { House, Compass, BookCopy, User, MessageCircleQuestionMark as MessageCircleQuestion } from 'lucide-react'
import { useUnreadMessages } from '../contexts/UnreadMessagesContext'
import { useAuth } from '../contexts/AuthContext'
import { peekSWR, subscribeSWR } from '../services/swrCache'
import { qaHomeKey } from '../services/qaService'
import { hapticImpact } from '../utils/haptics'
import AdBanner from './AdBanner'
import './BottomNav.css'

// Fired by ListDetail's long-press drag-to-reorder interaction so this
// globally-mounted nav (rendered once in App.jsx, outside any page's
// component tree) can slide out of the way while a grid item is being
// dragged, and slide back once the drag session ends. detail: { active }.
export const LIST_REORDER_DRAG_EVENT = 'gt:listReorderDragActive'

/**
 * Cobalt-Modern floating-pill bottom navigation.
 *
 * Icon-only tabs (Home, Discover, Q&A, Library, Profile — Q&A is built in
 * for every account, no flag read) sit in a centered pill that floats
 * 12 px above the bottom of the viewport. The active tab
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
/**
 * Last tab root the user landed on. Pushed screens (/game, /qa/game, …)
 * are not roots, so this stays until the next tab tap. Q&A subroutes
 * light the Q&A tab only while this is 'qa'. No other tab's isActive
 * includes /qa/*, same as /game, which no tab claims.
 */
let tabOrigin = null

const TAB_ROOT_ORIGIN = {
  '/': 'home',
  '/home': 'home',
  '/discover': 'discover',
  '/explore': 'discover',
  '/library': 'library',
  '/profile': 'profile',
  '/qa': 'qa',
}

function rememberTabOrigin(pathname) {
  const id = TAB_ROOT_ORIGIN[pathname]
  if (id) tabOrigin = id
}

if (typeof window !== 'undefined') {
  window.addEventListener('gt:user-data-cleared', () => {
    tabOrigin = null
  })
}

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

const QA_ITEM = {
  id: 'qa',
  to: '/qa',
  label: 'Q&A',
  Icon: MessageCircleQuestion,
  // /qa always. /qa/* only when the push started on the Q&A tab.
  // A push from another tab (or a cold deep link) leaves every tab dark.
  isActive: (path) => path === '/qa' || (path.startsWith('/qa/') && tabOrigin === 'qa'),
}

// Home, Discover, Q&A, Library, Profile. Fixed for every account.
const FIVE_ITEMS = [NAV_ITEMS[0], NAV_ITEMS[1], QA_ITEM, NAV_ITEMS[2], NAV_ITEMS[3]]

function inboxHasNew(data) {
  return data?.inbox_has_new === true
}

function BottomNav({ scrollHidden = false }) {
  const location = useLocation()
  const { user } = useAuth()
  const { unreadCount } = useUnreadMessages()
  const homeKey = qaHomeKey(user?.id)
  const [inboxNew, setInboxNew] = useState(() => inboxHasNew(homeKey ? peekSWR(homeKey) : undefined))
  const [dragReorderActive, setDragReorderActive] = useState(false)
  const navRef = useRef(null)

  rememberTabOrigin(location.pathname)

  useEffect(() => {
    if (!homeKey) {
      setInboxNew(false)
      return undefined
    }
    setInboxNew(inboxHasNew(peekSWR(homeKey)))
    return subscribeSWR(homeKey, (next) => setInboxNew(inboxHasNew(next)))
  }, [homeKey])

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

  // Tab changes are instant. The pill moves with no travel animation.
  const pillTransition = { duration: 0 }

  const visuallyHidden = dragReorderActive || scrollHidden

  return (
    <>
    {/* Free-user ad slot. Mounted here (and only here) so it exists exactly
        where the pill does, and hides whenever the pill hides. */}
    <AdBanner navRef={navRef} navHidden={visuallyHidden} />
    <nav
      ref={navRef}
      className={`bottom-nav bottom-nav--five${
        dragReorderActive ? ' bottom-nav--hidden' : ''
      }${scrollHidden && !dragReorderActive ? ' bottom-nav--scroll-hidden' : ''}`}
      aria-label="Primary"
      aria-hidden={visuallyHidden || undefined}
    >
      {FIVE_ITEMS.map(({ id, to, label, Icon, isActive }) => {
        const active = isActive(location.pathname)
        // Profile tab carries the unread-DM dot — there's no dedicated
        // Messages nav tab (out of scope, see BottomNav module docstring),
        // so this is what tells a user there's something to check. The
        // actual inbox entry point is a message-bubble icon in the
        // profile header (ProfilePlayerCard, own profile only), which
        // carries the same dot so the signal is consistent end to end.
        const showUnreadDot = id === 'profile' && unreadCount > 0
        // Q&A dot reads the cached home payload. Hidden while the tab is
        // active — the inbox button on the screen carries it then.
        const showQaDot = id === 'qa' && inboxNew && !active
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
              {showQaDot && (
                <span
                  className="bottom-nav-unread bottom-nav-unread--qa"
                  aria-label="New answers"
                />
              )}
            </span>
          </Link>
        )
      })}
    </nav>
    </>
  )
}

export default BottomNav
