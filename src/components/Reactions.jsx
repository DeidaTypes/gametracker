import React, { useRef, useState } from 'react'
import { useReactions } from '../hooks/useReactions'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { shouldShowCount } from '../utils/formatSocialCount'
import './Reactions.css'

/**
 * Reactions — cross-surface emoji reaction control.
 *
 * Renders existing reactions as pill buttons (emoji + count).
 * Tapping a pill toggles that emoji. An "add reaction" trigger
 * opens a small picker with the full allowed set.
 *
 * Props:
 *   targetType  'review' | 'list' | 'activity' | 'comment'
 *   targetId    string (UUID)
 *   className   optional extra class
 *
 * Zero-count pills collapse automatically (handled in useReactions).
 */

const ALLOWED_EMOJIS = ['❤️', '🔥', '😂', '😮', '😢', '👏']

export default function Reactions({ targetType, targetId, className = '' }) {
  const { reactions, toggle } = useReactions(targetType, targetId)
  const { reduced } = useMotionPreference()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [burstEmoji, setBurstEmoji] = useState(null)
  const addBtnRef = useRef(null)

  // Emojis the user has NOT yet used on this target (plus ones with 0 count)
  const usedEmojis = new Set(reactions.filter((r) => r.reacted).map((r) => r.emoji))
  const pickerEmojis = ALLOWED_EMOJIS.filter((e) => !usedEmojis.has(e))

  const handleToggle = (emoji) => {
    toggle(emoji)
    if (!reduced) {
      setBurstEmoji(emoji)
      window.setTimeout(() => setBurstEmoji(null), 400)
    }
    setPickerOpen(false)
  }

  return (
    <div className={`reactions${className ? ` ${className}` : ''}`} role="group" aria-label="Reactions">
      {reactions.map(({ emoji, count, reacted }) => (
        <button
          key={emoji}
          type="button"
          className={`reactions__pill${reacted ? ' reactions__pill--active' : ''}${burstEmoji === emoji ? ' reactions__pill--burst' : ''}`}
          onClick={() => handleToggle(emoji)}
          aria-pressed={reacted}
          aria-label={
            shouldShowCount(count)
              ? `${emoji} ${count} reactions${reacted ? ', remove' : ', add'}`
              : `${emoji}${reacted ? ', remove' : ', add'}`
          }
        >
          <span className="reactions__emoji" aria-hidden="true">{emoji}</span>
          {shouldShowCount(count) && <span className="reactions__count">{count}</span>}
        </button>
      ))}

      {/* Add reaction trigger — only shown when at least one emoji is available */}
      {pickerEmojis.length > 0 && (
        <div className="reactions__add-wrap">
          <button
            ref={addBtnRef}
            type="button"
            className={`reactions__add-btn${pickerOpen ? ' reactions__add-btn--open' : ''}`}
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
          >
            <span aria-hidden="true">+</span>
          </button>

          {pickerOpen && (
            <div
              className="reactions__picker"
              role="listbox"
              aria-label="Choose a reaction"
              onMouseLeave={() => setPickerOpen(false)}
            >
              {pickerEmojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="reactions__picker-emoji"
                  onClick={() => handleToggle(emoji)}
                  aria-label={emoji}
                  role="option"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
