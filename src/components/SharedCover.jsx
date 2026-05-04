import React, { createContext, useContext, useMemo } from 'react'
import { motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './SharedCover.css'

// Module-level cache of the most recently rendered cover image URL per
// gameId. Updated on every SharedCover render so that GameDetail can use
// the source image as an immediate placeholder during a shared-element
// flight (before the higher-res IGDB cover_big has loaded).
const coverCache = new Map()

export function getRecentCoverImage(gameId) {
  if (gameId == null) return null
  return coverCache.get(String(gameId)) || null
}

export function findDuplicateGameIds(...gameLists) {
  const counts = new Map()
  for (const list of gameLists) {
    if (!list) continue
    for (const g of list) {
      if (!g?.id) continue
      const key = String(g.id)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const dups = new Set()
  for (const [id, c] of counts) {
    if (c > 1) dups.add(id)
  }
  return dups
}

const EMPTY_DUPS = new Set()
const DupContext = createContext(EMPTY_DUPS)

/**
 * Wrap a region of the tree where the same gameId may appear more than
 * once (e.g. Library page showing a game in multiple trackers + custom
 * lists). Compute the duplicate set with `findDuplicateGameIds(...)` and
 * pass it in. Duplicates render their cover *without* a layoutId so
 * Motion never has an ambiguous shared-element match.
 */
export function SharedCoverScope({ duplicateIds, children }) {
  return (
    <DupContext.Provider value={duplicateIds || EMPTY_DUPS}>
      {children}
    </DupContext.Provider>
  )
}

/**
 * Wraps a cover (typically an <img>) in a `motion.div` carrying the
 * shared layoutId `game-cover-${gameId}`. When navigation moves between
 * a source page (with this cover) and the GameDetail page (whose hero
 * poster also has this layoutId), Motion runs a shared-element flight
 * coordinated by the AnimatePresence at the route level.
 *
 * Props:
 *   - gameId    IGDB game id (required for transition; if missing we
 *               render a plain wrapper with no layoutId).
 *   - imageSrc  optional source URL — recorded so GameDetail can use it
 *               as a placeholder while cover_big loads.
 *   - disabled  caller-side override to drop the layoutId for this
 *               instance (e.g. duplicate covers when SharedCoverScope
 *               isn't being used).
 *   - children  the actual cover content (typically <img>).
 */
export default function SharedCover({
  gameId,
  imageSrc,
  disabled = false,
  children,
}) {
  const dups = useContext(DupContext)
  const { reduced, transition } = useMotionPreference()

  if (gameId != null && imageSrc) {
    // Direct write during render is safe — this is a module-level cache,
    // not React state, and the value is idempotent per (gameId, imageSrc).
    coverCache.set(String(gameId), imageSrc)
  }

  const isDup = gameId != null && dups.has(String(gameId))
  const skip = disabled || isDup || gameId == null

  // Reduced-motion: cross-fade only at 120ms per the motion system spec.
  // Otherwise: spring 320 / 28 sourced from useMotionPreference.
  const t = useMemo(
    () => (reduced ? { duration: 0.12 } : transition),
    [reduced, transition]
  )

  if (skip) {
    return <div className="shared-cover-frame">{children}</div>
  }

  return (
    <motion.div
      layoutId={`game-cover-${gameId}`}
      className="shared-cover-frame"
      transition={t}
    >
      {children}
    </motion.div>
  )
}
