import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Lock } from 'lucide-react'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import { TIER_STYLES } from '../data/badges'
import BadgeDetailModal from '../components/BadgeDetailModal'
import Skeleton from '../components/Skeleton'
import './UserBadgesPage.css'

/**
 * Full badge grid for `/user/:username/badges` and
 * `/user/id/:userId/badges`.
 *
 * A filter above the grid switches between Earned / All / Not earned.
 * "All" keeps the three-section reading order (Earned → In Progress →
 * Locked) so prestige still sorts top-down; the other two filters render
 * one flat grid.
 *
 * Not-earned cards render dimmed with a Lock overlay and their unlock
 * condition beneath the name, so a locked badge always says what it
 * takes rather than just teasing. Tapping any card opens
 * BadgeDetailModal (shared with BadgesRow).
 */

const FILTERS = [
  { id: 'earned', label: 'Earned' },
  { id: 'all', label: 'All' },
  { id: 'not-earned', label: 'Not earned' },
]

function UserBadgesPage() {
  const navigate = useNavigate()
  const { userId: targetUserId, resolving } = useProfileRouteUser()

  const { earned, inProgress, locked, stats, loading } = useBadges(targetUserId)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)
  const [filter, setFilter] = useState('earned')

  const notEarned = [...inProgress, ...locked]

  const sections =
    filter === 'earned'
      ? [{ id: 'earned', title: null, items: earned, locked: false }]
      : filter === 'not-earned'
      ? [
          { id: 'in-progress', title: 'In Progress', items: inProgress, locked: true },
          { id: 'locked', title: 'Locked', items: locked, locked: true },
        ]
      : [
          { id: 'earned', title: 'Earned', items: earned, locked: false },
          { id: 'in-progress', title: 'In Progress', items: inProgress, locked: true },
          { id: 'locked', title: 'Locked', items: locked, locked: true },
        ]

  const emptyCopy =
    filter === 'earned'
      ? 'No badges earned yet. Keep playing, reviewing, and building lists.'
      : filter === 'not-earned'
      ? 'Every badge is earned. Nothing left to unlock.'
      : 'No badges yet.'

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
        <h1 className="badges-page__title">Badges</h1>
        <span className="badges-page__spacer" aria-hidden="true" />
      </header>

      <div className="badges-page__filters" role="tablist" aria-label="Filter badges">
        {FILTERS.map((f) => {
          const count =
            f.id === 'earned' ? earned.length : f.id === 'not-earned' ? notEarned.length : null
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`badges-page__filter${
                filter === f.id ? ' badges-page__filter--active' : ''
              }`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {!isLoading && count != null && (
                <span className="badges-page__filter-count">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="badges-page__body">
        {isLoading ? (
          <div className="badges-page__grid" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="badges-page__card-skeleton" />
            ))}
          </div>
        ) : sections.every((s) => s.items.length === 0) ? (
          <p className="badges-page__empty">{emptyCopy}</p>
        ) : (
          sections.map((section) =>
            section.items.length === 0 ? null : (
              <section key={section.id} className="badges-page__section">
                {section.title && (
                  <h2 className="badges-page__section-title">{section.title}</h2>
                )}
                <div className="badges-page__grid">
                  {section.items.map((badge) => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      locked={section.locked}
                      rarityPct={rarityMap.get(badge.id)?.rarityPct}
                      onClick={() => setSelectedBadge(badge)}
                    />
                  ))}
                </div>
              </section>
            )
          )
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

function BadgeCard({ badge, locked, rarityPct, onClick }) {
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
      type="button"
      className={`badge-card${locked ? ' badge-card--locked' : ''}`}
      onClick={onClick}
      aria-label={`${badge.name} — ${badge.tier} ${locked ? 'locked' : 'badge'}`}
    >
      <div className="badge-card__icon-stack">
        <div
          className={`badge-card__icon badge-card__icon--${badge.tier}`}
          style={borderStyle}
          aria-hidden="true"
        >
          <Icon size={32} strokeWidth={1.6} />
        </div>
        {locked && (
          <span className="badge-card__lock" aria-hidden="true">
            <Lock size={12} strokeWidth={2.4} />
          </span>
        )}
      </div>
      <span className="badge-card__name">{badge.name}</span>
      {locked ? (
        <span className="badge-card__condition">{badge.description}</span>
      ) : (
        rarityPct != null && (
          <span className="badge-card__rarity" aria-label={`${rarityPct}% of players`}>
            {rarityPct}%
          </span>
        )
      )}
    </button>
  )
}

export default UserBadgesPage
