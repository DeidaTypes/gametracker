import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import { TIER_STYLES } from '../data/badges'
import { getProfile } from '../services/profileService'
import BadgeDetailModal from './BadgeDetailModal'
import './BadgesRow.css'

/**
 * NextBadgeProgress — "up next" strip rendered below the badge icons.
 *
 * Selects the badge with the highest progress-to-target ratio from
 * `inProgress`; falls back to the lowest-target `locked` badge when
 * nothing is in-progress yet. Hidden when all badges are earned.
 */
function NextBadgeProgress({ inProgress, locked, stats, onSelect }) {
  // Pick the badge closest to completion.
  const next = (() => {
    if (inProgress.length > 0) {
      return inProgress.reduce((best, b) => {
        const r = b.progress(stats) / b.target
        const br = best.progress(stats) / best.target
        return r > br ? b : best
      })
    }
    if (locked.length > 0) {
      // Lowest target = easiest unlock.
      return locked.reduce((best, b) => (b.target < best.target ? b : best))
    }
    return null
  })()

  if (!next) return null

  const Icon = next.icon
  const current = next.progress(stats)
  const total = next.target
  const fillPct = Math.max(0, Math.min(100, (current / total) * 100))
  const tierStyle = TIER_STYLES[next.tier] || TIER_STYLES.bronze
  const isPlatinum = next.tier === 'platinum' && tierStyle.gradient
  const iconBorderStyle = isPlatinum
    ? { borderColor: 'transparent', borderImage: `${tierStyle.gradient} 1` }
    : { borderColor: tierStyle.color }

  return (
    <button
      type="button"
      className="nbp"
      onClick={() => onSelect(next)}
      aria-label={`Next badge: ${next.name}, ${current} of ${total}`}
    >
      <div
        className={`nbp__icon nbp__icon--${next.tier}`}
        style={iconBorderStyle}
        aria-hidden="true"
      >
        <Icon size={20} strokeWidth={1.7} />
      </div>

      <div className="nbp__body">
        <div className="nbp__top">
          <span className="nbp__label">Up next</span>
          <span className="nbp__name">{next.name}</span>
          <span className="nbp__count" aria-hidden="true">{current} / {total}</span>
        </div>
        <div
          className="nbp__track"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${current} of ${total}`}
        >
          <div
            className={`nbp__fill nbp__fill--${next.tier}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>
    </button>
  )
}

/**
 * Sprint 5 P9 — Badges row on the Profile Home tab.
 *
 * Renders up to 5 visible badges in a horizontal strip of 64 px circular
 * icons. Earned badges always come first; if fewer than 5 are earned,
 * in-progress badges fill the remaining slots.
 *
 * Visual treatment per Sprint 6 polish spec:
 *   Earned     → cobalt ring (var(--accent)) + full opacity
 *   In-progress → subtle gray ring + 40 % opacity
 *
 * @param {{ user: { id: string }, username?: string }} props
 */
function BadgesRow({ user, username }) {
  const navigate = useNavigate()
  const { earned, inProgress, locked, stats } = useBadges(user?.id)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)

  // Earned first, then in-progress, capped at 5.
  const visible = [...earned, ...inProgress].slice(0, 5)

  if (visible.length === 0) return null

  // Fast set-lookup for earned badge IDs — avoids O(n) per-badge search.
  const earnedIds = new Set(earned.map((b) => b.id))

  const resolvedUsername =
    username ||
    (() => {
      const p = getProfile()
      return p?.username || p?.displayName || 'me'
    })()

  const handleSeeAll = () => {
    navigate(`/user/${encodeURIComponent(resolvedUsername)}/badges`)
  }

  return (
    <>
      <section className="badges-row-section">
        <div className="badges-row-section__header">
          <h3 className="badges-row-section__title">Badges</h3>
          <button
            type="button"
            className="badges-row-section__chevron"
            onClick={handleSeeAll}
            aria-label="See all badges"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        <div
          className="badges-row"
          role="list"
          aria-label="Badges"
        >
          {visible.map((badge) => {
            const Icon = badge.icon
            const isEarned = earnedIds.has(badge.id)
            return (
              <button
                key={badge.id}
                type="button"
                role="listitem"
                className={`badges-row__item${isEarned ? ' badges-row__item--earned' : ' badges-row__item--unearned'}`}
                onClick={() => setSelectedBadge(badge)}
                aria-label={`${badge.name}, ${isEarned ? 'earned' : 'not earned'}`}
              >
                <Icon size={26} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )
          })}
        </div>

        <NextBadgeProgress
          inProgress={inProgress}
          locked={locked}
          stats={stats}
          onSelect={setSelectedBadge}
        />
      </section>

      <BadgeDetailModal
        badge={selectedBadge}
        stats={stats}
        isOpen={!!selectedBadge}
        onClose={() => setSelectedBadge(null)}
        rarityPct={selectedBadge ? rarityMap.get(selectedBadge.id)?.rarityPct : undefined}
      />
    </>
  )
}

export default BadgesRow
