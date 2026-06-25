import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import { getTasteSignal } from '../services/swipeService'
import { getGamesFromList } from '../services/libraryService'

/**
 * Minimum number of taste signal data points (rated/played games + swipe
 * history) before we surface any blend items. Below this threshold the
 * signal is too sparse to be meaningful.
 */
const MIN_SIGNALS = 3

/** Maximum number of for-you items to inject into the feed at any time. */
export const MAX_BLEND_ITEMS = 3

/** Only surface high-engagement event types as for-you items. */
const BLEND_TYPES = ['completed', 'reviewed', 'favorited']

/** All library list IDs whose games should be excluded from blend items. */
const ALL_LIST_IDS = ['played', 'currently-playing', 'want-to-play', 'dropped']

function getTrackedGameIds() {
  const ids = new Set()
  try {
    for (const listId of ALL_LIST_IDS) {
      for (const g of getGamesFromList(listId) || []) {
        if (g.id != null) ids.add(String(g.id))
      }
    }
  } catch {
    // localStorage unavailable — return empty set; blend silently suppressed.
  }
  return ids
}

/**
 * useForYouBlend — community activity_events surfaced by taste overlap.
 *
 * Surfaces a small set (≤ MAX_BLEND_ITEMS) of community `completed`,
 * `reviewed`, or `favorited` events on games the current user has NOT yet
 * tracked. Sources come exclusively from users the current user does NOT
 * follow — so these items are genuinely fresh faces, not circle-feed echoes.
 *
 * Taste gating: returns [] immediately when the user has fewer than
 * MIN_SIGNALS data points in their taste profile (not enough to make
 * meaningful matches).
 *
 * The hook loads once per session and is NOT realtime — blend items are
 * discovery suggestions, not a live ticker.
 *
 * @returns {{ items: Array, ready: boolean }}
 *   items  — shaped identically to activity_events rows (id, actor_user_id,
 *            type, entity_id, metadata, created_at, actor) so they can be
 *            rendered by the same EventRow family without extra mapping.
 *   ready  — true once the async load completes (or fails gracefully).
 */
export function useForYouBlend() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!user?.id) {
      setItems([])
      setReady(true)
      return
    }

    let cancelled = false

    async function load() {
      try {
        // ── 1. Taste gate ────────────────────────────────────────────────
        const signal = getTasteSignal()
        if (signal.totalSignals < MIN_SIGNALS) {
          if (!cancelled) { setItems([]); setReady(true) }
          return
        }

        // ── 2. Exclude actors already represented in the circle feed ─────
        //
        // Fetch the followee set here (same single-row query the circle
        // feed uses). The blend intentionally surfaces non-followee content
        // so the two feeds are always complementary.
        const { data: followRows } = await supabase
          .from('follows')
          .select('followee_id')
          .eq('follower_id', user.id)

        if (cancelled) return

        const followeeIds = (followRows || []).map((r) => r.followee_id)
        // Self + all followees are excluded: their activity appears elsewhere.
        const excludeActors = [user.id, ...followeeIds]

        // ── 3. Tracked game IDs ──────────────────────────────────────────
        //
        // Exclude games the user already knows about (any status). This
        // keeps blend items in the "discovery" zone rather than echoing
        // games already in the user's library.
        const trackedIds = getTrackedGameIds()

        // ── 4. Community query ───────────────────────────────────────────
        //
        // Fetch recent high-engagement events (completed / reviewed /
        // favorited) from non-followee, non-self actors. We over-fetch
        // (50 rows) so the client-side filter has enough material to find
        // MAX_BLEND_ITEMS distinct untracked games after de-duplication.
        //
        // No explicit genre filter here because `activity_events` does not
        // store IGDB genre metadata. The taste gate above ensures the user
        // has enough profile data so the "people like you" framing is honest
        // — they are fellow active gamers completing and reviewing games,
        // which is the same high-engagement behaviour the current user shows.
        // Genre-level filtering can be added once genres are denormalised
        // into event metadata (tracked in backlog).
        let query = supabase
          .from('activity_events')
          .select(
            'id, actor_user_id, type, entity_id, metadata, created_at,' +
              ' actor:users!activity_events_actor_user_id_fkey' +
              '(id, username, display_name, avatar_url)'
          )
          .in('type', BLEND_TYPES)
          .order('created_at', { ascending: false })
          .limit(50)

        if (excludeActors.length > 0) {
          query = query.not(
            'actor_user_id',
            'in',
            `(${excludeActors.join(',')})`
          )
        }

        const { data, error } = await query

        if (cancelled) return
        if (error) {
          console.error('[forYouBlend] query failed:', error.message)
          if (!cancelled) { setItems([]); setReady(true) }
          return
        }

        // ── 5. Client-side filter + de-dup ───────────────────────────────
        //
        // • Exclude tracked games (already in the library).
        // • Show each game at most once (take the most recent event).
        // • Cap at MAX_BLEND_ITEMS.
        const seenGames = new Set()
        const blendItems = (data || [])
          .filter((r) => {
            if (!r.entity_id) return false
            if (trackedIds.has(String(r.entity_id))) return false
            if (seenGames.has(r.entity_id)) return false
            seenGames.add(r.entity_id)
            return true
          })
          .slice(0, MAX_BLEND_ITEMS)

        if (!cancelled) {
          setItems(blendItems)
          setReady(true)
        }
      } catch (err) {
        console.error('[forYouBlend] crashed:', err)
        if (!cancelled) { setItems([]); setReady(true) }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  return { items, ready }
}

export default useForYouBlend
