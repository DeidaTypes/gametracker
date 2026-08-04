import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, WifiOff } from 'lucide-react'
import DiscoverSubHeader from '../components/explore/DiscoverSubHeader'
import CleanGameTile from '../components/explore/CleanGameTile'
import EmptyState from '../components/EmptyState'
import { getNewNotablePage } from '../services/newNotableService'
import './DiscoverNewAll.css'

// Twelve rows of three on a phone — enough that the first page fills the
// screen and the sentinel sits comfortably below the fold.
const PAGE_SIZE = 36

function SkeletonTile() {
  return <div className="dna-sk-cover skeleton" aria-hidden="true" />
}

/**
 * DiscoverNewAll — "See all" behind the New & Notable rail.
 * Route: /discover/new
 *
 * The SAME gates as the rail (see supabase/functions/new-notable/lanes.ts):
 * already released, and clearing one of the two notability lanes. This is
 * "notable releases, newest first" — not every recent release, and never an
 * upcoming one. Sorted by release date descending, so the most recent
 * release is the first tile and older ones follow below.
 *
 * Reads new_notable_pool directly, no taste reordering (that's rail-only),
 * no IGDB call. Covers and titles only, matching the rail it continues — no
 * scores anywhere on Discover.
 *
 * Pages are fetched by offset as the sentinel comes into view. Two rows
 * can share the same release timestamp and sort differently between two
 * range() calls, so ids are deduped on append; without that a game sitting
 * on a page boundary can appear twice. The offset counts rows *requested*
 * rather than rows kept, otherwise the next page would re-ask for the ones
 * just dropped.
 */
export default function DiscoverNewAll() {
  const [games, setGames] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // Only a thrown request sets this. An empty first page is a real (if
  // unlikely) state of the pool and gets its own copy below — telling the
  // user loading failed when it succeeded and returned nothing sends them
  // off to retry something that isn't broken.
  const [failed, setFailed] = useState(false)

  const sentinelRef = useRef(null)
  const isFetchingRef = useRef(false)
  const requestedRef = useRef(0)
  const seenIdsRef = useRef(new Set())

  const fetchNextPage = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true

    const offset = requestedRef.current
    try {
      const page = await getNewNotablePage({ limit: PAGE_SIZE, offset })
      requestedRef.current = offset + PAGE_SIZE

      // A short page means the pool has no more history to give, whether or
      // not every row survives the dedupe below.
      setHasMore(page.length === PAGE_SIZE)

      const fresh = page.filter((game) => {
        if (seenIdsRef.current.has(game.id)) return false
        seenIdsRef.current.add(game.id)
        return true
      })
      if (fresh.length > 0) setGames((prev) => [...prev, ...fresh])
    } catch {
      if (offset === 0) setFailed(true)
      setHasMore(false)
    } finally {
      isFetchingRef.current = false
      setInitialLoading(false)
      setLoadingMore(false)
    }
  }, [])

  const retry = useCallback(() => {
    requestedRef.current = 0
    seenIdsRef.current = new Set()
    setFailed(false)
    setHasMore(true)
    setInitialLoading(true)
    fetchNextPage()
  }, [fetchNextPage])

  useEffect(() => {
    fetchNextPage()
  }, [fetchNextPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          setLoadingMore(true)
          fetchNextPage()
        }
      },
      { rootMargin: '600px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, games.length, fetchNextPage])

  return (
    <div className="dna-page">
      <DiscoverSubHeader title="New & Notable" />

      <div className="dna-content">
        {initialLoading ? (
          <div className="clean-tile-grid">
            {Array.from({ length: 12 }, (_, i) => <SkeletonTile key={i} />)}
          </div>
        ) : failed ? (
          <EmptyState
            icon={WifiOff}
            title="Couldn't load new releases."
            body="Check your connection and try again."
            cta="Try again"
            ctaVariant="secondary"
            onCta={retry}
          />
        ) : games.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No new releases right now."
            body="Notable launches land here as they come out — check back soon."
          />
        ) : (
          <>
            <div className="clean-tile-grid">
              {games.map((game) => (
                <CleanGameTile key={game.id} game={game} />
              ))}
            </div>

            {loadingMore && (
              <div className="clean-tile-grid dna-more-grid">
                {Array.from({ length: 6 }, (_, i) => <SkeletonTile key={i} />)}
              </div>
            )}

            {hasMore && (
              <div ref={sentinelRef} className="dna-sentinel" aria-hidden="true" />
            )}
          </>
        )}
      </div>
    </div>
  )
}
