import React, { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { ChevronDown } from 'lucide-react'
import {
  BADGE_SHELF_CATEGORIES,
  BADGE_SHELF_HIDDEN_FAMILIES,
  getHighestEarnedTierBadge,
  getRepresentativeBadge,
} from '../data/badges'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import BadgeDetailModal from '../components/BadgeDetailModal'
import Skeleton from '../components/Skeleton'
import './UserBadgesPage.css'

/**
 * Full badges screen — six collapsible category rows. Reachable only via
 * the profile teaser's "See all" (see BadgesRow + Profile.jsx).
 */
function UserBadgesPage() {
  const navigate = useNavigate()
  const { userId: targetUserId, resolving } = useProfileRouteUser()

  const { stats, loading } = useBadges(targetUserId)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  const categories = useMemo(() => {
    return BADGE_SHELF_CATEGORIES.map((cat) => {
      const families = cat.families.filter((id) => !BADGE_SHELF_HIDDEN_FAMILIES.has(id))
      const badges = families.map((familyId) => {
        const earned = getHighestEarnedTierBadge(familyId, stats)
        const representative = getRepresentativeBadge(familyId)
        return {
          familyId,
          earned,
          display: earned || representative,
          locked: !earned,
        }
      })
      const earnedCount = badges.filter((b) => !b.locked).length
      return { ...cat, families, badges, earnedCount }
    }).filter((cat) => cat.badges.length > 0)
  }, [stats])

  const toggleCategory = useCallback((categoryId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }, [])

  const isLoading = resolving || loading

  return (
    <div className="badges-page">
      <header className="badges-page__header">
        <button
          type="button"
          className="badges-page__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="badges-page__title text-title">Badges</h1>
        <span className="badges-page__spacer" aria-hidden="true" />
      </header>

      <div className="badges-page__body">
        {isLoading ? (
          <div className="badges-page__categories" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="badges-page__category-skeleton" />
            ))}
          </div>
        ) : (
          <div className="badges-page__categories">
            {categories.map((category) => {
              const isOpen = expanded.has(category.id)
              const panelId = `badges-cat-${category.id}`

              return (
                <section key={category.id} className="badges-page__category">
                  <button
                    type="button"
                    className="badges-page__category-trigger"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span className="badges-page__category-label text-body">
                      {category.label}
                    </span>
                    <span className="badges-page__category-meta text-caption">
                      {category.earnedCount} earned
                    </span>
                    <ChevronDown
                      size={18}
                      className={`badges-page__category-chevron${isOpen ? ' badges-page__category-chevron--open' : ''}`}
                      aria-hidden="true"
                    />
                  </button>

                  {isOpen && (
                    <div id={panelId} className="badges-page__category-panel">
                      <div className="badges-page__grid">
                        {category.badges.map(({ familyId, display, locked }) => (
                          <BadgeShelfTile
                            key={familyId}
                            badge={display}
                            locked={locked}
                            onClick={() => setSelectedBadge(display)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <BadgeDetailModal
        badge={selectedBadge}
        stats={stats}
        isOpen={!!selectedBadge}
        onClose={() => setSelectedBadge(null)}
        rarityPct={selectedBadge ? rarityMap.get(selectedBadge.id)?.rarityPct : undefined}
      />
    </div>
  )
}

function BadgeShelfTile({ badge, locked, onClick }) {
  const Icon = badge.icon
  const tier = locked ? null : badge.tier

  return (
    <button
      type="button"
      className={`badge-shelf-tile${locked ? ' badge-shelf-tile--locked' : ''}`}
      onClick={onClick}
      aria-label={
        locked
          ? `${badge.name} — locked. ${badge.description}`
          : `${badge.name} — ${badge.tier} earned`
      }
    >
      <span
        className={[
          'badge-shelf-tile__ring',
          tier ? `badge-shelf-tile__ring--${tier}` : 'badge-shelf-tile__ring--locked',
        ].join(' ')}
        aria-hidden="true"
      >
        <Icon size={28} strokeWidth={1.6} />
      </span>
      <span className="badge-shelf-tile__name text-caption">{badge.name}</span>
    </button>
  )
}

export default UserBadgesPage
