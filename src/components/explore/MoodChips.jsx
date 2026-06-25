import React from 'react'
import { MOOD_CHIPS } from '../../services/igdb'
import './MoodChips.css'

/**
 * MoodChips — horizontal row of mood-seed entry chips for the Swipe Deck.
 *
 * Each chip maps to an explicit IGDB filter (see igdb.js MOOD_CHIPS).
 * Tapping a chip selects it (seeds the deck with that mood); tapping the
 * active chip deselects it (returns to the default discovery deck).
 * Chips whose moods produced an empty deck are passed in via `emptyMoods`
 * and hidden so the user never sees a dead-end option.
 */
export function MoodChips({ activeMood, onSelect, emptyMoods = new Set() }) {
  const visibleChips = MOOD_CHIPS.filter((m) => !emptyMoods.has(m.id))

  if (visibleChips.length === 0) return null

  return (
    <div
      className="mood-chips"
      role="group"
      aria-label="Browse games by mood"
    >
      {visibleChips.map((mood) => {
        const isActive = activeMood === mood.id
        return (
          <button
            key={mood.id}
            type="button"
            className={`mood-chip${isActive ? ' mood-chip--active' : ''}`}
            onClick={() => onSelect(isActive ? null : mood.id)}
            aria-pressed={isActive}
          >
            <span className="mood-chip__emoji" aria-hidden="true">
              {mood.emoji}
            </span>
            <span className="mood-chip__label">{mood.label}</span>
          </button>
        )
      })}
    </div>
  )
}
