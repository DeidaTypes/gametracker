import React, { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import {
  BADGE_CATALOG_FAMILY_COUNT,
  TIER_RANK,
  countEarnedBadgeFamilies,
} from '../data/badges'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import BadgeDetailModal from './BadgeDetailModal'
import Skeleton from './Skeleton'
import './BadgesRow.css'

const TEASER_SLOT_COUNT = 5

/**
 * Profile teaser — folds into the year-challenge card below a hairline.
 * Five highest-tier earned badges, lock placeholders for empty slots,
 * "N of 32 earned", and "See all" to the full badges screen.
 */
function BadgesRow({ userId, onSeeMore, embedded = false }) {
  const { earned, stats, loading } = useBadges(userId)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)

  const sectionClass = `badges-row-section${embedded ? ' badges-row-section--embedded' : ''}`

  const teaserBadges = useMemo(() => {
    const sorted = [...earned].sort((a, b) => {
      const tierDiff = (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0)
      if (tierDiff !== 0) return tierDiff
      return a.name.localeCompare(b.name)
    })
    return sorted.slice(0, TEASER_SLOT_COUNT)
  }, [earned])

  const earnedFamilyCount = countEarnedBadgeFamilies(stats)
  const lockSlotCount = Math.max(0, TEASER_SLOT_COUNT - teaserBadges.length)

  if (!userId) return null

  if (loading) {
    const loadingBody = (
      <>
        <div className="badges-row-section__header">
          <span className="badges-row-section__title text-title">Badges</span>
        </div>
        <div className="badges-row">
          {Array.from({ length: TEASER_SLOT_COUNT }, (_, i) => (
            <div key={i} className="badges-row__item badges-row__item--placeholder">
              <Skeleton className="badges-row__ring-skeleton" variant="circle" width={48} height={48} />
            </div>
          ))}
        </div>
        <Skeleton variant="text" width={96} height={13} />
      </>
    )

    if (embedded) {
      return (
        <>
          <hr className="profile-home__hairline" aria-hidden="true" />
          <div className={sectionClass} aria-label="Badges" aria-busy="true">
            {loadingBody}
          </div>
        </>
      )
    }

    return (
      <section className={sectionClass} aria-label="Badges" aria-busy="true">
        {loadingBody}
      </section>
    )
  }

  const badgesBody = (
    <>
      <div className="badges-row-section__header">
        <span className="badges-row-section__title text-title">Badges</span>
        <button
          type="button"
          className="badges-row-section__see-all text-caption"
          onClick={onSeeMore}
        >
          See all
        </button>
      </div>

      <div className="badges-row" role="list" aria-label="Recent badges">
        {teaserBadges.map((badge) => {
          const Icon = badge.icon
          return (
            <button
              key={badge.id}
              type="button"
              role="listitem"
              className={`badges-row__item badges-row__item--earned badges-row__item--${badge.tier}`}
              onClick={() => setSelectedBadge(badge)}
              aria-label={`${badge.name}, ${badge.tier} earned`}
            >
              <span className={`badges-row__ring badges-row__ring--${badge.tier}`} aria-hidden="true">
                <Icon size={22} strokeWidth={1.75} />
              </span>
            </button>
          )
        })}

        {Array.from({ length: lockSlotCount }, (_, i) => (
          <span
            key={`lock-${i}`}
            role="listitem"
            className="badges-row__item badges-row__item--locked"
            aria-hidden="true"
          >
            <span className="badges-row__ring badges-row__ring--locked">
              <Lock size={18} strokeWidth={1.75} />
            </span>
          </span>
        ))}
      </div>

      <p className="badges-row-section__count text-caption">
        {earnedFamilyCount} of {BADGE_CATALOG_FAMILY_COUNT} earned
      </p>
    </>
  )

  return (
    <>
      {embedded ? (
        <>
          <hr className="profile-home__hairline" aria-hidden="true" />
          <div className={sectionClass} aria-label="Badges">
            {badgesBody}
          </div>
        </>
      ) : (
        <section className={sectionClass} aria-label="Badges">
          {badgesBody}
        </section>
      )}

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
