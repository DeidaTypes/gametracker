import React, { useEffect, useState } from 'react'
import { getTasteMatch } from '../services/tasteEngineService'
import { genreColorVar, genreShortLabel } from '../utils/genreColors'
import './ProfileTasteMatchBanner.css'

const TOP_SHARED_GENRES = 2

/**
 * ProfileTasteMatchBanner — visitor-only readout of the real E0
 * user↔user taste match (overall % + top shared genres), rendered
 * above the primary action button in the profile identity area.
 *
 * Reads the cached `get_taste_match` RPC via `getTasteMatch` — never a
 * live IGDB call, never invented. Renders nothing while loading, when
 * `viewerId`/`ownerId` are the same person (own profile — callers
 * should already gate on `!isOwnProfile`, this is belt-and-suspenders),
 * or when the engine hasn't computed enough signal for this pair yet.
 */
export default function ProfileTasteMatchBanner({ viewerId, ownerId }) {
  const [match, setMatch] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)

    if (!viewerId || !ownerId || viewerId === ownerId) {
      setMatch(null)
      setLoaded(true)
      return undefined
    }

    getTasteMatch(viewerId, ownerId).then((m) => {
      if (alive) {
        setMatch(m)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [viewerId, ownerId])

  if (!loaded || !match) return null

  const topGenres = (match.genres || []).slice(0, TOP_SHARED_GENRES)

  return (
    <div className="ptmb" role="note" aria-label={`${Math.round(match.score)} percent taste match`}>
      <span className="ptmb__score">{Math.round(match.score)}% match</span>
      {topGenres.length > 0 && (
        <span className="ptmb__readout">
          <span aria-hidden="true"> · you both lean into </span>
          {topGenres.map((g, i) => (
            <React.Fragment key={g.genre}>
              {i > 0 && <span aria-hidden="true"> &amp; </span>}
              <span className="ptmb__genre">
                <span className="ptmb__dot" style={{ background: genreColorVar(g.genre) }} aria-hidden="true" />
                {genreShortLabel(g.genre)}
              </span>
            </React.Fragment>
          ))}
        </span>
      )}
    </div>
  )
}
