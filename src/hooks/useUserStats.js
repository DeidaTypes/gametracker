import { useEffect, useRef, useState } from 'react'
import { getReviewsForUser } from '../services/reviewService'
import { getListsForUser } from '../services/listService'
import { getGamesFromList, getLibrary } from '../services/libraryService'
import { getInviteStats } from '../services/inviteService'
import { EMPTY_STATS } from '../data/badges'

/**
 * Sprint 5 P9 — Stats compute hook.
 *
 * Derives the seven counters that every badge in src/data/badges.js
 * scores against. Source-of-truth split:
 *
 *   reviewsCount         → Supabase (getReviewsForUser)
 *   listsCount           → Supabase (getListsForUser)
 *   playedCount          → localStorage (gameLibrary.lists.played)
 *   distinctGenresCount  → localStorage (genres union over Played list)
 *   indiePlayedCount     → localStorage (Played games tagged Indie)
 *   commentsCount        → localStorage `gt:comments-count`
 *   sharesCount          → localStorage `gt:shares-count`
 *
 * The library/genre/indie counters only reflect the *signed-in* user's
 * device — no other user's library is on this device. For the Sprint 5
 * acceptance criteria (Profile Home tab on the own profile, plus the
 * own-user /user/:username/badges page) that's correct. Sprint 6 will
 * add a Supabase-backed library so those counters can compute for any
 * userId.
 *
 * The hook self-refreshes on the standard cross-component events the
 * rest of the app already dispatches (`libraryUpdated`, `reviewAdded`,
 * `storage`) so badge progress updates the instant the user posts a
 * review or marks a game as Played.
 */

const COMMENTS_KEY = 'gt:comments-count'
const SHARES_KEY = 'gt:shares-count'

function readLocalCounter(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * Lower-cased token check that walks both the explicit `themes` array
 * (slug or display name) and `genres` (display name only) since IGDB
 * occasionally surfaces "Indie" as a genre rather than a theme.
 */
function isIndieGame(game) {
  if (!game) return false
  const haystack = []
  if (Array.isArray(game.genres)) haystack.push(...game.genres)
  if (Array.isArray(game.themes)) haystack.push(...game.themes)
  return haystack.some((entry) => {
    if (!entry) return false
    if (typeof entry === 'string') return entry.toLowerCase().includes('indie')
    if (typeof entry === 'object') {
      if (entry.slug && String(entry.slug).toLowerCase() === 'indie') return true
      if (entry.name && String(entry.name).toLowerCase().includes('indie')) return true
    }
    return false
  })
}

function computeLocalStats() {
  let playedCount = 0
  let distinctGenresCount = 0
  let indiePlayedCount = 0
  try {
    const lib = getLibrary()
    if (lib) {
      const played = getGamesFromList('played') || []
      playedCount = played.length

      const genreSet = new Set()
      for (const g of played) {
        if (Array.isArray(g.genres)) {
          for (const genre of g.genres) {
            if (typeof genre === 'string' && genre.trim()) {
              genreSet.add(genre.trim().toLowerCase())
            } else if (genre && typeof genre === 'object' && genre.name) {
              genreSet.add(String(genre.name).trim().toLowerCase())
            }
          }
        } else if (typeof g.genre === 'string' && g.genre) {
          for (const part of g.genre.split(',')) {
            const t = part.trim().toLowerCase()
            if (t) genreSet.add(t)
          }
        }

        if (isIndieGame(g)) indiePlayedCount += 1
      }
      distinctGenresCount = genreSet.size
    }
  } catch {
    // Library not initialized / corrupt — leave counters at 0.
  }

  return {
    playedCount,
    distinctGenresCount,
    indiePlayedCount,
    commentsCount: readLocalCounter(COMMENTS_KEY),
    sharesCount: readLocalCounter(SHARES_KEY),
  }
}

export function useUserStats(userId) {
  const [stats, setStats] = useState(EMPTY_STATS)
  // Track the last in-flight request so we can ignore stale responses
  // when userId changes mid-load.
  const requestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const myRequest = ++requestRef.current

    async function load() {
      // Always recompute local stats — these are cheap and don't need
      // an `await` so we can paint them before the network resolves.
      const local = computeLocalStats()
      if (!cancelled && myRequest === requestRef.current) {
        setStats((prev) => ({ ...prev, ...local }))
      }

      if (!userId) {
        if (!cancelled && myRequest === requestRef.current) {
          setStats({ ...EMPTY_STATS, ...local })
        }
        return
      }

      try {
        const [reviews, lists, invitesCount] = await Promise.all([
          getReviewsForUser(userId),
          getListsForUser(userId),
          getInviteStats(userId),
        ])
        if (cancelled || myRequest !== requestRef.current) return
        setStats({
          ...local,
          reviewsCount: reviews.length,
          listsCount: lists.length,
          invitesCount,
        })
      } catch (err) {
        console.error('[useUserStats] load failed:', err)
        if (!cancelled && myRequest === requestRef.current) {
          setStats((prev) => ({ ...prev, ...local }))
        }
      }
    }

    load()

    // Re-derive whenever one of the upstream data sources changes.
    // `storage` fires for cross-tab edits to localStorage; `reviewAdded`
    // and `libraryUpdated` are the in-tab events the existing services
    // already dispatch (see reviewService.notifyChange + libraryService).
    const refresh = () => load()
    window.addEventListener('storage', refresh)
    window.addEventListener('reviewAdded', refresh)
    window.addEventListener('libraryUpdated', refresh)

    return () => {
      cancelled = true
      window.removeEventListener('storage', refresh)
      window.removeEventListener('reviewAdded', refresh)
      window.removeEventListener('libraryUpdated', refresh)
    }
  }, [userId])

  return stats
}

/**
 * Bump the local-only `gt:shares-count` counter. Called from
 * ReviewCard's handleShare so the Shareholder badge can fire.
 *
 * Same pattern is exposed for comments so future flows can wire it
 * without spelunking through the storage keys.
 */
export function bumpSharesCount(by = 1) {
  try {
    const next = readLocalCounter(SHARES_KEY) + by
    localStorage.setItem(SHARES_KEY, String(next))
    // Notify same-tab listeners — `storage` only fires for *other*
    // tabs, so the in-tab badge state would otherwise stay stale.
    window.dispatchEvent(new Event('storage'))
  } catch {
    // localStorage unavailable — skip.
  }
}

export function bumpCommentsCount(by = 1) {
  try {
    const next = readLocalCounter(COMMENTS_KEY) + by
    localStorage.setItem(COMMENTS_KEY, String(next))
    window.dispatchEvent(new Event('storage'))
  } catch {
    // localStorage unavailable — skip.
  }
}
