import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePresence } from '../hooks/usePresence'
import { useSession } from '../contexts/SessionContext'
import PulseDot from './PulseDot'
import { supabase } from '../services/supabase'
import './CoopSignalCard.css'

/**
 * CoopSignalCard — live co-op signal on the Home screen.
 *
 * Appears ONLY when the current user has an active play session AND at
 * least one followed user (detected via the Pulse presence channel) is
 * playing the exact same game at the same time. It is silently hidden
 * otherwise — no skeleton, no empty state.
 *
 * Each co-present user gets a "Message [name]" pill that deep-links to
 * the 1:1 DM thread at /messages/:username. Up to three users are shown
 * before the overflow is collapsed into the names line.
 *
 * Data flow:
 *   usePresence().playingNow  →  filter by myGameId  →  coopUsers
 *   coopUsers userIds          →  batch Supabase lookup  →  profiles map
 *   profiles                   →  username route + display label
 */

async function fetchProfiles(userIds) {
  if (!userIds.length) return {}
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds)
  if (error) {
    console.error('[coop] fetchProfiles failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((u) => [u.id, u]))
}

function buildNamesLine(users, profiles) {
  const names = users.map((u) => {
    const p = profiles[u.userId]
    return p?.display_name || p?.username || '\u2026'
  })
  if (names.length === 1) return `${names[0]} is also playing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are also playing`
  const extra = names.length - 2
  return `${names[0]}, ${names[1]} +${extra} more are also playing`
}

export default function CoopSignalCard() {
  const navigate = useNavigate()
  const { playingNow } = usePresence()
  const { session } = useSession()
  const [profiles, setProfiles] = useState({})

  const myGameId =
    session?.igdb_game_id != null ? Number(session.igdb_game_id) : null

  // Followed users playing the same game as the current user right now.
  const coopUsers = useMemo(() => {
    if (myGameId == null) return []
    return playingNow.filter((p) => p.gameId === myGameId)
  }, [playingNow, myGameId])

  // Stable string key — only triggers a re-fetch when the set of user
  // IDs actually changes, not on every presence ping.
  const coopIdsKey = useMemo(
    () =>
      coopUsers
        .map((u) => u.userId)
        .sort()
        .join(','),
    [coopUsers]
  )

  useEffect(() => {
    const ids = coopUsers.map((u) => u.userId)
    if (!ids.length) {
      setProfiles({})
      return undefined
    }
    let cancelled = false
    fetchProfiles(ids).then((map) => {
      if (!cancelled) setProfiles(map)
    })
    return () => {
      cancelled = true
    }
    // coopIdsKey is the stable derived dep — rebuilding on every coopUsers
    // reference change would trigger redundant Supabase round-trips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coopIdsKey])

  // Hidden when no co-presence — no skeleton, no empty state.
  if (!coopUsers.length) return null

  const gameTitle = coopUsers[0].gameTitle || 'this game'
  const gameImage = coopUsers[0].gameImage || null

  const ariaLabel = `Co-op signal: ${buildNamesLine(coopUsers, profiles)} — ${gameTitle}`

  return (
    <div
      className="coop-signal-card"
      role="region"
      aria-label={ariaLabel}
    >
      {/* ── Header: live pill ── */}
      <div className="coop-signal-card__header" aria-hidden="true">
        <PulseDot live size="sm" />
        <span className="coop-signal-card__header-label">Playing together now</span>
      </div>

      {/* ── Body: cover + game info + DM actions ── */}
      <div className="coop-signal-card__body">
        <div className="coop-signal-card__cover" aria-hidden="true">
          {gameImage ? (
            <img src={gameImage} alt="" loading="lazy" />
          ) : (
            <span className="coop-signal-card__cover-fallback">
              {gameTitle.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="coop-signal-card__info">
          <p className="coop-signal-card__game-title">{gameTitle}</p>
          <p className="coop-signal-card__names">
            {buildNamesLine(coopUsers, profiles)}
          </p>

          {/* One Message pill per co-present user (max 3 shown). */}
          <div className="coop-signal-card__actions">
            {coopUsers.slice(0, 3).map((u) => {
              const p = profiles[u.userId]
              const username = p?.username
              const displayLabel = p?.display_name || username || '\u2026'
              return (
                <button
                  key={u.userId}
                  type="button"
                  className="coop-signal-card__dm-btn"
                  onClick={() => username && navigate(`/messages/${username}`)}
                  disabled={!username}
                  aria-label={`Message ${displayLabel}`}
                >
                  Message {displayLabel}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
