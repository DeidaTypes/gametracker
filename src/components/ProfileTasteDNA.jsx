import React, { useEffect, useState } from 'react'
import { getTasteVector } from '../services/tasteEngineService'
import { getSWR, peekSWR } from '../services/swrCache'
import { genreShortLabel } from '../utils/genreColors'
import Skeleton from './Skeleton'
import './ProfileTasteDNA.css'

const MIN_SIGNAL_FOR_TASTE = 3
const TOP_GENRE_COUNT = 4

const RANK_GENRE_TOKENS = ['--genre-1', '--genre-2', '--genre-3', '--genre-4']

const TASTE_VECTOR_TTL_MS = 60 * 1000

/**
 * ProfileTasteDNA — "Your taste" bar on Profile Home. Same card for
 * self and visitor; hidden when the engine has too little signal.
 */
export default function ProfileTasteDNA({
  userId,
  isOwnProfile = true,
  embedded = false,
  onResolved,
}) {
  const cacheKey = userId ? `taste-vector:${userId}` : null
  const [vector, setVector] = useState(() => (cacheKey ? peekSWR(cacheKey) ?? null : null))
  const [loaded, setLoaded] = useState(() => !!cacheKey && peekSWR(cacheKey) !== undefined)
  const title = isOwnProfile ? 'Your taste' : 'Their taste'

  useEffect(() => {
    let alive = true
    if (!userId) {
      setVector(null)
      setLoaded(true)
      return undefined
    }
    const key = `taste-vector:${userId}`
    if (peekSWR(key) === undefined) setLoaded(false)
    getSWR(key, () => getTasteVector(userId), { ttlMs: TASTE_VECTOR_TTL_MS }).then((v) => {
      if (alive) {
        setVector(v)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [userId])

  const genreWeights = vector?.genreWeights || {}
  const hasEnoughSignal =
    !!vector &&
    (vector.signalCount || 0) >= MIN_SIGNAL_FOR_TASTE &&
    Object.keys(genreWeights).length > 0

  useEffect(() => {
    if (!onResolved) return undefined
    if (!loaded) {
      onResolved({ visible: false, loading: true })
      return undefined
    }
    onResolved({ visible: hasEnoughSignal, loading: false })
    return undefined
  }, [loaded, hasEnoughSignal, onResolved])

  if (!loaded) {
    return (
      <section
        className={`ptd${embedded ? ' ptd--embedded' : ''}`}
        aria-label={title}
        aria-busy="true"
      >
        <h3 className="ptd__title">{title}</h3>
        <Skeleton height={12} className="ptd__bar-skeleton" />
        <div className="ptd__legend">
          <Skeleton variant="text" width={92} height={14} />
          <Skeleton variant="text" width={72} height={14} />
          <Skeleton variant="text" width={64} height={14} />
        </div>
      </section>
    )
  }

  if (!hasEnoughSignal) return null

  const topGenres = Object.entries(genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRE_COUNT)
  const totalWeight = topGenres.reduce((sum, [, w]) => sum + w, 0) || 1
  const pct = (w) => Math.round((w / totalWeight) * 100)

  return (
    <section className={`ptd${embedded ? ' ptd--embedded' : ''}`} aria-label={title}>
      <h3 className="ptd__title">{title}</h3>

      <div
        className="ptd__bar"
        role="img"
        aria-label={`Genre breakdown: ${topGenres
          .map(([g, w]) => `${genreShortLabel(g)} ${pct(w)}%`)
          .join(', ')}`}
      >
        {topGenres.map(([g, w], index) => (
          <span
            key={g}
            className="ptd__seg"
            style={{
              width: `${(w / totalWeight) * 100}%`,
              background: `var(${RANK_GENRE_TOKENS[index] ?? '--genre-default'})`,
            }}
          />
        ))}
      </div>

      <div className="ptd__legend" aria-hidden="true">
        {topGenres.map(([g, w], index) => (
          <span key={g} className="ptd__legend-item">
            <span
              className="ptd__legend-dot"
              style={{ background: `var(${RANK_GENRE_TOKENS[index] ?? '--genre-default'})` }}
            />
            {genreShortLabel(g)} {pct(w)}%
          </span>
        ))}
      </div>
    </section>
  )
}
