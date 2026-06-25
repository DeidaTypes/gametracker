import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import { getProfile } from '../services/profileService'
import { getUserByUsername } from '../services/userService'
import { TIER_STYLES } from '../data/badges'
import BadgeDetailModal from '../components/BadgeDetailModal'
import './UserBadgesPage.css'

/**
 * Sprint 5 P9 — Full badge grid for `/user/:username/badges`.
 *
 * Three sections in fixed order: Earned, In Progress, Locked. Each
 * section is a 3-column grid of cards (icon + name). Empty sections
 * are hidden — a user with zero earned badges should never see an
 * empty "Earned" header.
 *
 * Locked cards render at opacity 0.4 with a small Lock overlay in
 * the top-right so the visual weight makes the unlocked badges pop.
 *
 * Tapping any card opens BadgeDetailModal (shared with BadgesRow).
 *
 * Resolving the user:
 *   - For the signed-in user we already have their id from useAuth and
 *     can short-circuit the network round-trip.
 *   - For anyone else, we look them up by username via getUserByUsername
 *     (the same lookup the Search Users tab uses). If the lookup fails
 *     we fall back to the signed-in user so the page never renders an
 *     error wall — the badges system is local-only this sprint, and
 *     there's nothing meaningful to show for a stranger anyway.
 */
function UserBadgesPage() {
  const navigate = useNavigate()
  const { username } = useParams()
  const { user: authUser } = useAuth()

  const [targetUserId, setTargetUserId] = useState(authUser?.id || null)

  // Resolve the user id from the URL :username param. Fast-path when
  // it matches the signed-in user's local profile so we don't hit
  // Supabase for the common own-profile case.
  useEffect(() => {
    let cancelled = false
    async function resolve() {
      const localProfile = getProfile()
      const localUsername =
        localProfile?.username || localProfile?.displayName || ''
      const decoded = decodeURIComponent(username || '')
      if (
        authUser?.id &&
        decoded &&
        localUsername &&
        decoded.toLowerCase() === localUsername.toLowerCase()
      ) {
        if (!cancelled) setTargetUserId(authUser.id)
        return
      }

      if (!decoded) {
        if (!cancelled) setTargetUserId(authUser?.id || null)
        return
      }

      try {
        const row = await getUserByUsername(decoded)
        if (!cancelled) setTargetUserId(row?.id || authUser?.id || null)
      } catch {
        if (!cancelled) setTargetUserId(authUser?.id || null)
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [username, authUser?.id])

  const { earned, inProgress, locked, stats } = useBadges(targetUserId)
  const rarityMap = useBadgeRarity()
  const [selectedBadge, setSelectedBadge] = useState(null)

  const sections = [
    { id: 'earned', title: 'Earned', items: earned, locked: false },
    { id: 'in-progress', title: 'In Progress', items: inProgress, locked: false },
    { id: 'locked', title: 'Locked', items: locked, locked: true },
  ]

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

      <div className="badges-page__body">
        {sections.every((s) => s.items.length === 0) ? (
          <p className="badges-page__empty">No badges yet.</p>
        ) : (
          sections.map((section) =>
            section.items.length === 0 ? null : (
              <section key={section.id} className="badges-page__section">
                <h2 className="badges-page__section-title">{section.title}</h2>
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
      {rarityPct != null && (
        <span className="badge-card__rarity" aria-label={`${rarityPct}% of players`}>
          {rarityPct}%
        </span>
      )}
    </button>
  )
}

export default UserBadgesPage
