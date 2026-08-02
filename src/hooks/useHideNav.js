import { useEffect } from 'react'

/**
 * Body class toggled while a comment composer owns the bottom of the
 * screen (Comments sub-screen, List Detail, Review Detail, and any future
 * comment surface). Unlike `useNavDim` (src/hooks/useNavDim.js), which
 * fades the floating pill nav to ~12% opacity for bottom sheets that share
 * its footprint, this REMOVES the nav from layout entirely — see
 * `body.nav-hidden .bottom-nav` in BottomNav.css — so the composer can
 * anchor flush against the safe-area inset instead of floating above a
 * nav pill that isn't there.
 *
 * Ref-counted (module-level, not per-hook-instance) for the same reason as
 * useNavDim: if two comment surfaces are ever mounted at once (unlikely,
 * but e.g. during a route transition), the class only comes off the body
 * once the last one unmounts/deactivates.
 *
 * Usage: `useHideNav(isCommentScreen)` — pass `true` unconditionally from
 * a screen that always has a composer (ReviewComments, ReviewDetail), or a
 * boolean expression from a screen where the composer only sometimes
 * renders (ListDetail — only for custom lists).
 */
let hideCount = 0

function pushNavHidden() {
  hideCount += 1
  document.body.classList.add('nav-hidden')
}

function popNavHidden() {
  hideCount = Math.max(0, hideCount - 1)
  if (hideCount === 0) document.body.classList.remove('nav-hidden')
}

export function useHideNav(active = true) {
  useEffect(() => {
    if (!active) return undefined
    pushNavHidden()
    return () => popNavHidden()
  }, [active])
}
