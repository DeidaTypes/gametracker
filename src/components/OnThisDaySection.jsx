import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOnThisDayEntries, getMoodMeta } from '../services/journalService'
import { getSWR, peekSWR } from '../services/swrCache'
import './OnThisDaySection.css'

// This section lives inside Profile's Diary tab, which — correctly, see
// Profile.jsx's tab AnimatePresence — unmounts and remounts each time the
// user navigates away from and back to the Diary tab. Routing the query
// through the shared swrCache means a Diary -> Home -> Diary round trip
// serves the cached rows instantly instead of re-hitting Supabase. "On
// this day" content only changes across real calendar days or when the
// user adds a new entry (handled below via an explicit forced refresh),
// so a generous TTL is safe.
const ON_THIS_DAY_TTL_MS = 5 * 60 * 1000

/**
 * OnThisDaySection — "On this day" resurface banner for the Diary tab.
 *
 * Queries journal entries written on the same calendar day in prior years.
 * Hides completely when there are no matches (returns null).
 *
 * Props:
 *   userId  string — whose history to resurface
 */
function OnThisDaySection({ userId }) {
  const navigate = useNavigate()
  const cacheKey = userId ? `on-this-day:${userId}` : null
  // Seed synchronously from cache when available so a Diary tab remount
  // (leaving and returning) paints the real list on frame one instead of
  // flashing the loading (null) state again.
  const [entries, setEntries] = useState(() => (cacheKey ? peekSWR(cacheKey) || [] : []))
  const [loading, setLoading] = useState(() => !cacheKey || peekSWR(cacheKey) === undefined)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const key = `on-this-day:${userId}`
    let cancelled = false
    if (peekSWR(key) === undefined) setLoading(true)
    getSWR(key, () => getOnThisDayEntries(userId), { ttlMs: ON_THIS_DAY_TTL_MS })
      .then((rows) => { if (!cancelled) { setEntries(rows); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  // Refresh when a new entry is added (user just wrote and saved one).
  // Forces past the cache (this is a real change the TTL doesn't know
  // about yet) and re-seeds it so the next tab remount sees the new entry
  // too, instead of serving the now-stale cached rows for the rest of the
  // TTL window.
  useEffect(() => {
    const refresh = () => {
      if (!userId) return
      getSWR(`on-this-day:${userId}`, () => getOnThisDayEntries(userId), {
        ttlMs: ON_THIS_DAY_TTL_MS,
        force: true,
      })
        .then(setEntries)
        .catch(() => {})
    }
    window.addEventListener('journalEntryAdded', refresh)
    return () => window.removeEventListener('journalEntryAdded', refresh)
  }, [userId])

  if (loading || entries.length === 0) return null

  const today = new Date()
  const dateLabel = today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

  return (
    <section className="otd-section" aria-label="On this day">
      <div className="otd-header">
        <span className="otd-header__icon" aria-hidden="true">📅</span>
        <div>
          <h3 className="otd-header__title">On This Day</h3>
          <p className="otd-header__sub">{dateLabel} in a previous year</p>
        </div>
      </div>

      <ul className="otd-list" aria-label="On this day entries">
        {entries.map((entry) => {
          const yearAgo = today.getFullYear() - new Date(entry.created_at).getFullYear()
          const moodMeta = entry.mood ? getMoodMeta(entry.mood) : null
          const hoursLabel = entry.hours_played != null
            ? `${entry.hours_played} hr${entry.hours_played !== 1 ? 's' : ''}`
            : null

          return (
            <li key={entry.id} className="otd-card">
              <button
                type="button"
                className="otd-card__btn"
                onClick={() => navigate(`/journal/${entry.id}`)}
                aria-label={`${yearAgo} year${yearAgo !== 1 ? 's' : ''} ago — ${entry.game_title || 'journal entry'}`}
              >
                {/* Cover art */}
                <div className="otd-card__cover-wrap">
                  {entry.game_image ? (
                    <img
                      src={entry.game_image}
                      alt={entry.game_title || ''}
                      className="otd-card__cover"
                    />
                  ) : (
                    <div className="otd-card__cover otd-card__cover--placeholder" aria-hidden="true" />
                  )}
                  <span className="otd-card__years-ago">{yearAgo}y ago</span>
                </div>

                {/* Text */}
                <div className="otd-card__meta">
                  <p className="otd-card__game">{entry.game_title || 'Unknown game'}</p>
                  {entry.title && (
                    <p className="otd-card__title">{entry.title}</p>
                  )}
                  <div className="otd-card__pills">
                    {moodMeta && (
                      <span className="otd-card__mood-pill">
                        {moodMeta.emoji} {moodMeta.label}
                      </span>
                    )}
                    {hoursLabel && (
                      <span className="otd-card__hours-pill">{hoursLabel}</span>
                    )}
                  </div>
                  {!entry.is_spoiler && entry.body ? (
                    <p className="otd-card__snippet">
                      {entry.body.slice(0, 80)}{entry.body.length > 80 ? '…' : ''}
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default OnThisDaySection
