import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useBadges } from '../hooks/useBadges'
import { TIER_STYLES } from '../data/badges'
import { getProfile } from '../services/profileService'
import BadgeDetailModal from './BadgeDetailModal'
import './BadgesRow.css'

/**
 * Sprint 5 P9 — Badges row on the Profile Home tab.
 *
 * Renders up to 5 visible badges in a horizontal strip of 64 px circular
 * icons. Earned badges always come first; if fewer than 5 are earned,
 * in-progress badges fill the remaining slots. When the user has neither
 * earned nor started any badge the section disappears entirely (we
 * return `null`) so the Profile Home tab doesn't show a hollow header.
 *
 * Tapping a badge opens BadgeDetailModal — the same modal mounted by
 * the full grid page so progress / target / status copy stays
 * consistent across surfaces.
 *
 * @param {{ user: { id: string }, username?: string }} props
 */
function BadgesRow({ user, username }) {
  const navigate = useNavigate()
  const { earned, inProgress, stats } = useBadges(user?.id)
  const [selectedBadge, setSelectedBadge] = useState(null)

  // Earned first, then in-progress, capped at 5. The badges arrays are
  // already sorted by tier ascending in useBadges, so this preserves
  // bronze → platinum visual rhythm.
  const visible = [...earned, ...inProgress].slice(0, 5)

  if (visible.length === 0) return null

  // Resolve a username for the chevron destination. Prefer the explicit
  // prop, otherwise fall back to the locally-stored profile (since this
  // surface only renders for the signed-in user in Sprint 5).
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

        <div className="badges-row" role="list">
          {visible.map((badge) => {
            const Icon = badge.icon
            const tierStyle = TIER_STYLES[badge.tier] || TIER_STYLES.bronze
            const borderStyle =
              badge.tier === 'platinum' && tierStyle.gradient
                ? {
                    borderColor: 'transparent',
                    borderImage: `${tierStyle.gradient} 1`,
                  }
                : { borderColor: tierStyle.color }
            return (
              <button
                key={badge.id}
                type="button"
                role="listitem"
                className={`badges-row__item badges-row__item--${badge.tier}`}
                style={borderStyle}
                onClick={() => setSelectedBadge(badge)}
                aria-label={`${badge.name} — ${badge.tier} badge`}
              >
                <Icon size={26} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </section>

      <BadgeDetailModal
        badge={selectedBadge}
        stats={stats}
        isOpen={!!selectedBadge}
        onClose={() => setSelectedBadge(null)}
      />
    </>
  )
}

export default BadgesRow
