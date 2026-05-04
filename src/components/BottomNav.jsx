import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  HiOutlineHome,
  HiHome,
  HiOutlineGlobe,
  HiGlobe,
  HiOutlineSearch,
  HiSearch,
  HiOutlineBookOpen,
  HiBookOpen,
  HiOutlineUser,
  HiUser,
} from 'react-icons/hi'
import { useTabBarCompact } from '../hooks/useTabBarCompact'
import { useGameColor } from '../contexts/GameColorContext'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', Outline: HiOutlineHome, Solid: HiHome },
  { to: '/explore', label: 'Explore', Outline: HiOutlineGlobe, Solid: HiGlobe },
  { to: '/search', label: 'Search', Outline: HiOutlineSearch, Solid: HiSearch },
  { to: '/library', label: 'Library', Outline: HiOutlineBookOpen, Solid: HiBookOpen },
  { to: '/profile', label: 'Profile', Outline: HiOutlineUser, Solid: HiUser },
]

/**
 * Bottom tab bar with iOS-26 shrink-on-scroll behavior.
 *
 * The bar listens (via <useTabBarCompact>) to the shared `.main-content`
 * scroll container that App renders. Scrolling DOWN past 60 px collapses
 * the bar into a centered floating pill (~70% width, 28px radius, lifted
 * 8 px above the bottom edge); labels fade out, only icons remain.
 * Scrolling UP — or returning within 60 px of the top — re-expands it to
 * the full-width flush bar.
 *
 * Animation: motion's `layout` prop drives width / border-radius / position
 * via FLIP using a spring (stiffness 280, damping 30). Label opacity
 * cross-fades in parallel.
 *
 * Reduced-motion: the layout still toggles (functional behavior preserved)
 * but the spring is replaced with a zero-duration transition so the change
 * is instant.
 */
function BottomNav({ scrollContainerRef }) {
  const location = useLocation()
  const compact = useTabBarCompact(scrollContainerRef)
  const reduced = useReducedMotion()
  const { swatches } = useGameColor()

  if (location.pathname === '/onboarding') {
    return null
  }

  const layoutTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 280, damping: 30 }

  // Labels cross-fade slightly faster than the layout spring settles, so the
  // pill never flashes a half-faded label mid-flight.
  const labelTransition = reduced
    ? { duration: 0 }
    : { duration: 0.18, ease: 'easeOut' }

  // When a game detail page is active, override the amber accent with the
  // game's vibrant swatch via a CSS custom property.  The CSS transitions
  // on `.bottom-nav-item.active` pick up the change and animate over 280ms.
  const accentStyle = swatches
    ? {
        '--nav-accent': `rgb(${swatches.vibrant.r},${swatches.vibrant.g},${swatches.vibrant.b})`,
        '--nav-accent-glow': `rgba(${swatches.vibrant.r},${swatches.vibrant.g},${swatches.vibrant.b},0.65)`,
      }
    : undefined

  return (
    <motion.nav
      className={`bottom-nav ${compact ? 'compact' : ''}`}
      style={accentStyle}
      layout
      transition={layoutTransition}
    >
      {NAV_ITEMS.map(({ to, label, Outline, Solid }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `bottom-nav-item ${isActive ? 'active' : ''}`
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <Solid className="bottom-nav-icon" />
              ) : (
                <Outline className="bottom-nav-icon" />
              )}
              <motion.span
                className="bottom-nav-label"
                animate={{ opacity: compact ? 0 : 1 }}
                transition={labelTransition}
                aria-hidden={compact || undefined}
              >
                {label}
              </motion.span>
            </>
          )}
        </NavLink>
      ))}
    </motion.nav>
  )
}

export default BottomNav
