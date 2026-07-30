import React, { useMemo } from 'react'
import { useGamingMap } from '../../hooks/useExploreData'
import { TIER_LABELS } from '../../services/gamingMapService'
import GamingMapTile from './GamingMapTile'
import VentureOutCard from './VentureOutCard'
import './GamingMapSection.css'

// Genres within a tier are ordered by tierRank (best-first — see
// assignTiers in gamingMapService.js), not by the canonical sortOrder the
// API returns them in, so bands read strongest-to-weakest.
function tierGenres(data, tier) {
  if (!data) return []
  return data.genres
    .filter((g) => g.tier === tier)
    .sort((a, b) => a.tierRank - b.tierRank)
}

function GamingMapSkeleton() {
  return (
    <section className="explore-section gaming-map-section" aria-hidden="true">
      <div className="explore-section__pad gaming-map__head">
        <div className="skeleton gaming-map__skel-title" />
        <div className="skeleton gaming-map__skel-subtitle" />
      </div>
      <div className="explore-section__pad gaming-map__body">
        <div className="gaming-map__grid gaming-map__grid--2col">
          <div className="skeleton gaming-map__skel-tile" />
          <div className="skeleton gaming-map__skel-tile" />
        </div>
      </div>
    </section>
  )
}

/**
 * Your Gaming Map — Discover section, between "Swipe to discover" (top)
 * and "Collections" (bottom).
 *
 * Renders the user's 23 formal IGDB genres grouped strictly by tier, in
 * fixed bands (Home turf → Exploring → On the horizon → Haven't explored).
 * Every genre in `data.genres` is real — sourced from getGamingMap, which
 * derives tiers from the user's own library/backlog/sessions/ratings and
 * never fabricates a genre, count, or rating. A tier band with zero genres
 * hides entirely (e.g. a new user has no Home turf yet).
 *
 * Venture Out targets the single top-ranked "haven't explored" genre
 * (byTier.not_yet[0] — already sorted best-first by tierRank) and is keyed
 * on that genre's id: when the user actually plays/logs/rates a game in it,
 * the next getGamingMap load (mount or app-resume) moves it out of not_yet,
 * the key changes, and Venture Out fully remounts onto whichever genre is
 * now first — "advancing" without this component needing any special
 * transition logic of its own.
 */
export default function GamingMapSection() {
  const { data, loading } = useGamingMap()

  const byTier = useMemo(() => ({
    home_turf: tierGenres(data, 'home_turf'),
    exploring: tierGenres(data, 'exploring'),
    on_horizon: tierGenres(data, 'on_horizon'),
    not_yet: tierGenres(data, 'not_yet'),
  }), [data])

  if (loading) return <GamingMapSkeleton />

  const hasAnyTier = Object.values(byTier).some((genres) => genres.length > 0)
  if (!data || !hasAnyTier) return null

  return (
    <section className="explore-section gaming-map-section" aria-label="Your gaming map">
      <div className="explore-section__pad gaming-map__head">
        <h2 className="discover-section-title">Your gaming map</h2>
        <p className="gaming-map__subtitle">Built from what you actually play</p>
      </div>

      <div className="explore-section__pad gaming-map__body">
        {byTier.home_turf.length > 0 && (
          <div className="gaming-map__tier">
            <span className="map-tier-label map-tier-label--home">
              {TIER_LABELS.home_turf}
            </span>
            <div className="gaming-map__grid gaming-map__grid--2col">
              {byTier.home_turf.map((genre) => (
                <GamingMapTile key={genre.id} genre={genre} tier="home_turf" />
              ))}
            </div>
          </div>
        )}

        {byTier.exploring.length > 0 && (
          <div className="gaming-map__tier">
            <span className="map-tier-label map-tier-label--exploring">
              {TIER_LABELS.exploring}
            </span>
            <div className="gaming-map__grid gaming-map__grid--2col">
              {byTier.exploring.map((genre) => (
                <GamingMapTile key={genre.id} genre={genre} tier="exploring" />
              ))}
            </div>
          </div>
        )}

        {byTier.on_horizon.length > 0 && (
          <div className="gaming-map__tier">
            <span className="map-tier-label map-tier-label--horizon">
              {TIER_LABELS.on_horizon}
              <span className="map-tier-label__sub"> · in your backlog</span>
            </span>
            <div className="gaming-map__grid gaming-map__grid--2col">
              {byTier.on_horizon.map((genre) => (
                <GamingMapTile key={genre.id} genre={genre} tier="on_horizon" />
              ))}
            </div>
          </div>
        )}

        {byTier.not_yet.length > 0 && (
          <div className="gaming-map__tier">
            <span className="map-tier-label map-tier-label--unexplored">
              {TIER_LABELS.not_yet}
              <span className="map-tier-label__sub"> · tap any to look inside</span>
            </span>
            <div className="gaming-map__grid gaming-map__grid--3col">
              {byTier.not_yet.map((genre) => (
                <GamingMapTile key={genre.id} genre={genre} tier="not_yet" />
              ))}
            </div>
          </div>
        )}

        {byTier.not_yet.length > 0 && (
          <VentureOutCard
            key={byTier.not_yet[0].id}
            genre={byTier.not_yet[0]}
            homeTurfGenre={byTier.home_turf[0] || null}
          />
        )}
      </div>
    </section>
  )
}
