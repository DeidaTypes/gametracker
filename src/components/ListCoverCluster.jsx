import React from 'react'
import { LuLayers } from 'react-icons/lu'
import { getSizedImageUrl } from '../services/imageUtils'
import './ListCoverCluster.css'

const MOSAIC_COVERS = 4
const FAN_PLATES = 3
const POSTER_PLATES = 3

/**
 * Cover cluster for a list, in one of two variants.
 *
 * `variant="tile"` (default) — square cluster for compact list rows
 * (Profile's ListRow, PinnedListsSection, Search, SearchOverlay). The
 * treatment scales to how many covers the list actually has, so a
 * one-game list never renders as a mostly-empty tile:
 *   0 covers   → a single plate with a layers glyph
 *   1–3 covers → a fanned stack of three plates; plates with no cover
 *                behind them stay as dim surface cards, which is what
 *                makes a sparse list still read as a stack of games
 *   4+ covers  → a 2x2 mosaic of the first four covers
 *
 * `variant="poster"` — true `--cover-ratio` (2/3) fanned poster stack for
 * Library's Lists tab (list cards + the pinned hero). Renders exactly as
 * many posters as the list has — a 1- or 2-cover list gets exactly that
 * many real posters, never a ghost plate; only the 0-cover case renders a
 * styled 3-plate placeholder. The center poster sits on top and larger;
 * the outer two are rotated -9deg/+9deg behind it. The canvas reserves a
 * consistent height relative to its own width (not the cover count), so
 * every card that gives it the same width — e.g. the 2-up Library grid —
 * lines up regardless of how many covers it's showing.
 *
 * In both variants `coverImageUrl` (a list's custom uploaded cover)
 * always wins: it fills the tile in `tile`, and renders as the single
 * centered poster in `poster` — covers are never stretched into a
 * non-2:3 shape.
 *
 * `size` picks the footprint for the `tile` variant: 'md' (60px, the
 * default) or 'lg' (--space-64). Every internal measurement (fan plate
 * size, offsets, rotation anchor) is proportional to --lcc-size, so both
 * sizes get the same fan/mosaic/empty treatment at a different scale —
 * nothing forks. The `poster` variant instead sizes entirely off its own
 * container width (see ListCoverCluster.css), so its footprint is set by
 * the wrapper the caller puts around it, not by `size`.
 */
function ListCoverCluster({
  games = [],
  coverImageUrl = null,
  name = '',
  size = 'md',
  variant = 'tile',
}) {
  const label = name ? `${name} cover` : 'List cover'
  const sizeClass = size === 'lg' ? ' lcc--lg' : ''

  if (variant === 'poster') {
    const posterCovers = coverImageUrl
      ? [coverImageUrl]
      : games.map((g) => getSizedImageUrl(g?.image, 240)).filter(Boolean).slice(0, POSTER_PLATES)
    return renderPosterStack(posterCovers, label)
  }

  // A game can exist in a list without artwork, so count usable covers
  // rather than games — that's what decides the treatment.
  const covers = games
    .map((g) => getSizedImageUrl(g?.image, 96))
    .filter(Boolean)
    .slice(0, MOSAIC_COVERS)

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

// Slot order fills center first, then right, then left — so 1 cover is
// just the center poster and 2 covers is center+right, with no empty
// slot rendered. Only the 0-cover placeholder below uses all three.
function renderPosterStack(covers, label) {
  if (covers.length === 0) {
    return (
      <div className="lcc lcc--poster lcc--poster-empty" role="img" aria-label={label}>
        <span className="lcc__poster-plate lcc__poster-plate--left" aria-hidden="true" />
        <span className="lcc__poster-plate lcc__poster-plate--right" aria-hidden="true" />
        <span className="lcc__poster-plate lcc__poster-plate--center lcc__poster-plate--placeholder" aria-hidden="true">
          <LuLayers size={18} aria-hidden="true" />
        </span>
      </div>
    )
  }

  const slots = []
  if (covers[2]) slots.push({ pos: 'left', src: covers[2] })
  if (covers[1]) slots.push({ pos: 'right', src: covers[1] })
  if (covers[0]) slots.push({ pos: 'center', src: covers[0] })

  return (
    <div className="lcc lcc--poster" role="img" aria-label={label}>
      {slots.map((slot) => (
        <span key={slot.pos} className={`lcc__poster-plate lcc__poster-plate--${slot.pos}`}>
          <img src={slot.src} alt="" className="lcc__fill" loading="lazy" />
        </span>
      ))}
    </div>
  )
}

export default ListCoverCluster
