import React, { useEffect, useRef } from 'react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { hapticImpact } from '../utils/haptics'
import './PullToRefresh.css'

// Shared pull-to-refresh gesture — the ONE implementation for every
// primary scrollable feed (Home pulse, Explore, Library, Profile tabs).
// Mirrors SwipeBackWrapper's imperative touch-state pattern (a plain
// state object + direct style writes via refs, no React state on the
// drag path) so a fast drag never lags a render behind the finger, and
// so the two gestures share the same "decide vertical vs horizontal
// after 8px of travel" convention and can never both claim one drag.
//
// Arms only when the nearest `.main-content` scroll container (the
// app's single scroll area — see App.css) is already at scrollTop 0.
// Anywhere else the touch is left completely alone: normal scrolling,
// the swipe-deck's horizontal drag, and SwipeBackWrapper's edge-swipe
// all pass through untouched.
//
// `onRefresh` must return a Promise (or be a plain async function) —
// the spinner stays pinned at the trigger threshold until it resolves,
// then springs back to 0. Callers own bypassing whatever cache their
// own data layer has (swrCache `force: true`, or just re-running a
// local loader) — this component only knows about the gesture.
const THRESHOLD = 64 // px of pull that arms a refresh on release
const MAX_PULL = 96 // visual cap — extra resistance past this point
const RESISTANCE = 0.5 // finger-to-indicator travel ratio
const SETTLE = 'height 0.28s cubic-bezier(0.32, 0.72, 0, 1)'

export default function PullToRefresh({ onRefresh, children, className = '' }) {
  const { reduced } = useMotionPreference()
  const wrapRef = useRef(null)
  const indicatorRef = useRef(null)
  const spinnerRef = useRef(null)
  const onRefreshRef = useRef(onRefresh)
  const reducedRef = useRef(reduced)
  onRefreshRef.current = onRefresh
  reducedRef.current = reduced

  useEffect(() => {
    const wrap = wrapRef.current
    const indicator = indicatorRef.current
    const spinner = spinnerRef.current
    if (!wrap || !indicator || !spinner) return undefined

    const scrollEl = wrap.closest('.main-content')

    const state = {
      active: false,
      decided: false,
      vertical: false,
      refreshing: false,
      startX: 0,
      startY: 0,
      pull: 0,
      hapticFired: false,
    }

    const applyPull = (px) => {
      state.pull = px
      indicator.style.height = `${px}px`
      const progress = Math.min(px / THRESHOLD, 1)
      spinner.style.opacity = progress
      // Reduced motion: fade the spinner in but skip the finger-tied
      // rotate/scale — same "no continuous transform-following" call
      // SwipeBackWrapper makes for its own drag under reduced motion.
      if (!state.refreshing && !reducedRef.current) {
        spinner.style.transform = `rotate(${progress * 360}deg) scale(${0.6 + progress * 0.4})`
      }
    }

    const settleTo = (px, instant) => {
      indicator.style.transition = instant || reducedRef.current ? 'none' : SETTLE
      applyPull(px)
    }

    const onStart = (e) => {
      if (state.refreshing || !scrollEl || scrollEl.scrollTop > 0) return
      const t = e.touches[0]
      if (!t) return
      state.active = true
      state.decided = false
      state.vertical = false
      state.startX = t.clientX
      state.startY = t.clientY
      state.hapticFired = false
      indicator.style.transition = 'none'
    }

    const onMove = (e) => {
      if (!state.active || state.refreshing) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - state.startX
      const dy = t.clientY - state.startY

      if (!state.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        state.decided = true
        // Commit to the pull only if the motion is clearly downward;
        // a horizontal drag (swipe deck, edge swipe-back) yields
        // immediately and this gesture never touches it again.
        state.vertical = dy > 0 && Math.abs(dy) > Math.abs(dx)
        if (!state.vertical) {
          state.active = false
          return
        }
      }

      if (!state.vertical) return

      // The list may have started scrolling under the finger (e.g.
      // momentum settling) since touchstart — abandon rather than
      // fight it.
      if (!scrollEl || scrollEl.scrollTop > 0) {
        state.active = false
        settleTo(0, true)
        return
      }

      if (e.cancelable) e.preventDefault()

      const damped = Math.min(Math.max(dy, 0) * RESISTANCE, MAX_PULL)
      applyPull(damped)

      if (damped >= THRESHOLD && !state.hapticFired) {
        state.hapticFired = true
        hapticImpact('Light')
      }
    }

    const onEnd = () => {
      if (!state.active) return
      state.active = false
      if (state.pull < THRESHOLD) {
        settleTo(0, false)
        return
      }

      state.refreshing = true
      indicator.classList.add(
        reducedRef.current
          ? 'pull-to-refresh__indicator--active-static'
          : 'pull-to-refresh__indicator--active'
      )
      spinner.style.transform = ''
      settleTo(THRESHOLD, false)

      Promise.resolve()
        .then(() => onRefreshRef.current?.())
        .catch(() => {
          // Swallowed — the screen's own error state (banner/toast) owns
          // surfacing a failed refresh; the gesture always resolves.
        })
        .finally(() => {
          state.refreshing = false
          indicator.classList.remove(
            'pull-to-refresh__indicator--active',
            'pull-to-refresh__indicator--active-static'
          )
          settleTo(0, false)
        })
    }

    wrap.addEventListener('touchstart', onStart, { passive: true })
    wrap.addEventListener('touchmove', onMove, { passive: false })
    wrap.addEventListener('touchend', onEnd, { passive: true })
    wrap.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      wrap.removeEventListener('touchstart', onStart)
      wrap.removeEventListener('touchmove', onMove)
      wrap.removeEventListener('touchend', onEnd)
      wrap.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div ref={wrapRef} className={`pull-to-refresh ${className}`.trim()}>
      <div ref={indicatorRef} className="pull-to-refresh__indicator" aria-hidden="true">
        <span ref={spinnerRef} className="pull-to-refresh__spinner" />
      </div>
      {children}
    </div>
  )
}
