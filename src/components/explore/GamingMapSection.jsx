import React, { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
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

// Render density caps only — tier membership/ranking above is untouched.
// Each tier still HAS every genre it always had; these just gate how many
// render before the user opts into "See all" so the section stays
// scannable instead of flooding the screen with every genre as a full tile.
const STANDARD_TIER_CAP = 4
const NOT_YET_CAP = 8

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
 * One tier band: label, a capped grid of tiles, and a "See all" toggle when
 * there are more genres than the cap. Purely a client-side show/hide over
 * the same already-ranked `genres` array — no re-fetch, no re-ranking.
 */
function TierBand({
  tier, genres, cap, tileGridClassName, labelClassName, label, labelSub, expanded, onToggle,
}) {
  if (genres.length === 0) return null

  const visible = expanded ? genres : genres.slice(0, cap)
  const remaining = genres.length - visible.length

  return (
    <div className="gaming-map__tier">
      <span className={`map-tier-label ${labelClassName}`}>
        {label}
        {labelSub && <span className="map-tier-label__sub"> · {labelSub}</span>}
      </span>
      <div className={`gaming-map__grid ${tileGridClassName}`}>
        {visible.map((genre) => (
          <GamingMapTile key={genre.id} genre={genre} tier={tier} />
        ))}
      </div>
      {(remaining > 0 || expanded) && genres.length > cap && (
        <button type="button" className="gaming-map__see-all" onClick={onToggle}>
          {expanded ? 'Show less' : `See all ${genres.length}`}
          <ChevronDown
            size={14}
            className={`gaming-map__see-all-chevron${expanded ? ' gaming-map__see-all-chevron--up' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
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
 * Each band only RENDERS its top few (STANDARD_TIER_CAP / NOT_YET_CAP) —
 * "See all" reveals the rest in place. This is a display cap, not a data
 * cap: tier membership and within-tier ranking always come straight from
 * getGamingMap untouched.
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
  const [expandedTiers, setExpandedTiers] = useState({})

  const byTier = useMemo(() => ({
    home_turf: tierGenres(data, 'home_turf'),
    exploring: tierGenres(data, 'exploring'),
    on_horizon: tierGenres(data, 'on_horizon'),
    not_yet: tierGenres(data, 'not_yet'),
  }), [data])

  if (loading) return <GamingMapSkeleton />

  const hasAnyTier = Object.values(byTier).some((genres) => genres.length > 0)
  if (!data || !hasAnyTier) return null

  const toggleTier = (tier) => {
    setExpandedTiers((prev) => ({ ...prev, [tier]: !prev[tier] }))
  }

  return (
    <section className="explore-section gaming-map-section" aria-label="Your gaming map">
      <div className="explore-section__pad gaming-map__head">
        <h2 className="discover-section-title">Your gaming map</h2>
        <p className="gaming-map__subtitle">Built from what you actually play</p>
      </div>

      <div className="explore-section__pad gaming-map__body">
        <TierBand
          tier="home_turf"
          genres={byTier.home_turf}
          cap={STANDARD_TIER_CAP}
          tileGridClassName="gaming-map__grid--2col"
          labelClassName="map-tier-label--home"
          label={TIER_LABELS.home_turf}
          expanded={!!expandedTiers.home_turf}
          onToggle={() => toggleTier('home_turf')}
        />

        <TierBand
          tier="exploring"
          genres={byTier.exploring}
          cap={STANDARD_TIER_CAP}
          tileGridClassName="gaming-map__grid--2col"
          labelClassName="map-tier-label--exploring"
          label={TIER_LABELS.exploring}
          expanded={!!expandedTiers.exploring}
          onToggle={() => toggleTier('exploring')}
        />

        <TierBand
          tier="on_horizon"
          genres={byTier.on_horizon}
          cap={STANDARD_TIER_CAP}
          tileGridClassName="gaming-map__grid--2col"
          labelClassName="map-tier-label--horizon"
          label={TIER_LABELS.on_horizon}
          labelSub="in your backlog"
          expanded={!!expandedTiers.on_horizon}
          onToggle={() => toggleTier('on_horizon')}
        />

        <TierBand
          tier="not_yet"
          genres={byTier.not_yet}
          cap={NOT_YET_CAP}
          tileGridClassName="gaming-map__grid--chips"
          labelClassName="map-tier-label--unexplored"
          label={TIER_LABELS.not_yet}
          labelSub="tap any to look inside"
          expanded={!!expandedTiers.not_yet}
          onToggle={() => toggleTier('not_yet')}
        />

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
