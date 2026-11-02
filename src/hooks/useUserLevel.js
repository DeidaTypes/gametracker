import { useEffect, useState } from 'react'
import {
  getCachedUserLevel,
  requestUserLevel,
  subscribeUserLevel,
} from '../services/levelCache'

/**
 * One user's level for an avatar ring. Null until the shared cache has
 * a row, and null when the id is missing or the user is gone — callers
 * draw nothing in both cases.
 *
 * @param {string|null|undefined} userId
 * @returns {number|null}
 */
export function useUserLevel(userId) {
  const id = userId ? String(userId) : null
  const [level, setLevel] = useState(() => getCachedUserLevel(id))

  useEffect(() => {
    if (!id) {
      setLevel(null)
      return undefined
    }
    setLevel(getCachedUserLevel(id))
    const unsubscribe = subscribeUserLevel(id, setLevel)
    requestUserLevel(id)
    return unsubscribe
  }, [id])

  return level
}

export default useUserLevel
