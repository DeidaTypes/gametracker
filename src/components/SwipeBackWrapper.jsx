import React, { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMotionPreference } from '../hooks/useMotionPreference'
import {
  beginBack,
  setBackProgress,
  finishBack,
  teardownBack,
} from './backTransition'
import './SwipeBackWrapper.css'

// Native-feeling left-edge swipe-to-go-back.
//
// A touch that starts within EDGE px of the screen's left edge and drags
// rightward translates the page under the finger. Release past THRESHOLD (or
// with enough velocity) completes the travel and calls navigate(-1);
// otherwise both layers spring back to rest.
//
// Only secondary / pushed screens opt in (App.jsx passes swipeBack to their
// PageTransition). Top-level tab screens never mount this wrapper.
//
// WHAT'S BEHIND THE DRAGGING PAGE
// The previous screen — revealed for real, offset left and sliding into place
// in parallax as this page leaves, which is the part that sells the gesture.
// It is a DOM snapshot of that screen captured at push time rather than a live
// route layer; backTransition.js documents why a live layer isn't achievable
// in this architecture (single scroll container, single-instance contexts) and
// what the snapshot does and doesn't preserve.
//
// This file no longer owns any transform. It converts finger travel into a
// progress value and hands it to backTransition.js, which moves this page AND
// the screen behind it from the same number. A back BUTTON press reaches the
// same controller through AnimatedRoutes' POP handling, so the two produce one
// visual result rather than two similar ones.
const EDGE = 28 // px from the left edge where a back-swipe may begin
const THRESHOLD = 90 // px of travel that commits the back navigation
const VELOCITY = 0.45 // px/ms flick speed that commits regardless of travel

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
      dragging: false,
      startX: 0,
      startY: 0,
      startT: 0,
      dx: 0,
      width: 0,
      navigating: false,
      navigated: false,
    }

    // Single source of truth for the navigation so the controller's completion
    // callback can never fire it twice (which would pop two history entries).
    const goBackOnce = () => {
      if (state.navigated) return
      state.navigated = true
      navigate(-1)
    }

    const reset = () => {
      state.active = false
      state.decided = false
      state.horizontal = false
      state.dragging = false
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
        // Mount the reveal on the first horizontal frame, not on touchstart:
        // an edge tap that turns out to be a scroll never pays for a clone
        // being inserted and then removed.
        if (!reducedRef.current) {
          state.width = beginBack({ topLayer: el }) || el.offsetWidth
          state.dragging = true
        }
      }

      if (!state.horizontal) return

      // Block the page's own scroll while we drive the back gesture.
      if (e.cancelable) e.preventDefault()

      state.dx = dx > 0 ? dx : 0
      if (state.dragging && state.width) {
        setBackProgress(state.dx / state.width)
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
      const dragging = state.dragging
      reset()

      if (!dragging) {
        // Reduced motion: no gesture animation at all, just the navigation.
        if (commit) {
          state.navigating = true
          goBackOnce()
        }
        return
      }

      if (commit) state.navigating = true
      finishBack({ commit, onDone: goBackOnce })
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      // If this page unmounts mid-gesture (a deep link, a programmatic
      // navigation) the reveal must not outlive it.
      if (state.dragging && !state.navigating) teardownBack()
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
