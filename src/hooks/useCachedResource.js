import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSWR,
  isSWRFresh,
  mutateSWR,
  peekSWR,
  peekSWRInFlight,
  subscribeSWR,
} from '../services/swrCache'
import { runAfterSlide } from '../motion/xMotion'

/**
 * Session cache for one keyed resource.
 *
 * The first render reads `peekSWR` synchronously. When that value exists,
 * `data` is set before paint and the screen must not show a skeleton.
 * Loading is "there has never been data for this key" — `data === undefined`
 * and `error` is null. A null `key` or `enabled: false` disables the read.
 *
 * In-flight fetches are deduped per key inside swrCache. A background
 * failure keeps the previous value and logs with console.error.
 *
 * `mutate(updater)` writes the cache and notifies every mounted caller
 * of the same key.
 *
 * @template T
 * @param {string|null|undefined} key
 * @param {() => Promise<T>} fetcher
 * @param {{ revalidateAfterMs?: number, enabled?: boolean }} [options]
 */
export function useCachedResource(key, fetcher, options = {}) {
  const { revalidateAfterMs = 30000, enabled = true } = options
  const active = enabled && key != null && key !== ''
  const activeKey = active ? key : null

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const displayedRef = useRef(undefined)

  const [snap, setSnap] = useState(() => ({
    key: activeKey,
    data: activeKey ? peekSWR(activeKey) : undefined,
  }))

  const peeked = activeKey ? peekSWR(activeKey) : undefined
  if (snap.key !== activeKey) {
    setSnap({ key: activeKey, data: peeked })
  }
  const data = snap.key === activeKey ? snap.data : peeked
  displayedRef.current = data

  const [error, setError] = useState(null)
  const [errorKey, setErrorKey] = useState(activeKey)
  if (errorKey !== activeKey) {
    setErrorKey(activeKey)
    if (error) setError(null)
  }

  const [isRevalidating, setIsRevalidating] = useState(false)

  useEffect(() => {
    if (!activeKey) return undefined
    let alive = true
    const unsub = subscribeSWR(activeKey, (next) => {
      runAfterSlide(() => {
        if (!alive) return
        setSnap({ key: activeKey, data: next })
        if (next !== undefined) setError(null)
      }, { placeholder: displayedRef.current === undefined })
    })
    return () => {
      alive = false
      unsub()
    }
  }, [activeKey])

  useEffect(() => {
    if (!activeKey) return undefined
    let cancelled = false

    if (isSWRFresh(activeKey)) {
      setIsRevalidating(false)
      const cached = peekSWR(activeKey)
      if (cached !== undefined) {
        runAfterSlide(() => {
          if (!cancelled) setSnap({ key: activeKey, data: cached })
        }, { placeholder: displayedRef.current === undefined })
      }
      return undefined
    }

    const hadData = peekSWR(activeKey) !== undefined
    if (hadData) setIsRevalidating(true)

    const pending = getSWR(activeKey, () => fetcherRef.current(), {
      ttlMs: revalidateAfterMs,
    })
    const inflight = peekSWRInFlight(activeKey)

    pending
      .then((value) => {
        if (cancelled) return
        runAfterSlide(() => {
          if (cancelled) return
          setSnap({ key: activeKey, data: value })
          setError(null)
        }, { placeholder: displayedRef.current === undefined })
      })
      .catch((err) => {
        if (cancelled) return
        const still = peekSWR(activeKey)
        if (still !== undefined) {
          console.error('[useCachedResource] background revalidate failed:', activeKey, err)
          setSnap({ key: activeKey, data: still })
        } else {
          console.error('[useCachedResource] load failed:', activeKey, err)
          setError(err)
        }
      })

    const done = inflight || pending
    done.finally(() => {
      if (!cancelled) setIsRevalidating(false)
    })

    return () => {
      cancelled = true
    }
  }, [activeKey, revalidateAfterMs])

  const refresh = useCallback(() => {
    if (!activeKey) return Promise.resolve(undefined)
    if (peekSWR(activeKey) !== undefined) setIsRevalidating(true)
    return getSWR(activeKey, () => fetcherRef.current(), {
      ttlMs: revalidateAfterMs,
      force: true,
    })
      .then((value) => {
        setSnap({ key: activeKey, data: value })
        setError(null)
        return value
      })
      .catch((err) => {
        const still = peekSWR(activeKey)
        if (still !== undefined) {
          console.error('[useCachedResource] background revalidate failed:', activeKey, err)
          return still
        }
        console.error('[useCachedResource] load failed:', activeKey, err)
        setError(err)
        throw err
      })
      .finally(() => setIsRevalidating(false))
  }, [activeKey, revalidateAfterMs])

  const mutate = useCallback(
    (updater) => {
      if (!activeKey) return undefined
      return mutateSWR(activeKey, updater)
    },
    [activeKey]
  )

  return { data, isRevalidating, error, refresh, mutate }
}

export default useCachedResource
