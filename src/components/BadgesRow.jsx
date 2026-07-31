import React, { useState } from 'react'
import { Lock } from 'lucide-react'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import BadgeDetailModal from './BadgeDetailModal'
import Skeleton from './Skeleton'
import './BadgesRow.css'

// How many earned badges fit the row before the locked teaser tile.
const MAX_EARNED_TILES = 4

/**
 * Sprint 5 P9 — Badges row on the Profile Home tab.
 *
 * Earned badges first (newest tier last, as useBadges sorts them), then a
 * single locked tile teasing the closest unearned badge. Tapping a tile
 * opens the badge detail modal; "See more" pushes the full badges view.
 *
 * Badge counters are derived from the signed-in device (see useUserStats),
 * so this only ever renders for the profile owner — a null `userId` yields
 * no earned and no in-progress badges, and the section hides itself.
 *
 * @param {{
 *   userId: string|null,
 *   onSeeMore: () => void,
 * }} props
 */
function BadgesRow({ userId, onSeeMore }) {
  const { earned, inProgress, locked, stats, loading } = useBadges(userId)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)

  // Placeholder tiles at the row's real height while the counters resolve,
  // so the sections below don't jump once badges land.
  if (loading) {
    return (
      <section className="badges-row-section" aria-label="Badges" aria-busy="true">
        <div className="badges-row-section__header">
          <h3 className="badges-row-section__title">Badges</h3>
        </div>
        <div className="badges-row">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="badges-row__item badges-row__item--placeholder">
              <Skeleton className="badges-row__tile-skeleton" />
              <Skeleton variant="text" width={40} height={11} />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (earned.length === 0 && inProgress.length === 0) return null

  // The closest unearned badge — highest completion ratio, else the
  // cheapest fully-locked one. Same pick the badges page leads with.
  const nextLocked = (() => {
    if (inProgress.length > 0) {
      return inProgress.reduce((best, b) =>
        b.progress(stats) / b.target > best.progress(stats) / best.target ? b : best
      )
    }
    if (locked.length > 0) {
      return locked.reduce((best, b) => (b.target < best.target ? b : best))
    }
    return null
  })()

  const tiles = earned.slice(0, MAX_EARNED_TILES)

  return (
    <>
      <section className="badges-row-section" aria-label="Badges">
        <div className="badges-row-section__header">
          <h3 className="badges-row-section__title">Badges</h3>
          <button
            type="button"
            className="badges-row-section__see-more"
            onClick={onSeeMore}
          >
            See more
          </button>
        </div>

        <div className="badges-row" role="list" aria-label="Badges">
          {tiles.map((badge) => {
            const Icon = badge.icon
            return (
              <button
                key={badge.id}
                type="button"
                role="listitem"
                className={`badges-row__item badges-row__item--earned badges-row__item--${badge.tier}`}
                onClick={() => setSelectedBadge(badge)}
                aria-label={`${badge.name}, earned`}
              >
                <span className="badges-row__tile" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} />
                </span>
                <span className="badges-row__label">{badge.name}</span>
              </button>
            )
          })}

          {nextLocked && (
            <button
              type="button"
              role="listitem"
              className="badges-row__item badges-row__item--locked"
              onClick={() => setSelectedBadge(nextLocked)}
              aria-label={`Locked badge: ${nextLocked.name}. ${nextLocked.description}`}
            >
              <span className="badges-row__tile" aria-hidden="true">
                <Lock size={20} strokeWidth={1.8} />
              </span>
              <span className="badges-row__label">Locked</span>
            </button>
          )}
        </div>
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
