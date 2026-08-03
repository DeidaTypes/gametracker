import React from 'react'
import { LuLayers } from 'react-icons/lu'
import { getSizedImageUrl } from '../services/imageUtils'
import './ListCoverCluster.css'

const MOSAIC_COVERS = 4
const FAN_PLATES = 3

/**
 * Square cover cluster for a compact list row.
 *
 * The treatment scales to how many covers the list actually has, so a
 * one-game list never renders as a mostly-empty tile:
 *   0 covers   → a single plate with a layers glyph
 *   1–3 covers → a fanned stack of three plates; plates with no cover
 *                behind them stay as dim surface cards, which is what
 *                makes a sparse list still read as a stack of games
 *   4+ covers  → a 2x2 mosaic of the first four covers
 *
 * `coverImageUrl` (a list's custom uploaded cover) always wins and fills
 * the whole square.
 *
 * `size` picks the footprint: 'md' (60px, the default — Profile's list
 * rows) or 'lg' (--space-64, for rows with more surrounding chrome, e.g.
 * a bordered card). Every internal measurement (fan plate size, offsets,
 * rotation anchor) is proportional to --lcc-size, so both sizes get the
 * same fan/mosaic/empty treatment at a different scale — nothing forks.
 */
function ListCoverCluster({ games = [], coverImageUrl = null, name = '', size = 'md' }) {
  // A game can exist in a list without artwork, so count usable covers
  // rather than games — that's what decides the treatment.
  const covers = games
    .map((g) => getSizedImageUrl(g?.image, 96))
    .filter(Boolean)
    .slice(0, MOSAIC_COVERS)

  const label = name ? `${name} cover` : 'List cover'
  const sizeClass = size === 'lg' ? ' lcc--lg' : ''

  if (coverImageUrl) {
    return (
      <div className={`lcc lcc--single${sizeClass}`}>
        <img src={coverImageUrl} alt={label} className="lcc__fill" loading="lazy" />
      </div>
    )
  }

  if (covers.length === 0) {
    return (
      <div className={`lcc lcc--empty${sizeClass}`} role="img" aria-label={label}>
        <LuLayers size={20} aria-hidden="true" />
      </div>
    )
  }

  if (covers.length >= MOSAIC_COVERS) {
    return (
      <div className={`lcc lcc--mosaic${sizeClass}`} role="img" aria-label={label}>
        {covers.map((src, i) => (
          <img key={src || i} src={src} alt="" className="lcc__cell" loading="lazy" />
        ))}
      </div>
    )
  }

  // Front plate first so the covers we do have are the ones on top.
  return (
    <div className={`lcc lcc--fan${sizeClass}`} role="img" aria-label={label}>
      {Array.from({ length: FAN_PLATES }, (_, i) => (
        <span key={i} className="lcc__plate" data-depth={i}>
          {covers[i] ? (
            <img src={covers[i]} alt="" className="lcc__fill" loading="lazy" />
          ) : null}
        </span>
      ))}
    </div>
  )
}

export default ListCoverCluster
