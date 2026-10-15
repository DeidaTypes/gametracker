import { useEffect, useState } from 'react'
import { isFlagEnabled, peekFlagEnabled, subscribeFlags } from '../services/flagService'

/**
 * Session-cached app flag. Starts false until the RPC resolves, then
 * tracks resume refreshes. A failed read stays false.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function useFlagEnabled(key) {
  const [enabled, setEnabled] = useState(() => peekFlagEnabled(key))

  useEffect(() => {
    let alive = true
    let req = 0

    const run = () => {
      const id = ++req
      isFlagEnabled(key).then((value) => {
        if (alive && id === req) setEnabled(value === true)
      })
    }

    run()
    const unsub = subscribeFlags(run)
    return () => {
      alive = false
      unsub()
    }
  }, [key])

  return enabled
}

export default useFlagEnabled
