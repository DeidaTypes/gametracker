import React from 'react'
import { PLUS_ENABLED } from '../services/plusService'
import './PlusBadge.css'

/**
 * PlusBadge — the small cobalt chip beside a Checkpoint Plus member's name.
 * Same chip shape as StreakFlair. `active` must come from the server's
 * users.plus_active (an author embed, public_profiles, or AuthContext).
 *
 * `inline` is for names set as running text (the Profile <h1>) rather than
 * inside a flex byline that already spaces its children.
 */
export default function PlusBadge({ active, inline = false }) {
  if (!PLUS_ENABLED || !active) return null
  return (
    <span className={`plus-badge${inline ? ' plus-badge--inline' : ''}`} title="Checkpoint Plus">
      Plus
    </span>
  )
}
