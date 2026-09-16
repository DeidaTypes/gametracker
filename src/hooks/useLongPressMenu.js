import { useCallback, useEffect, useRef } from 'react'
import { PULL_TO_REFRESH_YIELD_EVENT } from '../components/PullToRefresh'
import { hapticImpact } from '../utils/haptics'
import { LONG_PRESS_MS, MOVE_CANCEL_PX } from './useIosLongPressDrag'

function setPullToRefreshYield(active) {
  window.dispatchEvent(
    new CustomEvent(PULL_TO_REFRESH_YIELD_EVENT, { detail: { active } })
  )
}

/**
 * Long-press that opens a menu. Not a drag armature — do not swap this
 * for useIosLongPressDrag. It still applies the iOS WKWebView lessons
 * that long-press shares with drag (same 450ms / 8px gates, PTR yield
 * at pointerdown, same-tick touch-action: none, click suppression)
 * without following the finger or locking scroll for a lift.
 *
 * Caller MUST put user-select / touch-callout: none on the press
 * surface and draggable="false" on any cover images inside it.
 *
 * @param {{
 *   enabled?: boolean,
 *   shouldOpen?: (item: *) => boolean,
 *   onOpen?: (item: *) => void,
 * }} options
 */
export function useLongPressMenu({ enabled = true, shouldOpen, onOpen } = {}) {
  const sessionRef = useRef(null)
  const timerRef = useRef(null)
  const suppressClickRef = useRef(false)

  const enabledRef = useRef(enabled)
  const shouldOpenRef = useRef(shouldOpen)
  const onOpenRef = useRef(onOpen)
  enabledRef.current = enabled
  shouldOpenRef.current = shouldOpen
  onOpenRef.current = onOpen

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releasePreArm = useCallback((session) => {
    if (session?.captureEl) session.captureEl.style.touchAction = ''
    setPullToRefreshYield(false)
  }, [])

  const endSession = useCallback((session) => {
    clearTimer()
    releasePreArm(session)
    sessionRef.current = null
  }, [clearTimer, releasePreArm])

  const bind = useCallback((item) => ({
    onPointerDown: (e) => {
      if (!enabledRef.current) return
      if (e.button != null && e.button !== 0) return
      if (shouldOpenRef.current && !shouldOpenRef.current(item)) return
      if (sessionRef.current) return

      const captureEl = e.currentTarget
      try {
        captureEl.setPointerCapture(e.pointerId)
      } catch {
        // Capture-reject fallback — timer still arms; move/up may miss
        // if the finger leaves this element.
      }

      captureEl.style.touchAction = 'none'
      setPullToRefreshYield(true)

      const session = {
        item,
        pointerId: e.pointerId,
        captureEl,
        startX: e.clientX,
        startY: e.clientY,
        activated: false,
      }
      sessionRef.current = session

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (sessionRef.current !== session) return
        session.activated = true
        suppressClickRef.current = true
        hapticImpact('Medium')
        onOpenRef.current?.(item)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e) => {
      const session = sessionRef.current
      if (!session || session.pointerId !== e.pointerId) return
      if (session.activated) return
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
          session.captureEl.releasePointerCapture(e.pointerId)
        }
        endSession(session)
      }
    },
    onPointerUp: (e) => {
      const session = sessionRef.current
      if (!session || session.pointerId !== e.pointerId) return
      if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
        session.captureEl.releasePointerCapture(e.pointerId)
      }
      if (session.activated) {
        setTimeout(() => { suppressClickRef.current = false }, 0)
      }
      endSession(session)
    },
    onPointerCancel: (e) => {
      const session = sessionRef.current
      if (!session || session.pointerId !== e.pointerId) return
      if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
        session.captureEl.releasePointerCapture(e.pointerId)
      }
      if (session.activated) suppressClickRef.current = false
      endSession(session)
    },
    onContextMenu: (e) => {
      e.preventDefault()
    },
  }), [endSession])

  useEffect(() => () => {
    endSession(sessionRef.current)
  }, [endSession])

  return { bind, suppressClickRef }
}

export { LONG_PRESS_MS, MOVE_CANCEL_PX }
