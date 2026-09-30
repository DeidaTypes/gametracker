import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTransitionComplete } from '../components/PageTransition'

const HIGHLIGHT_MS = 1000

/**
 * After the enter transition, scroll the row tagged with
 * location.state.highlight into view and tint it for a second.
 * A ref keyed on location.key consumes that history entry once.
 * Nothing navigates or replaces to clear the state.
 */
export function useSettingsHighlight() {
  const location = useLocation()
  const transitionComplete = useTransitionComplete()
  const consumedKey = useRef(null)

  useEffect(() => {
    if (!transitionComplete) return undefined
    const id = location.state?.highlight
    if (typeof id !== 'string' || !id) return undefined
    if (consumedKey.current === location.key) return undefined

    let timer = 0
    let committed = false

    // Wait a frame so Strict Mode's synchronous setup/cleanup cannot
    // cancel the tint, and so layout has settled after the enter tween.
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector(`[data-setting-id="${CSS.escape(id)}"]`)
      if (!row) return
      committed = true
      consumedKey.current = location.key
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      // A class set from here is wiped the next time the row renders,
      // because React owns className. A data attribute it doesn't render
      // stays put for the second the tint is on screen.
      row.setAttribute('data-setting-highlight', 'on')
      timer = window.setTimeout(() => {
        row.removeAttribute('data-setting-highlight')
      }, HIGHLIGHT_MS)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      // A cleanup before the frame (Strict Mode, or a parent render that
      // re-runs this effect) must not consume the key. Once the tint has
      // started, leave the timer alone so a same-key re-render cannot
      // strip it. Unmount drops the node with the class.
      if (!committed) {
        window.clearTimeout(timer)
        consumedKey.current = null
      }
    }
    // location.state is read once per location.key. Depending on the
    // object identity would re-run the effect and cancel the tint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionComplete, location.key])
}
