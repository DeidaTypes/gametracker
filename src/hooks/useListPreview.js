import { useEffect, useState } from 'react'
import { getListById } from '../services/listService'

/**
 * useListPreview — lazily hydrates a list's name, item count, and cover
 * mosaic for the Home feed's "added a game to a list" card content zone.
 *
 * `communityService.getHomeFeed` doesn't return list-add rows today, and
 * even where a list-add row is later added upstream, its activity_events
 * metadata only carries `list_id` — no name or item count (see the
 * addGameToList write path). Rather than changing getHomeFeed's query,
 * this hook does a separate, card-local read via the existing
 * `getListById(listId)` call, keyed off whatever `listId` the item
 * already carries. Skipped entirely when `listId` is falsy. Soft-fails
 * to `null` on error or not-found — the card simply omits the pill/mosaic
 * rather than fabricating a name or count.
 */
const cache = new Map()

export function useListPreview(listId) {
  const [list, setList] = useState(() => (listId ? cache.get(listId) || null : null))

  useEffect(() => {
    if (!listId) {
      setList(null)
      return undefined
    }
    if (cache.has(listId)) {
      setList(cache.get(listId))
      return undefined
    }
    let cancelled = false
    getListById(listId)
      .then((data) => {
        if (cancelled) return
        cache.set(listId, data)
        setList(data)
      })
      .catch(() => {
        if (!cancelled) setList(null)
      })
    return () => {
      cancelled = true
    }
  }, [listId])

  return list
}

export default useListPreview
