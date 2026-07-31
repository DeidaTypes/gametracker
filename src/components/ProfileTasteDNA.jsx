import React, { useEffect, useState } from 'react'
import { getTasteVector } from '../services/tasteEngineService'
import { genreColorVar, genreShortLabel } from '../utils/genreColors'
import Skeleton from './Skeleton'
import './ProfileTasteDNA.css'

// Below this many genre-tagged signal games, a taste bar would be reading
// noise (1-2 games) rather than a real taste shape — hide instead of
// drawing a misleading bar. Mirrors the engine's own MIN_SIGNAL floor
// used by get_taste_match (see supabase/taste_engine.sql).
const MIN_SIGNAL_FOR_TASTE = 3
const TOP_GENRE_COUNT = 4

/**
 * ProfileTasteDNA — the "Your Taste" section on the Profile Home tab.
 *
 * A single stacked bar of the user's top genres plus an inline legend of
 * percentages, read from the cached B1 taste vector (`getTasteVector`) —
 * never a live IGDB call, and never fabricated when the engine has
 * nothing computed yet.
 *
 * The engine returns L2-normalized affinity weights, not percentages, so
 * the displayed figures are the top-N weights renormalized to sum to 100.
 *
 * Renders nothing at all (not even a header) when the user has too little
 * signal for a real taste shape. While the vector is in flight it renders
 * a skeleton at the section's true height, so the sections below it don't
 * shift once the bar arrives.
 */
export default function ProfileTasteDNA({ userId }) {
  const [vector, setVector] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    if (!userId) {
      setVector(null)
      setLoaded(true)
      return undefined
    }
    getTasteVector(userId).then((v) => {
      if (alive) {
        setVector(v)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [userId])

  if (!loaded) {
    return (
      <section className="ptd" aria-label="Your Taste" aria-busy="true">
        <h3 className="ptd__title">Your Taste</h3>
        <Skeleton height={10} className="ptd__bar-skeleton" />
        <div className="ptd__legend">
          <Skeleton variant="text" width={92} height={14} />
          <Skeleton variant="text" width={72} height={14} />
          <Skeleton variant="text" width={64} height={14} />
        </div>
      </section>
    )
  }

  const genreWeights = vector?.genreWeights || {}
  const hasEnoughSignal =
    !!vector &&
    (vector.signalCount || 0) >= MIN_SIGNAL_FOR_TASTE &&
    Object.keys(genreWeights).length > 0

  if (!hasEnoughSignal) return null

  const topGenres = Object.entries(genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRE_COUNT)
  const totalWeight = topGenres.reduce((sum, [, w]) => sum + w, 0) || 1
  const pct = (w) => Math.round((w / totalWeight) * 100)

  return (
    <section className="ptd" aria-label="Your Taste">
      <h3 className="ptd__title">Your Taste</h3>

      <div
        className="ptd__bar"
        role="img"
        aria-label={`Genre breakdown: ${topGenres
          .map(([g, w]) => `${genreShortLabel(g)} ${pct(w)}%`)
          .join(', ')}`}
      >
        {topGenres.map(([g, w]) => (
          <span
            key={g}
            className="ptd__seg"
            style={{ width: `${(w / totalWeight) * 100}%`, background: genreColorVar(g) }}
          />
        ))}
      </div>

      <div className="ptd__legend" aria-hidden="true">
        {topGenres.map(([g, w]) => (
          <span key={g} className="ptd__legend-item">
            <span className="ptd__legend-dot" style={{ background: genreColorVar(g) }} />
            {genreShortLabel(g)} {pct(w)}%
          </span>
        ))}
      </div>
    </section>
  )
}
