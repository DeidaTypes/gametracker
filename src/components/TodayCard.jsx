import React, { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, ChevronRight } from 'lucide-react'
import { useTodayData } from '../hooks/useTodayData'
import { usePresence } from '../hooks/usePresence'
import SharedCover from './SharedCover'
import PulseDot from './PulseDot'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { useSession } from '../contexts/SessionContext'
import GoalRing from './GoalRing'
import SetGoalSheet from './SetGoalSheet'
import { useAuth } from '../contexts/AuthContext'
import { setGoal } from '../services/goalService'
import './TodayCard.css'

// ── Time-of-day copy ──────────────────────────────────────────────────────────

function getTimePhrase() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12)  return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

const TIME_COPY = {
  morning:   { headline: 'Good morning',   play: 'Resume',  nav: 'Resume'   },
  afternoon: { headline: 'Today',          play: 'Play',    nav: 'Continue' },
  evening:   { headline: 'One more?',      play: 'Play',    nav: 'Continue' },
  night:     { headline: 'Late night?',    play: 'Play',    nav: 'Continue' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSessionTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatRelativeTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  const diffHrs = diffMs / (1000 * 60 * 60)
  if (diffHrs < 1)    return 'just now'
  if (diffHrs < 24)   return `${Math.floor(diffHrs)}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7)   return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function coverSrc(url) {
  if (!url) return null
  return url.replace(/t_[a-z0-9_]+/, 't_cover_big')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StreakChip({ count }) {
  if (count === 0) return null
  return (
    <div className="tc-streak-chip" aria-label={`${count}-day streak`}>
      <Flame className="tc-streak-flame" size={14} aria-hidden="true" />
      <span className="tc-streak-count">{count}</span>
    </div>
  )
}

function NowPlayingRow({
  game,
  progress,
  navigate,
  isActiveSession,
  sessionElapsed,
  onStartSession,
  onStopSession,
  sessionStarting,
  isStopping,
  playCta,
  navCta,
  showPulse,
}) {
  if (!game) return null

  const src = coverSrc(game.image)
  const relTime = !isActiveSession ? formatRelativeTime(game.lastPlayedAt) : null

  function goToGame(e) {
    e.stopPropagation()
    navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
  }

  return (
    <div className="tc-now-playing">
      {/* Cover + live pulse overlay */}
      <div className="tc-cover-wrap">
        <button
          className="tc-cover-btn"
          onClick={goToGame}
          aria-label={`Open ${game.title}`}
          type="button"
        >
          <SharedCover gameId={game.id} imageSrc={src || game.image}>
            <img
              src={src || game.image || COVER_FALLBACK}
              alt={game.title}
              className="tc-cover"
              loading="lazy"
              onError={(e) => { e.target.src = COVER_FALLBACK }}
            />
          </SharedCover>
        </button>
        {showPulse && (
          <PulseDot
            live
            size="sm"
            label="Live"
            className="tc-pulse-badge"
          />
        )}
      </div>

      {/* Info */}
      <div className="tc-game-info">
        <span className="tc-playing-tag">Playing</span>
        <p className="tc-game-title">{game.title}</p>

        {/* Progress — real data only; never fabricated */}
        {progress?.showBar ? (
          <div className="tc-progress-block">
            <div
              className="tc-bar-track"
              role="progressbar"
              aria-valuenow={Math.round(progress.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress: ${Math.round(progress.percent)}%`}
            >
              <div
                className="tc-bar-fill"
                style={{ width: `${Math.min(progress.percent, 100)}%` }}
              />
            </div>
            <span className="tc-progress-label">{progress.label}</span>
          </div>
        ) : progress?.hoursPlayed > 0 ? (
          <span className="tc-progress-label">{progress.label}</span>
        ) : null}

        {/* Last left off — relative time of last play; hidden during active session */}
        {relTime && (progress?.hoursPlayed > 0 || progress?.showBar) && (
          <span className="tc-last-session" aria-label={`Last played ${relTime}`}>
            Last played {relTime}
          </span>
        )}

        {/* Session controls */}
        {isActiveSession ? (
          <div className="tc-session-row">
            <span className="tc-session-dot" aria-hidden="true" />
            <span
              className="tc-session-timer"
              aria-live="off"
              aria-label={`Session time: ${formatSessionTime(sessionElapsed)}`}
            >
              {formatSessionTime(sessionElapsed)}
            </span>
            <button
              className="tc-session-stop-btn"
              type="button"
              onClick={onStopSession}
              disabled={isStopping}
              aria-label="Stop play session"
            >
              {isStopping ? '…' : 'Stop'}
            </button>
          </div>
        ) : (
          <div className="tc-action-row">
            <button
              className="tc-start-btn"
              type="button"
              onClick={onStartSession}
              disabled={sessionStarting}
              aria-label={`${playCta} ${game.title}`}
            >
              {sessionStarting ? '…' : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {playCta}
                </>
              )}
            </button>
            <button
              className="tc-continue-btn"
              type="button"
              onClick={goToGame}
            >
              {navCta} <ChevronRight size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function WeekRow({ cells }) {
  return (
    <div className="tc-week-row" role="group" aria-label="Last 7 days of activity">
      {cells.map((cell) => (
        <div
          key={cell.key}
          className={[
            'tc-week-cell',
            cell.active ? 'tc-week-cell--active' : '',
            cell.isToday ? 'tc-week-cell--today' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={`${cell.key}${cell.active ? ' — active' : ''}${cell.isToday ? ' (today)' : ''}`}
          aria-current={cell.isToday ? 'date' : undefined}
        >
          <span className="tc-week-cell-label" aria-hidden="true">
            {cell.dayLabel}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TodayCard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { nowPlaying, progress, weekCells, streak, daysLogged, isLoading, goalProgress } =
    useTodayData()
  const [goalSheetOpen, setGoalSheetOpen] = useState(false)

  const {
    session: activeSession,
    elapsed: sessionElapsed,
    isStarting: sessionStarting,
    isStopping,
    startGameSession,
    stopGameSession,
  } = useSession()

  const { playingNow } = usePresence()

  // Time-of-day copy — recomputed per render so it shifts at midnight
  const timeCopy = TIME_COPY[getTimePhrase()]

  const isActiveSession =
    nowPlaying != null &&
    activeSession?.igdb_game_id != null &&
    String(activeSession.igdb_game_id) === String(nowPlaying.id)

  // Show PulseDot when the local user is in an active session on this game,
  // or when any followed user is playing this same game right now.
  const showPulse = useMemo(() => {
    if (!nowPlaying) return false
    if (isActiveSession) return true
    return playingNow.some((p) => String(p.gameId) === String(nowPlaying.id))
  }, [nowPlaying, isActiveSession, playingNow])

  const handleStartSession = useCallback(() => {
    if (!nowPlaying) return
    startGameSession(nowPlaying.id, {
      gameTitle: nowPlaying.title,
      gameImage: nowPlaying.image,
    })
  }, [startGameSession, nowPlaying])

  const handleStopSession = useCallback(() => {
    stopGameSession()
  }, [stopGameSession])

  const handleGoalSave = useCallback(async (target) => {
    if (!user?.id) return
    await setGoal(user.id, goalProgress.year, target)
    window.dispatchEvent(new Event('activityUpdated'))
  }, [user?.id, goalProgress.year])

  return (
    <>
    <div className="tc-card">
      {/* Header — headline shifts by time of day */}
      <div className="tc-header">
        <h2 className="tc-title">{timeCopy.headline}</h2>
        <div className="tc-header-right">
          <StreakChip count={streak.current} />
          {!isLoading && (
            <GoalRing
              current={goalProgress.current}
              target={goalProgress.target}
              year={goalProgress.year}
              variant="compact"
              onSet={() => setGoalSheetOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Now Playing — hidden when no game is Playing */}
      {nowPlaying && (
        <NowPlayingRow
          game={nowPlaying}
          progress={progress}
          navigate={navigate}
          isActiveSession={isActiveSession}
          sessionElapsed={sessionElapsed}
          onStartSession={handleStartSession}
          onStopSession={handleStopSession}
          sessionStarting={sessionStarting}
          isStopping={isStopping}
          playCta={timeCopy.play}
          navCta={timeCopy.nav}
          showPulse={showPulse}
        />
      )}

      {/* Divider between now-playing and week row */}
      {nowPlaying && <div className="tc-divider" aria-hidden="true" />}

      {/* 7-day activity week */}
      {!isLoading && <WeekRow cells={weekCells} />}

      {/* Caption + Calendar link */}
      {!isLoading && (
        <div className="tc-footer">
          <span className="tc-caption">
            You&rsquo;ve logged <strong>{daysLogged}</strong> of the last 7 days
          </span>
          <button
            className="tc-calendar-link"
            type="button"
            onClick={() => navigate('/activity')}
            aria-label="View full activity calendar"
          >
            Calendar <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>

    <SetGoalSheet
      isOpen={goalSheetOpen}
      onClose={() => setGoalSheetOpen(false)}
      onSave={handleGoalSave}
      year={goalProgress.year}
      current={goalProgress.target ?? 0}
    />
    </>
  )
}
