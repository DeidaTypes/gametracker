import { useCallback, useEffect, useMemo } from 'react'
import { levelProgress, tierFor } from '../data/levels'
import { getUserLevel } from '../services/xpService'
import { useCachedResource } from './useCachedResource'
import { APP_RESUMED_EVENT, isLongAbsence } from './useAppResume'

/**
 * One player's level, for their profile or a visitor's.
 * Reads users.xp_total / level (readable by everyone) through the same
 * session cache as badges. Refetches when a write finishes
 * (`badgesUpdated`), when a notice confirms fresh XP (`xpUpdated`), and
 * after a long absence.
 *
 * @returns {{
 *   xpTotal: number,
 *   level: number,
 *   progress: {
 *     level: number, levelStartXp: number, nextLevelXp: number|null,
 *     intoLevel: number, levelCost: number, toNext: number,
 *     fraction: number, isMax: boolean,
 *   },
 *   tier: { key: string, name: string, min: number, max: number },
 *   loading: boolean,
 * }}
 */
export function useLevel(userId) {
  const key = userId ? `profile:level:${userId}` : null

  const fetcher = useCallback(async () => {
    const row = await getUserLevel(userId)
    if (!row) throw new Error('level unavailable')
    return row
  }, [userId])

  const { data, error, refresh } = useCachedResource(key, fetcher, { enabled: !!userId })
  const loading = !!userId && data === undefined && !error

  useEffect(() => {
    if (!userId) return undefined
    const onChange = () => {
      refresh().catch(() => {})
    }
    const onResume = (event) => {
      if (!isLongAbsence(event)) return
      refresh().catch(() => {})
    }
    window.addEventListener('badgesUpdated', onChange)
    window.addEventListener('xpUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => {
      window.removeEventListener('badgesUpdated', onChange)
      window.removeEventListener('xpUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onResume)
    }
  }, [userId, refresh])

  const view = useMemo(() => {
    const xpTotal = data?.xpTotal ?? 0
    const progress = levelProgress(xpTotal)
    const level = data?.level ?? progress.level
    return { xpTotal, level, progress, tier: tierFor(level) }
  }, [data])

  return { ...view, loading }
}

export default useLevel
