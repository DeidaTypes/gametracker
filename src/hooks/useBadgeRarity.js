import { useEffect, useState } from 'react'
import { getBadgeRarity } from '../services/badgeService'

/**
 * Fetches badge rarity data once on mount.
 *
 * Returns a Map<badgeId, { holderCount, totalUsers, rarityPct }>.
 * Resolves to an empty Map while loading so consumers render without
 * a rarity label rather than crashing.
 */
export function useBadgeRarity() {
  const [rarityMap, setRarityMap] = useState(() => new Map())

  useEffect(() => {
    let cancelled = false
    getBadgeRarity().then((map) => {
      if (!cancelled) setRarityMap(map)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return rarityMap
}
