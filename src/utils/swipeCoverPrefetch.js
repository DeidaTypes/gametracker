import { coverUrl, imageIdFromCoverUrl } from '../services/igdbImage'

const PREFETCH_AHEAD = 3

function resolveCoverImageId(game) {
  if (!game) return null
  return game.coverImageId ?? imageIdFromCoverUrl(game.image || game.coverUrl) ?? null
}

/**
 * Warm the browser cache for the next `PREFETCH_AHEAD` swipe covers (t_cover_big_2x).
 * Keeps in-flight Image objects in `prefetchRef` keyed by image_id so URLs are
 * never requested twice and loaders are not GC'd mid-flight.
 *
 * @param {React.MutableRefObject<Map<string, HTMLImageElement>>} prefetchRef
 * @param {Array<object>|null|undefined} pool
 * @param {number} currentIdx
 */
export function prefetchNextSwipeCovers(prefetchRef, pool, currentIdx) {
  if (!Array.isArray(pool) || pool.length === 0) return

  for (let i = 1; i <= PREFETCH_AHEAD; i++) {
    const imageId = resolveCoverImageId(pool[currentIdx + i])
    if (!imageId) continue

    const key = String(imageId)
    if (prefetchRef.current.has(key)) continue

    const img = new Image()
    img.decoding = 'async'
    img.src = coverUrl(imageId, 'cover_big_2x')
    prefetchRef.current.set(key, img)
  }
}
