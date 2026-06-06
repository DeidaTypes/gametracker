import React, { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './SwipeBackWrapper.css'

// Native-feeling left-edge swipe-to-go-back.
//
// A touch that starts within EDGE px of the screen's left edge and drags
// rightward translates the page content under the finger. Release past
// THRESHOLD (or with enough velocity) slides the page fully off to the
// right and calls navigate(-1); otherwise it springs back to rest.
//
// Only secondary / pushed screens opt in (App.jsx passes swipeBack to
// their PageTransition). Top-level tab screens never mount this wrapper.
const EDGE = 28 // px from the left edge where a back-swipe may begin
const THRESHOLD = 90 // px of travel that commits the back navigation
const VELOCITY = 0.45 // px/ms flick speed that commits regardless of travel
const SETTLE = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'

export default function SwipeBackWrapper({ children }) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const elRef = useRef(null)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  useEffect(() => {
    const el = elRef.current
    if (!el) return undefined

    const state = {
      active: false,
      decided: false,
      horizontal: false,
      startX: 0,
      startY: 0,
      startT: 0,
      dx: 0,
      navigating: false,
      navigated: false,
    }

    let safetyTimer = null

    // Single source of truth for the back navigation so the transitionend
    // handler and the safety-net timer can never both fire it (which would
    // pop two entries off the history stack).
    const goBackOnce = () => {
      if (state.navigated) return
      state.navigated = true
      if (safetyTimer) clearTimeout(safetyTimer)
      navigate(-1)
    }

    const setTransform = (x, withShadow) => {
      el.style.transform = x ? `translateX(${x}px)` : ''
      el.classList.toggle('swipe-back--dragging', withShadow)
    }

    const reset = () => {
      state.active = false
      state.decided = false
      state.horizontal = false
      state.dx = 0
    }

    const onStart = (e) => {
      if (state.navigating) return
      const t = e.touches[0]
      if (!t || t.clientX > EDGE) return
      state.active = true
      state.decided = false
      state.horizontal = false
      state.startX = t.clientX
      state.startY = t.clientY
      state.startT = Date.now()
      state.dx = 0
    }

    const onMove = (e) => {
      if (!state.active) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - state.startX
      const dy = t.clientY - state.startY

      if (!state.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        state.decided = true
        // Commit to a horizontal gesture only if the motion is clearly
        // sideways; otherwise yield to vertical scrolling.
        state.horizontal = Math.abs(dx) > Math.abs(dy)
        if (!state.horizontal) {
          state.active = false
          return
        }
      }

      if (!state.horizontal) return

      // Block the page's own scroll while we drive the back gesture.
      if (e.cancelable) e.preventDefault()

      state.dx = dx > 0 ? dx : 0
      if (!reducedRef.current) {
        el.style.transition = 'none'
        setTransform(state.dx, state.dx > 0)
      }
    }

    const finish = (commit) => {
      if (commit) {
        state.navigating = true
        if (reducedRef.current) {
          goBackOnce()
          return
        }
        el.style.transition = SETTLE
        setTransform(el.offsetWidth, true)
        const done = () => {
          el.removeEventListener('transitionend', done)
          goBackOnce()
        }
        el.addEventListener('transitionend', done)
        // Safety net in case transitionend never fires.
        safetyTimer = setTimeout(goBackOnce, 360)
      } else if (!reducedRef.current) {
        el.style.transition = SETTLE
        setTransform(0, false)
        const clear = () => {
          el.style.transition = ''
          el.removeEventListener('transitionend', clear)
        }
        el.addEventListener('transitionend', clear)
      }
    }

    const onEnd = () => {
      if (!state.active || !state.horizontal) {
        reset()
        return
      }
      const dt = Math.max(Date.now() - state.startT, 1)
      const velocity = state.dx / dt
      const commit = state.dx > THRESHOLD || velocity > VELOCITY
      reset()
      finish(commit)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      if (safetyTimer) clearTimeout(safetyTimer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [navigate])

  return (
    <div ref={elRef} className="swipe-back">
      {children}
    </div>
  )
}
