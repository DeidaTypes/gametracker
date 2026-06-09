import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getContinuePlayingGames } from '../services/libraryService'
import { getCachedActivityCalendar, computeStreaks, toLocalDateKey, invalidateActivityCache } from '../services/statsService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { computeProgress } from '../services/progressHelper'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * Build the rolling 7-day week array.
 *
 * Returns an array of 7 objects ordered oldest (index 0) → today (index 6).
 * Each object:
 *   { key: 'YYYY-MM-DD', dayLabel: 'M', active: boolean, isToday: boolean }
 *
 * "active" = the user logged ≥1 activity on that local-calendar day.
 */
function buildWeekCells(dateCounts) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const cells = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = toLocalDateKey(d)
    cells.push({
      key,
      dayLabel: SHORT_DAYS[d.getDay()],
      active: (dateCounts?.get(key) ?? 0) > 0,
      isToday: i === 0,
    })
  }

  return cells
}

/**
 * Count how many of the last 7 days have ≥1 activity.
 */
function countActiveDays(weekCells) {
  return weekCells.filter((c) => c.active).length
}

/**
 * useTodayData — all data the TodayCard needs, in one place.
 *
 * Returns:
 *   nowPlaying    — enriched game object (with hoursPlayed, progressPercent,
 *                   lastPlayedAt) or null if the user has no Playing games.
 *   ttb           — getTimeToBeat result for nowPlaying, or null.
 *   progress      — computeProgress result for nowPlaying, or null.
 *   weekCells     — Array<{ key, dayLabel, active, isToday }>, 7 items.
 *   streak        — { current: number, longest: number }
 *   daysLogged    — number of active days in the last 7.
 *   isLoading     — true while the async activity fetch is in flight.
 */
export function useTodayData() {
  const { user } = useAuth()

  // Now-playing: the most recently updated Playing game.
  const [nowPlaying, setNowPlaying] = useState(null)
  const [ttb, setTtb] = useState(null)
  const [progress, setProgress] = useState(null)

  // Activity-derived data.
  const [weekCells, setWeekCells] = useState(() => buildWeekCells(new Map()))
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [daysLogged, setDaysLogged] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  // Derive Now Playing + progress (synchronous, local).
  const refreshNowPlaying = useCallback(() => {
    const games = getContinuePlayingGames(1)
    const game = games[0] ?? null
    setNowPlaying(game)
    return game
  }, [])

  // Fetch TTB and derive progress whenever the spotlight game changes.
  useEffect(() => {
    setTtb(null)
    setProgress(null)
    if (!nowPlaying?.id) return

    let cancelled = false
    getTimeToBeat(nowPlaying.id).then((data) => {
      if (cancelled) return
      setTtb(data)
      setProgress(
        computeProgress({
          hoursPlayed: nowPlaying.hoursPlayed,
          progressOverride: nowPlaying.progressPercent,
          normallySeconds: data?.normallySeconds ?? null,
        })
      )
    })
    return () => { cancelled = true }
  }, [nowPlaying?.id, nowPlaying?.hoursPlayed, nowPlaying?.progressPercent])

  // Fetch activity calendar and derive week + streak (async, Supabase).
  const refreshActivity = useCallback(async () => {
    if (!user?.id) {
      const cells = buildWeekCells(new Map())
      setWeekCells(cells)
      setStreak({ current: 0, longest: 0 })
      setDaysLogged(0)
      setIsLoading(false)
      return
    }

    try {
      // 60 days covers the 7-day rolling window plus enough history
      // to compute the current streak accurately.
      const counts = await getCachedActivityCalendar(user.id, 60)
      const cells = buildWeekCells(counts)
      setWeekCells(cells)
      setStreak(computeStreaks(counts))
      setDaysLogged(countActiveDays(cells))
    } catch (err) {
      console.error('[useTodayData] activity fetch failed:', err)
      const cells = buildWeekCells(new Map())
      setWeekCells(cells)
      setStreak({ current: 0, longest: 0 })
      setDaysLogged(0)
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  // Initial load.
  useEffect(() => {
    refreshNowPlaying()
    setIsLoading(true)
    refreshActivity()
  }, [refreshNowPlaying, refreshActivity])

  // Refresh when library or activity changes.
  useEffect(() => {
    function onLibraryChange() {
      refreshNowPlaying()
    }
    function onActivityChange() {
      invalidateActivityCache()
      setIsLoading(true)
      refreshActivity()
    }

    window.addEventListener('libraryUpdated', onLibraryChange)
    window.addEventListener('activityUpdated', onActivityChange)
    window.addEventListener('reviewAdded', onActivityChange)
    window.addEventListener(APP_RESUMED_EVENT, onLibraryChange)

    return () => {
      window.removeEventListener('libraryUpdated', onLibraryChange)
      window.removeEventListener('activityUpdated', onActivityChange)
      window.removeEventListener('reviewAdded', onActivityChange)
      window.removeEventListener(APP_RESUMED_EVENT, onLibraryChange)
    }
  }, [refreshNowPlaying, refreshActivity])

  return {
    nowPlaying,
    ttb,
    progress,
    weekCells,
    streak,
    daysLogged,
    isLoading,
  }
}
