import { useEffect, useState } from 'react'

/**
 * Return `value` only after it has stopped changing for `delay` ms.
 *
 * Used by Search tabs (Reviews / Users / Lists) to debounce input → query
 * by 300ms so we're not firing a Supabase request on every keystroke.
 *
 * The Games tab keeps using `useSearch` (which has its own internal
 * debounce + abort) so this hook is intentionally minimal.
 *
 * @param {*} value
 * @param {number} delay  ms to wait before propagating the value
 * @returns {*}
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
