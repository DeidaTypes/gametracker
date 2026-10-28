import { useState, useRef, useCallback, useEffect } from 'react'
import { whenKeyboardSettled, subscribeKeyboardInset } from '../services/keyboardInset'

/**
 * useComposerLift — when a comment bar should ride the keyboard.
 *
 * Pair with the standard bar (kb-composer-bar--seamless):
 *
 *   const textareaRef = useRef(null)
 *   const lift = useComposerLift(textareaRef)
 *   <KeyboardAwareView mode="composer" lift={lift.active} …>
 *     <textarea ref={textareaRef} onFocus={lift.onFocus} onBlur={lift.onBlur} />
 *
 * The bar lifts only while ITS OWN field is focused. It turns on at focus and
 * off only once the keyboard has fully gone down, so the bar never drops
 * faster than the keyboard. Focus moving to another field (e.g. a description
 * editor) with the keyboard still up lets it go straight away: it slides down
 * behind the keyboard instead of covering that field.
 *
 * onFocus / onBlur take no arguments, so a screen that has its own focus work
 * (scrolling the thread) just calls lift.onFocus() from its handler.
 *
 * @param {{ current: HTMLElement | null }} textareaRef the composer's field
 * @returns {{ active: boolean, onFocus: () => void, onBlur: () => void }}
 */
export function useComposerLift(textareaRef) {
  const [active, setActive] = useState(false)
  const cancelDeactivateRef = useRef(null)

  const cancelDeactivate = useCallback(() => {
    cancelDeactivateRef.current?.()
    cancelDeactivateRef.current = null
  }, [])

  const onFocus = useCallback(() => {
    cancelDeactivate()
    setActive(true)
  }, [cancelDeactivate])

  const onBlur = useCallback(() => {
    cancelDeactivate()
    let cancelled = false
    let unsubscribe = null
    let cancelSettled = null
    let sawDown = false
    const rafId = requestAnimationFrame(() => {
      const focused = document.activeElement
      if (
        focused &&
        focused !== textareaRef.current &&
        focused.matches?.('input, textarea, select, [contenteditable="true"]')
      ) {
        // Focus moved to another field; the keyboard stays up.
        setActive(false)
        return
      }
      unsubscribe = subscribeKeyboardInset((inset) => {
        if (inset !== 0 || sawDown) return
        sawDown = true
        unsubscribe?.()
        cancelSettled = whenKeyboardSettled(() => {
          if (!cancelled) setActive(false)
        })
      })
      if (sawDown) unsubscribe()
    })
    cancelDeactivateRef.current = () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      unsubscribe?.()
      cancelSettled?.()
    }
  }, [cancelDeactivate, textareaRef])

  useEffect(() => cancelDeactivate, [cancelDeactivate])

  return { active, onFocus, onBlur }
}
