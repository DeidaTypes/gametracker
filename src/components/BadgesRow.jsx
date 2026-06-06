import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useBadges } from '../hooks/useBadges'
import { getProfile } from '../services/profileService'
import BadgeDetailModal from './BadgeDetailModal'
import './BadgesRow.css'

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
  const { earned, inProgress, stats } = useBadges(user?.id)
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
