import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Clock, Pencil, Plus, Trash2 } from 'lucide-react'
import { getGameById } from '../services/igdb'
import {
  getManualSessionsForGame,
  updateManualSession,
  deleteManualSession,
  logSession,
} from '../services/sessionService'
import { getTotalHoursForGame } from '../services/hoursService'
import { getMoodMeta } from '../services/journalService'
import { hapticImpact } from '../utils/haptics'
import { showToast } from '../components/Toast'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import LogSessionModal from '../components/LogSessionModal'
import LogSheet from '../components/home/LogSheet'
import CenteredModal from '../components/CenteredModal'
import EmptyState from '../components/EmptyState'
import { DestructiveButton, SecondaryButton } from '../components/forms'
import {
  formatSessionHours,
  formatHeroHours,
  formatSessionClockTime,
  groupSessionsByDay,
  buildSevenDaySparkline,
  getSessionStats,
} from '../utils/sessionDisplay'
import './GameSessions.css'

function SessionSparkline({ days }) {
  return (
    <div className="gs-sparkline" aria-hidden="true">
      <div className="gs-sparkline-bars">
        {days.map((day) => {
          const hasHours = day.hours > 0
          const heightPct = hasHours
            ? Math.max(12, Math.round(day.fraction * 100))
            : 8
          return (
            <div key={day.key} className="gs-sparkline-bar-wrap">
              <div
                className={`gs-sparkline-bar${hasHours ? '' : ' gs-sparkline-bar--zero'}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="gs-sparkline-labels">
        <span>7 days ago</span>
        <span>today</span>
      </div>
    </div>
  )
}

export default function GameSessions() {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logSessionOpen, setLogSessionOpen] = useState(false)
  const [logSaving, setLogSaving] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const refreshSessions = useCallback(async () => {
    const data = await getManualSessionsForGame(gameId).catch(() => [])
    setSessions(data)
  }, [gameId])

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      getGameById(gameId).catch(() => null),
      getManualSessionsForGame(gameId).catch(() => []),
    ]).then(([gameData, sessionData]) => {
      if (cancelled) return
      setGame(gameData)
      setSessions(sessionData)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [gameId])

  useEffect(() => {
    if (!gameId) return undefined
    const onResume = () => { refreshSessions() }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [gameId, refreshSessions])

  const handleSaveSession = useCallback(async ({ totalMinutes, playedOn }) => {
    if (!editingSession) return
    setLogSaving(true)
    try {
      const result = await updateManualSession(editingSession.id, gameId, {
        minutes: totalMinutes,
        playedOn,
      })
      if (result) {
        hapticImpact('Medium')
        await refreshSessions()
        setLogSessionOpen(false)
        setEditingSession(null)
      } else {
        console.error('[GameSessions] failed to update session')
      }
    } finally {
      setLogSaving(false)
    }
  }, [gameId, editingSession, refreshSessions])

  const openLogSessionForEdit = useCallback((session) => {
    setEditingSession(session)
    setLogSessionOpen(true)
  }, [])

  const handleDeleteSession = useCallback(async (sessionId, mins) => {
    const result = await deleteManualSession(sessionId, gameId, mins)
    if (result) {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } else {
      console.error('[GameSessions] failed to delete session')
    }
  }, [gameId])

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await handleDeleteSession(pendingDelete.id, pendingDelete.minutes)
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  const handleLogSheetSubmit = useCallback(({ game: targetGame, hours, notes, mood }) => {
    logSession({
      gameId: targetGame.id,
      hours,
      notes,
      mood,
      gameTitle: targetGame.title,
      gameImage: targetGame.image,
    }).then((result) => {
      if (result) {
        hapticImpact('Medium')
        refreshSessions()
        showToast(`Logged ${hours}h of ${targetGame.title}`, 'success')
      } else {
        showToast('Could not log session — try again', 'error', 5000, {
          label: 'Retry',
          onClick: () => handleLogSheetSubmit({ game: targetGame, hours, notes, mood }),
        })
      }
    })
  }, [refreshSessions])

  const isEmpty = !loading && sessions.length === 0
  const totalHours = getTotalHoursForGame(sessions)
  const dayGroups = useMemo(() => groupSessionsByDay(sessions), [sessions])
  const sparklineDays = useMemo(() => buildSevenDaySparkline(sessions), [sessions])
  const stats = useMemo(() => getSessionStats(sessions), [sessions])

  const gameTitle = game?.title || 'Game'
  const logGame = game
    ? { id: game.id, title: game.title, image: game.image }
    : { id: gameId, title: gameTitle, image: null }

  return (
    <div className="gs-page margins-style">
      <header className="gs-nav">
        <button
          type="button"
          className="gs-back-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="gs-nav-text">
          <h1 className="gs-nav-title">Sessions</h1>
          <p className="gs-nav-subtitle">{gameTitle}</p>
        </div>
      </header>

      <div className="gs-scroll">
        <section className="gs-hero-card" aria-label="Playtime summary">
          <div className="gs-hero-total">
            <span
              className={`gs-hero-hours${isEmpty ? ' gs-hero-hours--muted' : ' gs-hero-hours--gradient'}`}
            >
              {formatHeroHours(totalHours)}
            </span>
            <span className="gs-hero-unit">hours</span>
          </div>

          {!isEmpty && (
            <>
              <p className="gs-hero-meta">
                {stats.count} {stats.count === 1 ? 'session' : 'sessions'}
                {' · '}
                longest {formatSessionHours(stats.longest)}
                {stats.lastPlayed ? ` · last played ${stats.lastPlayed}` : ''}
              </p>
              <SessionSparkline days={sparklineDays} />
            </>
          )}
        </section>

        <button
          type="button"
          className="gs-log-btn"
          onClick={() => setLogSheetOpen(true)}
        >
          <Plus size={18} aria-hidden="true" />
          <span>{isEmpty ? 'Log your first session' : 'Log a session'}</span>
        </button>

        {isEmpty && (
          <EmptyState
            icon={Clock}
            title="Track your time"
            body="Logging sessions updates your hours, streak, and the 2026 Challenge together."
            size="compact"
          />
        )}

        {!isEmpty && (
          <div className="gs-day-list">
            {dayGroups.map((group) => (
              <section key={group.playedOn} className="gs-day-group">
                <div className="gs-day-header">
                  <span className="gs-day-label">{group.label}</span>
                  <span className="gs-day-total">{formatSessionHours(group.totalHours)}</span>
                </div>
                <ul className="gs-session-list" role="list">
                  {group.sessions.map((session) => {
                    const moodMeta = session.mood ? getMoodMeta(session.mood) : null
                    const hasNote = !!(session.note && session.note.trim())
                    return (
                      <li key={session.id} className="gs-session-row">
                        <div className="gs-session-spine" aria-hidden="true" />
                        <div className="gs-session-body">
                          <span className="gs-session-hours">{formatSessionHours(session.hours)}</span>
                          <span className="gs-session-time">{formatSessionClockTime(session)}</span>
                          {hasNote && (
                            <p className="gs-session-note">
                              {moodMeta?.emoji && (
                                <span className="gs-session-mood" aria-hidden="true">{moodMeta.emoji}</span>
                              )}
                              {session.note.trim()}
                            </p>
                          )}
                        </div>
                        <div className="gs-session-actions">
                          <button
                            type="button"
                            className="gs-session-action-btn"
                            onClick={() => openLogSessionForEdit(session)}
                            aria-label={`Edit session from ${session.playedOn}`}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="gs-session-action-btn gs-session-action-btn--danger"
                            onClick={() => setPendingDelete(session)}
                            aria-label={`Delete session from ${session.playedOn}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <LogSheet
        isOpen={logSheetOpen}
        onClose={() => setLogSheetOpen(false)}
        game={logGame}
        onLogIt={handleLogSheetSubmit}
      />

      <LogSessionModal
        isOpen={logSessionOpen}
        onClose={() => { setLogSessionOpen(false); setEditingSession(null) }}
        onSave={handleSaveSession}
        isSaving={logSaving}
        editingSession={editingSession}
      />

      <CenteredModal
        isOpen={!!pendingDelete}
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        ariaLabel="Delete session"
        maxWidth={340}
      >
        <div className="gs-confirm">
          <h3 className="gs-confirm-title">Delete this session?</h3>
          <p className="gs-confirm-body">
            {pendingDelete
              ? `Removing this ${formatSessionHours(pendingDelete.hours)} session will subtract it from your total playtime. This can\u2019t be undone.`
              : ''}
          </p>
          <div className="gs-confirm-footer">
            <DestructiveButton onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete session'}
            </DestructiveButton>
            <SecondaryButton onClick={() => setPendingDelete(null)} disabled={deleting} autoFocus>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      </CenteredModal>
    </div>
  )
}
