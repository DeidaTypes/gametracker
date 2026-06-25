import { useCallback, useEffect, useState } from 'react'
import { getShowcaseBadges, updateShowcaseBadges } from '../services/badgeService'

/**
 * Manages the 3-badge showcase for a user's profile page.
 *
 * Fetches the current showcase_badges array from Supabase and exposes
 * a `setShowcase` function that optimistically updates local state
 * and syncs to the DB. Write access is gated behind `isOwnProfile`
 * so the hook is safe to mount on public profile views too.
 *
 * @param {string|null} userId       - Profile owner's Supabase user ID.
 * @param {boolean}     isOwnProfile - Whether the viewer owns this profile.
 */
export function useShowcaseBadges(userId, isOwnProfile) {
  const [showcaseIds, setShowcaseIds] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setShowcaseIds([])
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    getShowcaseBadges(userId).then((ids) => {
      if (!cancelled) {
        setShowcaseIds(ids || [])
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const setShowcase = useCallback(
    async (newIds) => {
      if (!isOwnProfile || !userId) return
      const clamped = (newIds || []).slice(0, 3)
      setShowcaseIds(clamped)
      await updateShowcaseBadges(userId, clamped)
    },
    [userId, isOwnProfile]
  )

  return { showcaseIds, setShowcase, isLoading }
}
