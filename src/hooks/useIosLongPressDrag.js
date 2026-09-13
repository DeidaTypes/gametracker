import { useCallback, useEffect, useRef, useState } from 'react'
import { LIST_REORDER_DRAG_EVENT } from '../components/BottomNav'
import { PULL_TO_REFRESH_YIELD_EVENT } from '../components/PullToRefresh'
import { hapticImpact } from '../utils/haptics'

// Same gates as Library My Games drag-to-trash and ListDetail reorder.
// Do not invent new thresholds — these are the values that survived
// five rounds of iOS gesture arbitration.
export const LONG_PRESS_MS = 450
export const MOVE_CANCEL_PX = 8

/**
 * Index of the slot whose snapshotted bounds contain (x, y), or -1.
 * Shared with ListDetail's reorder hit-test.
 */
export function findSlotIndexAtPoint(x, y, slotRects) {
  for (let i = 0; i < slotRects.length; i++) {
    const r = slotRects[i]
    if (!r) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
  }
  return -1
}

function setPullToRefreshYield(active) {
  window.dispatchEvent(
    new CustomEvent(PULL_TO_REFRESH_YIELD_EVENT, { detail: { active } })
  )
}

/**
 * iOS-hardened long-press drag armature.
 *
 * Extracted from Library.jsx (My Games drag-to-trash) so Profile
 * favorites reorder — and any future cover drag — can reuse the
 * lessons instead of rediscovering them. Library and ListDetail keep
 * their in-page copies for now; this hook is the shared path going
 * forward.
 *
 * Four coordinated defenses — do not strip any of them:
 *   1. Caller MUST put user-select / touch-callout: none on the drag
 *      surface and its children. Native text selection steals the
 *      touch and fires pointercancel a few hundred ms into a hold.
 *   2. captureEl.style.touchAction = 'none' synchronously at
 *      pointerdown — must land this tick so UA gesture arbitration
 *      sees it at start. A React class applied 450ms later is too late.
 *   3. PullToRefresh yield at pointerdown — PTR races the same finger
 *      from scrollTop === 0 and must stand down now, not at arm.
 *   4. lockScrollContainer (.main-content overflow: hidden) + a
 *      non-passive native touchmove listener on arm. Locking only the
 *      dragged element does not stop ancestor momentum; React 18
 *      registers touch listeners as passive, so preventDefault on a
 *      synthetic pointermove may be silently ignored in WKWebView.
 *
 * Haptics: Medium impact on arm (same sequence as Library / ListDetail
 * pickup). Callers own Light / Success for their own drop targets.
 *
 * @param {{
 *   enabled?: boolean,
 *   getItemEl: (id: string|number) => HTMLElement|null|undefined,
 *   onArm?: (session: object) => void,
 *   onMove?: (session: object, info: { dx: number, dy: number, clientX: number, clientY: number, event: PointerEvent }) => void,
 *   onRelease?: (session: object) => void,
 *   onCancel?: (session: object) => void,
 *   shouldStart?: (id: string|number, event: PointerEvent) => boolean,
 * }} options
 */
export function useIosLongPressDrag({
  enabled = true,
  getItemEl,
  onArm,
  onMove,
  onRelease,
  onCancel,
  shouldStart,
} = {}) {
  const [dragId, setDragId] = useState(null)

  const dragSessionRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const scrollLockRef = useRef(null)
  const suppressClickRef = useRef(false)

  const enabledRef = useRef(enabled)
  const getItemElRef = useRef(getItemEl)
  const onArmRef = useRef(onArm)
  const onMoveRef = useRef(onMove)
  const onReleaseRef = useRef(onRelease)
  const onCancelRef = useRef(onCancel)
  const shouldStartRef = useRef(shouldStart)
  enabledRef.current = enabled
  getItemElRef.current = getItemEl
  onArmRef.current = onArm
  onMoveRef.current = onMove
  onReleaseRef.current = onRelease
  onCancelRef.current = onCancel
  shouldStartRef.current = shouldStart

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const releasePreArmLock = useCallback((session) => {
    if (session?.captureEl) session.captureEl.style.touchAction = ''
    setPullToRefreshYield(false)
  }, [])

  const lockScrollContainer = useCallback((captureEl) => {
    if (scrollLockRef.current) return
    const scrollEl = captureEl?.closest('.main-content')
    if (!scrollEl) return
    const scrollTop = scrollEl.scrollTop
    scrollLockRef.current = { el: scrollEl, scrollTop }
    scrollEl.style.overflow = 'hidden'
    scrollEl.scrollTop = scrollTop
  }, [])

  const unlockScrollContainer = useCallback(() => {
    const lock = scrollLockRef.current
    if (!lock) return
    scrollLockRef.current = null
    lock.el.style.overflow = ''
    lock.el.scrollTop = lock.scrollTop
  }, [])

  const addNonPassiveTouchMoveBlock = useCallback((session) => {
    if (!session.captureEl || session.touchMoveBlockAdded) return
    session.touchMoveBlockAdded = true
    session.onNativeTouchMove = (te) => {
      if (te.cancelable) te.preventDefault()
    }
    session.captureEl.addEventListener('touchmove', session.onNativeTouchMove, {
      passive: false,
    })
  }, [])

  const removeNonPassiveTouchMoveBlock = useCallback((session) => {
    if (!session?.touchMoveBlockAdded) return
    session.touchMoveBlockAdded = false
    session.captureEl?.removeEventListener('touchmove', session.onNativeTouchMove)
    session.onNativeTouchMove = null
  }, [])

  const applyDragTransform = useCallback((id, dx, dy, transition) => {
    const el = getItemElRef.current?.(id)
    if (!el) return
    el.style.transition = transition || ''
    el.style.willChange = 'transform'
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }, [])

  const scheduleDragTransform = useCallback((session, dx, dy) => {
    session.pendingDx = dx
    session.pendingDy = dy
    if (session.rafId != null) return
    session.rafId = requestAnimationFrame(() => {
      session.rafId = null
      if (dragSessionRef.current !== session || !session.activated) return
      applyDragTransform(session.id, session.pendingDx, session.pendingDy)
    })
  }, [applyDragTransform])

  const hardResetDrag = useCallback((id, { clearTransform = true } = {}) => {
    clearLongPressTimer()
    const session = dragSessionRef.current
    releasePreArmLock(session)
    removeNonPassiveTouchMoveBlock(session)
    unlockScrollContainer()
    if (session?.rafId != null) {
      cancelAnimationFrame(session.rafId)
      session.rafId = null
    }
    const el = id != null ? getItemElRef.current?.(id) : null
    if (el && clearTransform) {
      el.style.transform = ''
      el.style.transition = ''
      el.style.willChange = ''
    }
    dragSessionRef.current = null
    setDragId(null)
    window.dispatchEvent(
      new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
    )
  }, [
    clearLongPressTimer,
    releasePreArmLock,
    removeNonPassiveTouchMoveBlock,
    unlockScrollContainer,
  ])

  const handlePointerDown = useCallback((e, id) => {
    if (!enabledRef.current) return
    if (shouldStartRef.current && !shouldStartRef.current(id, e)) return
    if (dragSessionRef.current) return

    const captureEl = e.currentTarget
    const startTime = performance.now()
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      // Capture-reject fallback — long-press still arms; move/up may
      // not fire if the finger leaves this element.
    }

    // Synchronous, same-tick lock — UA gesture arbitration sees this
    // at start, not 450ms later via a class React hasn't rendered yet.
    captureEl.style.touchAction = 'none'
    setPullToRefreshYield(true)

    const session = {
      id,
      pointerId: e.pointerId,
      captureEl,
      startTime,
      startClientX: e.clientX,
      startClientY: e.clientY,
      activated: false,
      startRect: null,
    }
    dragSessionRef.current = session

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      if (dragSessionRef.current !== session) return

      const startRect = getItemElRef.current?.(id)?.getBoundingClientRect()
      if (!startRect) {
        dragSessionRef.current = null
        return
      }

      session.activated = true
      session.startRect = startRect
      session.rafId = null
      session.activatedAt = Date.now()
      suppressClickRef.current = true

      lockScrollContainer(captureEl)
      addNonPassiveTouchMoveBlock(session)

      setDragId(id)
      hapticImpact('Medium')
      window.dispatchEvent(
        new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: true } })
      )
      onArmRef.current?.(session)
    }, LONG_PRESS_MS)
  }, [lockScrollContainer, addNonPassiveTouchMoveBlock])

  const handlePointerMove = useCallback((e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (!session.activated) {
      if (!session.firstMoveSeen) {
        session.firstMoveSeen = true
        if (e.cancelable) e.preventDefault()
      }

      const dx = e.clientX - session.startClientX
      const dy = e.clientY - session.startClientY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearLongPressTimer()
        releasePreArmLock(session)
        dragSessionRef.current = null
      }
      return
    }

    e.preventDefault()

    const dx = e.clientX - session.startClientX
    const dy = e.clientY - session.startClientY
    onMoveRef.current?.(session, {
      dx,
      dy,
      clientX: e.clientX,
      clientY: e.clientY,
      event: e,
    })
  }, [clearLongPressTimer, releasePreArmLock])

  const handlePointerUp = useCallback((e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    clearLongPressTimer()

    if (!session.activated) {
      releasePreArmLock(session)
      dragSessionRef.current = null
      return
    }

    setTimeout(() => { suppressClickRef.current = false }, 0)

    if (onReleaseRef.current) {
      onReleaseRef.current(session)
    } else {
      hardResetDrag(session.id)
    }
  }, [clearLongPressTimer, releasePreArmLock, hardResetDrag])

  const handlePointerCancel = useCallback((e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    if (session.activated) suppressClickRef.current = false
    onCancelRef.current?.(session)
    hardResetDrag(session.id)
  }, [hardResetDrag])

  useEffect(() => () => {
    clearLongPressTimer()
    const session = dragSessionRef.current
    releasePreArmLock(session)
    removeNonPassiveTouchMoveBlock(session)
    unlockScrollContainer()
    window.dispatchEvent(
      new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
    )
  }, [
    clearLongPressTimer,
    releasePreArmLock,
    removeNonPassiveTouchMoveBlock,
    unlockScrollContainer,
  ])

  const bindItem = useCallback((id) => ({
    onPointerDown: (e) => handlePointerDown(e, id),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  }), [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel])

  return {
    bindItem,
    dragId,
    isDragging: dragId != null,
    suppressClickRef,
    sessionRef: dragSessionRef,
    applyDragTransform,
    scheduleDragTransform,
    hardResetDrag,
  }
}
