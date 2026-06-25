import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { TIER_STYLES } from '../data/badges'
import './BadgeDetailModal.css'

/**
 * Sprint 5 P9 — Badge detail modal.
 *
 * Reuses the shared `.modal-overlay` / `.modal-content` shell defined
 * in CreateListModal.css so the chrome (backdrop blur, slide-in,
 * mobile bottom-sheet behavior) matches every other modal in the app.
 *
 * Render contract:
 *   - Large tier-bordered icon (the spec says "48px"; the bordered
 *     wrapper is 88px so the 48px lucide glyph centers cleanly with a
 *     3px tier border).
 *   - Badge name (serif display).
 *   - UPPERCASE tier label.
 *   - Description body copy.
 *   - Progress bar with `progress / target` text and width = (p/t)*100%.
 *   - Status line: 'Earned' | 'In progress' | 'Locked'.
 *
 * The same modal is mounted by BadgesRow (Profile Home tab) and
 * UserBadgesPage (full grid), so any change here flows to both.
 */
function BadgeDetailModal({ badge, stats, isOpen, onClose, rarityPct }) {
  useEffect(() => {
    if (!isOpen) return undefined
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen || !badge) return null

  const Icon = badge.icon
  const tierStyle = TIER_STYLES[badge.tier] || TIER_STYLES.bronze
  const progress = badge.progress(stats)
  const target = badge.target
  const earned = badge.isEarned(stats)
  const status = earned ? 'Earned' : progress > 0 ? 'In progress' : 'Locked'
  const fillPercent = Math.max(0, Math.min(100, (progress / target) * 100))

  // Platinum uses a metallic gradient — we set the border via
  // border-image so the gradient renders crisply at the 3px width
  // without compositing artifacts.
  const iconBorderStyle =
    badge.tier === 'platinum' && tierStyle.gradient
      ? {
          borderColor: 'transparent',
          borderImage: `${tierStyle.gradient} 1`,
        }
      : { borderColor: tierStyle.color }

  return createPortal(
    <div
      className="modal-overlay badge-detail-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-detail-title"
    >
      <div
        className="modal-content badge-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close-button badge-detail-modal__close"
          onClick={onClose}
          aria-label="Close badge details"
        >
          ×
        </button>

        <div
          className={`badge-detail-modal__icon-wrap badge-detail-modal__icon-wrap--${badge.tier}`}
          style={iconBorderStyle}
          aria-hidden="true"
        >
          <Icon size={48} strokeWidth={1.6} />
        </div>

        <h2 id="badge-detail-title" className="badge-detail-modal__name">
          {badge.name}
        </h2>

        <p className={`badge-detail-modal__tier badge-detail-modal__tier--${badge.tier}`}>
          {badge.tier}
        </p>

        <p className="badge-detail-modal__desc">{badge.description}</p>

        <div className="badge-detail-modal__progress" aria-label="Progress">
          <div className="badge-detail-modal__progress-track">
            <div
              className={`badge-detail-modal__progress-fill badge-detail-modal__progress-fill--${badge.tier}`}
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <div className="badge-detail-modal__progress-text">
            {progress} / {target}
          </div>
        </div>

        <p className={`badge-detail-modal__status badge-detail-modal__status--${earned ? 'earned' : progress > 0 ? 'in-progress' : 'locked'}`}>
          {status}
        </p>

        {rarityPct != null && (
          <p className="badge-detail-modal__rarity">
            {rarityPct > 0
              ? `${rarityPct}% of players have this`
              : 'Be the first to earn this!'}
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}

export default BadgeDetailModal
