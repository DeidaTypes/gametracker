import React, { useCallback, useRef, useState } from 'react'
import { LuPlus } from 'react-icons/lu'
import Pressable from './Pressable'
import SharedCover from './SharedCover'
import { useMotionPreference } from '../hooks/useMotionPreference'
import {
  useIosLongPressDrag,
  findSlotIndexAtPoint,
} from '../hooks/useIosLongPressDrag'

// Matches ListDetail's settle so the lifted cover lands in its slot
// before the real array order commits (same point, no jump).
const REORDER_SETTLE_MS = 200

/**
 * Favorite-games cover row on the Profile Home tab.
 *
 * Own profile with 2+ games: long-press a cover to pick it up, drag to
 * reposition, release to persist. Visitor profiles (and a single-slot
 * own row) stay tap-to-open — no drag handlers attached.
 *
 * Card shape matches LibraryGameCard / ListDetail: outer div carries
 * the positional translate, pointer handlers live on a plain cover
 * div, tap/keyboard lives on an inner Pressable-as-div. A <button>
 * ancestor is what made iOS fire pointercancel on Library covers.
 */
export default function FavoriteGamesRow({
  games,
  isOwnProfile,
  onGameClick,
  onAdd,
  showAddSlot,
  onReorder,
}) {
  const { reduced } = useMotionPreference()
  const itemEls = useRef({})
  const [dragOrder, setDragOrder] = useState(null)
  const dragOrderRef = useRef(null)
  const gamesRef = useRef(games)
  const settleTimerRef = useRef(null)

  gamesRef.current = games
  dragOrderRef.current = dragOrder

  const canDrag = isOwnProfile && games.length > 1

  const getItemEl = useCallback((id) => itemEls.current[id], [])

  const {
    bindItem,
    dragId,
    suppressClickRef,
    sessionRef,
    applyDragTransform,
    scheduleDragTransform,
    hardResetDrag,
  } = useIosLongPressDrag({
    enabled: canDrag,
    getItemEl,
    onArm: (session) => {
      const current = gamesRef.current
      session.slotRects = current.map(
        (g) => itemEls.current[g.id]?.getBoundingClientRect() || null
      )
      setDragOrder(current.map((g) => g.id))
    },
    onMove: (session, { dx, dy, clientX, clientY }) => {
      scheduleDragTransform(session, dx, dy)
      const overIndex = findSlotIndexAtPoint(clientX, clientY, session.slotRects)
      if (overIndex === -1) return
      setDragOrder((prev) => {
        if (!prev) return prev
        const from = prev.indexOf(session.id)
        if (from === -1 || from === overIndex) return prev
        const next = [...prev]
        next.splice(from, 1)
        next.splice(overIndex, 0, session.id)
        return next
      })
    },
    onRelease: (session) => {
      const current = gamesRef.current
      const finalOrder = dragOrderRef.current || current.map((g) => g.id)
      const originalIndex = current.findIndex((g) => g.id === session.id)
      const finalIndex = finalOrder.indexOf(session.id)
      const origin = session.slotRects?.[originalIndex]
      const dest = session.slotRects?.[finalIndex]
      if (origin && dest) {
        applyDragTransform(
          session.id,
          dest.left - origin.left,
          dest.top - origin.top,
          reduced ? '' : `transform ${REORDER_SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`
        )
      }

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        const byId = new Map(current.map((g) => [g.id, g]))
        const next = finalOrder.map((id) => byId.get(id)).filter(Boolean)
        const lengthOk = next.length === current.length
        const unchanged =
          lengthOk && next.every((g, i) => g.id === current[i].id)

        // Commit first, then drop the overlay transform — dest slot and
        // the post-commit natural position are the same point.
        if (lengthOk && !unchanged) onReorder?.(next)
        hardResetDrag(session.id)
        setDragOrder(null)
      }, reduced ? 0 : REORDER_SETTLE_MS)
    },
    onCancel: () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      setDragOrder(null)
    },
  })

  const handleTap = (game) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onGameClick?.(game)
  }

  return (
    <div
      className={`profile-favorites-row${dragId != null ? ' profile-favorites-row--dragging' : ''}`}
      role="list"
    >
      {games.map((g, originalIndex) => {
        const isDragged = dragId === g.id
        const isDragActive = dragId != null
        const pointerBind = canDrag ? bindItem(g.id) : {}

        let shiftStyle
        if (
          isDragActive &&
          !isDragged &&
          dragOrder &&
          sessionRef.current?.slotRects
        ) {
          const slotRects = sessionRef.current.slotRects
          const currentIndex = dragOrder.indexOf(g.id)
          const origin = slotRects[originalIndex]
          const dest = slotRects[currentIndex]
          if (origin && dest && currentIndex !== originalIndex) {
            shiftStyle = {
              transform: `translate3d(${dest.left - origin.left}px, ${dest.top - origin.top}px, 0)`,
            }
          }
        }

        return (
          <div
            key={g.id}
            ref={(el) => {
              if (el) itemEls.current[g.id] = el
              else delete itemEls.current[g.id]
            }}
            role="listitem"
            className={`profile-favorite-card${isDragged ? ' profile-favorite-card--dragged' : ''}${
              isDragActive && !isDragged ? ' profile-favorite-card--shift' : ''
            }`}
            style={shiftStyle}
            {...pointerBind}
          >
            <div
              className={`profile-favorite-card__cover${
                isDragged ? ' profile-favorite-card__cover--lifted' : ''
              }`}
            >
              <Pressable
                as="div"
                role="button"
                tabIndex={0}
                className="profile-favorite-card__tap"
                whileTap={{ scale: 1 }}
                onClick={() => handleTap(g)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleTap(g)
                  }
                }}
                aria-label={g.title ? `Open ${g.title}` : 'Open game'}
              >
                {g.image ? (
                  <SharedCover gameId={g.id} imageSrc={g.image}>
                    <img src={g.image} alt={g.title} loading="lazy" draggable={false} />
                  </SharedCover>
                ) : (
                  <span className="profile-favorite-card__fallback">
                    {g.title?.charAt(0) || '?'}
                  </span>
                )}
              </Pressable>
            </div>
            <span
              className="profile-favorite-card__name"
              onClick={() => handleTap(g)}
            >
              {g.title}
            </span>
            {g.developer && (
              <span className="profile-favorite-card__dev">
                {g.developer}
              </span>
            )}
            {g.why && (
              <span className="profile-favorite-card__why">
                {g.why}
              </span>
            )}
          </div>
        )
      })}
      {showAddSlot && (
        <button
          type="button"
          role="listitem"
          className="profile-favorite-card profile-favorite-card--add"
          onClick={onAdd}
          aria-label="Add a favorite game"
        >
          <span className="profile-favorite-card__cover profile-favorite-card__cover--add">
            <LuPlus size={22} aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  )
}
