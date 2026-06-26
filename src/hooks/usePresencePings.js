import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SETTINGS_CHANGED_EVENT,
  getSettings,
} from '../services/userSettingsService'

/**
 * usePresencePings
 *
 * Watches `playingNow` (from usePresence) for new joiners and batches them
 * into grouped "X and 2 others just hopped into <game> — join?" pings.
 *
 * Grouping / debounce
 * -------------------
 * When a new userId appears in playingNow it's collected into a per-game
 * pending bucket. A 5-second debounce timer is (re)started on every new
 * arrival. When it fires, ALL pending buckets flush as one ping per game,
 * so three friends joining the same game in quick succession produce a
 * single "X and 2 others…" banner rather than three separate ones.
 *
 * Guards
 * ------
 * - presenceOptIn must be true  (already enforced by usePresence itself —
 *   playingNow is [] when opted out, so no false positives)
 * - presencePingsOptIn must be true  (separate opt-out so users can share
 *   their own presence without receiving bang banners)
 *
 * The hook never touches the DB; pings are transient in-memory events
 * that live until dismissed.
 *
 * @param {Array<{
 *   userId: string,
 *   gameId: number,
 *   gameTitle: string|null,
 *   gameImage: string|null,
 * }>} playingNow — from usePresence().playingNow
 *
 * @returns {{
 *   pings: Array<{
 *     id: string,
 *     gameId: number,
 *     gameTitle: string|null,
 *     gameImage: string|null,
 *     userIds: string[],      — the user ids who joined
 *     count: number,          — convenient alias for userIds.length
 *   }>,
 *   dismissPing: (id: string) => void,
 * }}
 */

const DEBOUNCE_MS = 5_000
const MAX_VISIBLE = 5

function pingsEnabled() {
  const s = getSettings()
  return !!s.presenceOptIn && !!s.presencePingsOptIn
}

export function usePresencePings(playingNow) {
  const [enabled, setEnabled] = useState(pingsEnabled)
  const [pings, setPings] = useState([])

  // Set of userIds present in the last playingNow snapshot.
  const prevIdsRef = useRef(/** @type {Set<string>} */ (new Set()))
  // Pending bucket: gameId (string) → { gameId, gameTitle, gameImage, userIds: Set }
  const pendingRef = useRef(/** @type {Record<string, any>} */ ({}))
  const timerRef = useRef(null)

  // Sync with settings bus.
  useEffect(() => {
    function onSettings(e) {
      const s = e?.detail || getSettings()
      setEnabled(!!s.presenceOptIn && !!s.presencePingsOptIn)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettings)
  }, [])

  // Clear pending state when pings are disabled.
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current)
      pendingRef.current = {}
      prevIdsRef.current = new Set()
    }
  }, [enabled])

  const flushPending = useCallback(() => {
    const batch = Object.values(pendingRef.current)
    pendingRef.current = {}
    if (batch.length === 0) return

    const incoming = batch.map((b) => ({
      id: `presence:${b.gameId}:${Date.now()}`,
      gameId: b.gameId,
      gameTitle: b.gameTitle,
      gameImage: b.gameImage,
      userIds: [...b.userIds],
      count: b.userIds.size,
    }))

    setPings((prev) => {
      // Deduplicate: if a ping for the same gameId is still showing, merge
      // the new userIds into it rather than stacking a second card.
      const next = [...prev]
      for (const inc of incoming) {
        const existing = next.findIndex((p) => p.gameId === inc.gameId)
        if (existing !== -1) {
          const merged = new Set([...next[existing].userIds, ...inc.userIds])
          next[existing] = {
            ...next[existing],
            userIds: [...merged],
            count: merged.size,
          }
        } else {
          next.push(inc)
        }
      }
      // Cap to avoid stack overflow.
      return next.slice(-MAX_VISIBLE)
    })
  }, [])

  useEffect(() => {
    if (!enabled) return

    const currentIds = new Set(playingNow.map((p) => p.userId))
    const newJoiners = playingNow.filter((p) => !prevIdsRef.current.has(p.userId))
    prevIdsRef.current = currentIds

    if (newJoiners.length === 0) return

    // Accumulate into per-game pending buckets.
    for (const joiner of newJoiners) {
      const key = String(joiner.gameId)
      if (!pendingRef.current[key]) {
        pendingRef.current[key] = {
          gameId: joiner.gameId,
          gameTitle: joiner.gameTitle,
          gameImage: joiner.gameImage,
          userIds: new Set(),
        }
      }
      pendingRef.current[key].userIds.add(joiner.userId)
    }

    // (Re)start the debounce window.
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flushPending, DEBOUNCE_MS)
  }, [playingNow, enabled, flushPending])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const dismissPing = useCallback((id) => {
    setPings((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { pings, dismissPing }
}

export default usePresencePings
