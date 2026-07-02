import React, { useEffect, useState } from 'react'
import { getTasteVector } from '../services/tasteEngineService'
import { getGamesFromList } from '../services/libraryService'
import { genreColorVar, genreShortLabel } from '../utils/genreColors'
import './ProfileTasteDNA.css'

// Below this many genre-tagged signal games, a DNA bar would be reading
// noise (1-2 games) rather than a real taste shape — hide instead of
// drawing a misleading bar. Mirrors the engine's own MIN_SIGNAL floor
// used by get_taste_match (see supabase/taste_engine.sql).
const MIN_SIGNAL_FOR_DNA = 3
const TOP_GENRE_COUNT = 5
const MIN_REVIEWS_FOR_RATER_TAG = 3
const MIN_COMPLETION_SAMPLE = 3

/** "Generous rater" — from the user's real average rating. Requires a
 *  handful of reviews so one 5-star fluke can't produce the tag. */
function generousRaterTag(allReviews) {
  if (!allReviews || allReviews.length < MIN_REVIEWS_FOR_RATER_TAG) return null
  const sum = allReviews.reduce((s, r) => s + (parseFloat(r.rating) || 0), 0)
  const avg = sum / allReviews.length
  return avg >= 4.0 ? { key: 'generous-rater', label: 'Generous rater' } : null
}

/** "Finisher" — played vs. dropped ratio. Library lists are local-device
 *  only (never synced for other users), so this can ONLY be computed on
 *  the signed-in device's own profile — hidden on every visitor view. */
function finisherTag(isOwnProfile) {
  if (!isOwnProfile) return null
  let played = 0
  let dropped = 0
  try {
    played = getGamesFromList('played')?.length || 0
    dropped = getGamesFromList('dropped')?.length || 0
  } catch {
    return null
  }
  const total = played + dropped
  if (total < MIN_COMPLETION_SAMPLE) return null
  return played / total >= 0.7 ? { key: 'finisher', label: 'Finisher' } : null
}

/** "{TopGenre}-forward" — from the E0 genre mix. */
function topGenreTag(genreWeights) {
  const entries = Object.entries(genreWeights || {})
  if (entries.length === 0) return null
  const [topGenre] = entries.sort((a, b) => b[1] - a[1])[0]
  return { key: 'top-genre', label: `${genreShortLabel(topGenre)}-forward` }
}

/**
 * ProfileTasteDNA — fills the Taste card's DNA slot (Prompt 2's empty
 * `.profile-taste__dna-slot`) with:
 *   1. Persona pills — derived only from data the user already has;
 *      each tag hides independently when its source data is missing.
 *   2. A horizontal stacked genre bar + inline legend, read from the
 *      cached E0 taste vector (`getTasteVector`) — NEVER a live IGDB
 *      call, and NEVER fabricated when the engine has nothing yet.
 *
 * Renders nothing (not even a wrapper) when neither a tag nor a genre
 * bar can be derived, so the Taste card degrades to just the rating
 * distribution below it.
 */
export default function ProfileTasteDNA({ userId, allReviews, isOwnProfile }) {
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

  const genreWeights = vector?.genreWeights || {}
  const hasEnoughSignal =
    loaded && !!vector && (vector.signalCount || 0) >= MIN_SIGNAL_FOR_DNA && Object.keys(genreWeights).length > 0

  const tags = [
    generousRaterTag(allReviews),
    finisherTag(isOwnProfile),
    hasEnoughSignal ? topGenreTag(genreWeights) : null,
  ].filter(Boolean)

  const topGenres = hasEnoughSignal
    ? Object.entries(genreWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_GENRE_COUNT)
    : []
  const totalWeight = topGenres.reduce((sum, [, w]) => sum + w, 0) || 1

  if (tags.length === 0 && topGenres.length === 0) return null

  return (
    <div className="ptd">
      {tags.length > 0 && (
        <div className="ptd__tags" aria-label="Taste persona">
          {tags.map((t) => (
            <span key={t.key} className="ptd__tag">
              {t.label}
            </span>
          ))}
        </div>
      )}

      {topGenres.length > 0 && (
        <div className="ptd__dna">
          <div
            className="ptd__bar"
            role="img"
            aria-label={`Genre breakdown: ${topGenres
              .map(([g, w]) => `${genreShortLabel(g)} ${Math.round((w / totalWeight) * 100)}%`)
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
                {genreShortLabel(g)} {Math.round((w / totalWeight) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
