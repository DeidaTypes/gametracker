import React, { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, X, Check, Award } from 'lucide-react'
import { useShowcaseBadges } from '../hooks/useShowcaseBadges'
import { useBadges } from '../hooks/useBadges'
import { useBadgeRarity } from '../hooks/useBadgeRarity'
import { BADGES, TIER_STYLES } from '../data/badges'
import EmptyState from './EmptyState'
import './BadgeShowcase.css'

const MAX_PINS = 3

/**
 * BadgeShowcase — "pinned badges" section shown near the top of the
 * Profile Home tab.
 *
 * Renders up to MAX_PINS (3) badge slots with large tier-ringed icons.
 * - Visitors: sees the slots; empty slots are hidden.
 * - Own profile: edit pencil opens a picker sheet to choose badges.
 *
 * Returns null entirely when there are no pinned badges AND the viewer
 * is not the profile owner (so public profiles don't show an empty gap).
 *
 * @param {{ user: { id: string }, isOwnProfile: boolean }} props
 */
function BadgeShowcase({ user, isOwnProfile }) {
  const userId = user?.id || null
  const { showcaseIds, setShowcase, isLoading } = useShowcaseBadges(userId, isOwnProfile)
  const { earned } = useBadges(isOwnProfile ? userId : null)
  const rarityMap = useBadgeRarity()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Map badge IDs → badge objects for fast rendering.
  const badgeById = BADGES.reduce((m, b) => { m[b.id] = b; return m }, {})

  // Resolve the actual badge objects for showcase slots (some IDs may no
  // longer be valid if catalogue changes — skip unknowns).
  const pinnedBadges = showcaseIds
    .map((id) => badgeById[id])
    .filter(Boolean)

  // Hide the section entirely for visitors when nothing is pinned.
  if (!isOwnProfile && pinnedBadges.length === 0) return null
  // During first load don't flash an empty section.
  if (isLoading && pinnedBadges.length === 0 && !isOwnProfile) return null

  return (
    <>
      <section className="badge-showcase">
        <div className="badge-showcase__header">
          <h3 className="badge-showcase__title">Showcase</h3>
          {isOwnProfile && (
            <button
              type="button"
              className="badge-showcase__edit"
              onClick={() => setPickerOpen(true)}
              aria-label="Edit badge showcase"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="badge-showcase__slots" role="list" aria-label="Showcase badges">
          {Array.from({ length: MAX_PINS }).map((_, i) => {
            const badge = pinnedBadges[i]
            if (!badge) {
              // Empty slot — only show placeholder on own profile.
              if (!isOwnProfile) return null
              return (
                <button
                  key={`empty-${i}`}
                  type="button"
                  role="listitem"
                  className="badge-showcase__slot badge-showcase__slot--empty"
                  onClick={() => setPickerOpen(true)}
                  aria-label="Add badge to showcase"
                >
                  <span className="badge-showcase__slot-plus" aria-hidden="true">+</span>
                </button>
              )
            }
            return (
              <BadgeSlot
                key={badge.id}
                badge={badge}
                rarityPct={rarityMap.get(badge.id)?.rarityPct}
              />
            )
          })}
        </div>
      </section>

      {pickerOpen && (
        <ShowcasePicker
          earned={earned}
          currentIds={showcaseIds}
          onSave={async (newIds) => {
            await setShowcase(newIds)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

/* ──────────────────────────────────────────────────────────────
   BadgeSlot — one filled slot in the showcase row.
   ────────────────────────────────────────────────────────────── */
function BadgeSlot({ badge, rarityPct }) {
  const Icon = badge.icon
  const tierStyle = TIER_STYLES[badge.tier] || TIER_STYLES.bronze
  const isPlatinum = badge.tier === 'platinum' && tierStyle.gradient
  const borderStyle = isPlatinum
    ? { borderColor: 'transparent', borderImage: `${tierStyle.gradient} 1` }
    : { borderColor: tierStyle.color }

  return (
    <div
      role="listitem"
      className="badge-showcase__slot"
      aria-label={badge.name}
    >
      <div
        className={`badge-showcase__icon badge-showcase__icon--${badge.tier}`}
        style={borderStyle}
        aria-hidden="true"
      >
        <Icon size={30} strokeWidth={1.6} />
      </div>
      <span className="badge-showcase__name">{badge.name}</span>
      {rarityPct != null && (
        <span className="badge-showcase__rarity" aria-label={`${rarityPct}% of players`}>
          {rarityPct > 0 ? `${rarityPct}%` : '<1%'}
        </span>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   ShowcasePicker — modal sheet for selecting up to 3 badges.
   ────────────────────────────────────────────────────────────── */
function ShowcasePicker({ earned, currentIds, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(currentIds))
  const [saving, setSaving] = useState(false)

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < MAX_PINS) {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    // Preserve the original order for already-pinned badges; append new ones.
    const ordered = [
      ...currentIds.filter((id) => selected.has(id)),
      ...Array.from(selected).filter((id) => !currentIds.includes(id)),
    ].slice(0, MAX_PINS)
    try {
      await onSave(ordered)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="modal-overlay badge-picker-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-picker-title"
    >
      <div
        className="modal-content badge-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="badge-picker-modal__header">
          <h2 id="badge-picker-title" className="badge-picker-modal__title">
            Choose Showcase Badges
          </h2>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Close picker"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="badge-picker-modal__hint">
          {selected.size} / {MAX_PINS} selected
        </p>

        {earned.length === 0 ? (
          <EmptyState icon={Award} size="compact" body="Earn some badges to start a showcase!" />
        ) : (
          <ul className="badge-picker-modal__list" role="listbox" aria-multiselectable="true">
            {earned.map((badge) => {
              const Icon = badge.icon
              const tierStyle = TIER_STYLES[badge.tier] || TIER_STYLES.bronze
              const isPlatinum = badge.tier === 'platinum' && tierStyle.gradient
              const borderStyle = isPlatinum
                ? { borderColor: 'transparent', borderImage: `${tierStyle.gradient} 1` }
                : { borderColor: tierStyle.color }
              const isSelected = selected.has(badge.id)
              const isDisabled = !isSelected && selected.size >= MAX_PINS

              return (
                <li key={badge.id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={isDisabled}
                    className={`badge-picker-item${isSelected ? ' badge-picker-item--selected' : ''}${isDisabled ? ' badge-picker-item--disabled' : ''}`}
                    onClick={() => toggle(badge.id)}
                  >
                    <div
                      className={`badge-picker-item__icon badge-picker-item__icon--${badge.tier}`}
                      style={borderStyle}
                      aria-hidden="true"
                    >
                      <Icon size={22} strokeWidth={1.6} />
                    </div>
                    <div className="badge-picker-item__body">
                      <span className="badge-picker-item__name">{badge.name}</span>
                      <span className={`badge-picker-item__tier badge-picker-item__tier--${badge.tier}`}>
                        {badge.tier}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="badge-picker-item__check" aria-hidden="true">
                        <Check size={16} strokeWidth={2.5} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          className="badge-picker-modal__save btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Showcase'}
        </button>
      </div>
    </div>,
    document.body
  )
}

export default BadgeShowcase
