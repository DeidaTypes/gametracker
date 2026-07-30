import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import Pressable from '../Pressable'
import { genreColorVar } from '../../utils/genreColors'
import { genreIcon } from '../../utils/genreIcons'
import {
  genreDisplayName,
  formatTierStatsLine,
  formatBacklogCount,
} from '../../utils/gamingMapFormat'
import './GamingMapTile.css'

/**
 * One genre tile on Your Gaming Map. Rendering branches on `tier` — each
 * tier has its own shape per the mockup, but they all share the same
 * navigation: tap → genre detail (route owned by G4; out of scope here).
 *
 * tier === 'home_turf' | 'exploring' — tinted card, chevron, real stats.
 * tier === 'on_horizon'              — neutral card, genre-accent swatch,
 *                                       backlog count, no chevron.
 * tier === 'not_yet'                 — dashed tile, genre icon, no stats
 *                                       (there's nothing real to show yet).
 */
function GamingMapTile({ genre, tier }) {
  const navigate = useNavigate()
  const displayName = genreDisplayName(genre.name)

  function goToGenre() {
    navigate(`/gaming-map/genre/${genre.slug}`)
  }

  if (tier === 'not_yet') {
    const Icon = genreIcon(genre.name)
    return (
      <Pressable
        as="div"
        className="map-tile map-tile--unexplored"
        onClick={goToGenre}
        role="link"
        tabIndex={0}
        aria-label={`${displayName} — not explored yet, tap to look inside`}
      >
        <Icon size={22} className="map-tile__icon" aria-hidden="true" />
        <span className="map-tile__label">{displayName}</span>
      </Pressable>
    )
  }

  if (tier === 'on_horizon') {
    return (
      <Pressable
        as="div"
        className="map-tile map-tile--horizon"
        onClick={goToGenre}
        role="link"
        tabIndex={0}
        aria-label={`${displayName} — ${formatBacklogCount(genre.stats.backlogCount)}`}
      >
        <span
          className="map-tile__swatch"
          style={{ background: genreColorVar(genre.name) }}
          aria-hidden="true"
        />
        <span className="map-tile__horizon-body">
          <span className="map-tile__title">{displayName}</span>
          <span className="map-tile__meta">{formatBacklogCount(genre.stats.backlogCount)}</span>
        </span>
      </Pressable>
    )
  }

  // home_turf / exploring — same shape, different tint + rating segment.
  const statsLine = formatTierStatsLine(genre.stats, { includeRating: tier === 'home_turf' })

  return (
    <Pressable
      as="div"
      className={`map-tile map-tile--${tier === 'home_turf' ? 'home' : 'exploring'}`}
      onClick={goToGenre}
      role="link"
      tabIndex={0}
      aria-label={`${displayName} — ${statsLine}`}
    >
      <span className="map-tile__head">
        <span className="map-tile__title">{displayName}</span>
        <ChevronRight size={18} className="map-tile__chevron" aria-hidden="true" />
      </span>
      <span className="map-tile__meta">{statsLine}</span>
    </Pressable>
  )
}

export default GamingMapTile
