import { useEffect } from 'react'

/**
 * Auto-grows a textarea to fit its content on every keystroke, capped at
 * `maxHeight`, so it doesn't need its own scrollHeight math. Shared by every
 * comment composer (List Comments, Review Detail, Review/Activity Comments)
 * so the "grows with input, caps at N px, then scrolls internally" behavior
 * can never drift between them the way the surrounding CSS spec once did.
 *
 * Pair with `overflow-y: hidden` and `box-sizing: border-box` on the
 * textarea's own CSS — those keep the browser's native scroll handle from
 * flashing while this effect is mid-resize.
 *
 * @param {import('react').RefObject<HTMLTextAreaElement>} ref
 * @param {string} value - the controlled value driving the resize (e.g. draft text)
 * @param {number} maxHeight - px cap to match the CSS `max-height` on the same element
 */
export function useAutoGrowTextarea(ref, value, maxHeight = 90) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [ref, value, maxHeight])
}

export default useAutoGrowTextarea
