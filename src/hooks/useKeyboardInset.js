import { useEffect, useState } from 'react'
import {
  subscribeKeyboardInset,
  getKeyboardInset,
} from '../services/keyboardInset'

/**
 * useKeyboardInset — React access to the global keyboard height in px.
 *
 * Prefer the CSS route (`.kb-lift` / `<KeyboardAwareView>`) for anything
 * positional; it runs on the compositor and stays in sync with the native
 * curve without a React render. Reach for this hook only when the value is
 * genuinely needed in JS — e.g. deciding whether to autoscroll a thread, or
 * sizing a canvas.
 *
 * Never add your own visualViewport or Keyboard plugin listener; this reads
 * from the single source of truth in services/keyboardInset.js.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(getKeyboardInset)

  useEffect(() => subscribeKeyboardInset(setInset), [])

  return inset
}

/**
 * useKeyboardOpen — boolean convenience wrapper.
 */
export function useKeyboardOpen() {
  return useKeyboardInset() > 0
}

export default useKeyboardInset
