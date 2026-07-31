import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import Lottie from 'lottie-react'

import {
  subscribe as subscribeCelebration,
  getCurrentCelebration,
  dismissCurrent,
} from '../../services/celebrationService'
import { getOrExtractGameColor } from '../../services/gameColorService'
import { normalizeAccentColor } from '../../services/colorExtract'
import { getTracker } from '../../services/hoursService'
import {
  getPlaythroughStartedAt,
  formatPlaythroughSpan,
} from '../../services/finishStatsService'
import { useAuth } from '../../contexts/AuthContext'

import celebrationAnimation from '../../assets/lottie/celebration.json'

import './CompletionCelebration.css'

/* ============================================================
   useCurrentCelebration — subscribes to the celebrationService queue
   ============================================================ */
function useCurrentCelebration() {
  const [head, setHead] = useState(getCurrentCelebration())
  useEffect(() => {
    const unsub = subscribeCelebration(() => setHead(getCurrentCelebration()))
    return unsub
  }, [])
  return head
}

/**
 * Round hours for display: whole numbers show no decimal, everything
 * else keeps one ("96h played", "3.5h played").
 */
function formatHours(hours) {
  return hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)
}

/* ============================================================
   CompletionCelebration — single mount in App
   ============================================================ */
export default function CompletionCelebration() {
  const head = useCurrentCelebration()
  const reduced = useReducedMotion()
  const location = useLocation()
  const { user } = useAuth()

  // Pause while the review composer is open so a queued celebration
  // doesn't paint on top of the composer. See original comment above
  // for full rationale.
  const onReviewComposer = location.pathname.startsWith('/review/new')

  // The game's extracted accent — cached on game_colors after the first
  // finish of this game (by anyone); read straight from the cache on
  // every finish after that. Normalized for AA-safe contrast — see
  // colorExtract.normalizeAccentColor.
  const [accentRgb, setAccentRgb] = useState(null)

  // Real playthrough data only — see finishStatsService. Each field is
  // null until resolved, and stays null (chip omitted) when the
  // underlying data doesn't exist for this game/user.
  const [stats, setStats] = useState({ hoursPlayed: null, spanLabel: null })

  // Reset transient state on head change.
  useEffect(() => {
    if (head) {
      setAccentRgb(null)
      setStats({ hoursPlayed: null, spanLabel: null })
    }
  }, [head?.igdbGameId])

  // Lock body scroll while celebration is open.
  useEffect(() => {
    if (!head || onReviewComposer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [head, onReviewComposer])

  // Game-accent color — cache read/extract-and-persist, then clamp into
  // a UI-safe lightness/saturation band for text + button-fill contrast.
  useEffect(() => {
    if (!head?.igdbGameId) return
    let cancelled = false
    getOrExtractGameColor(head.igdbGameId, head.game?.image).then((raw) => {
      if (cancelled) return
      setAccentRgb(raw ? normalizeAccentColor(raw) : null)
    })
    return () => {
      cancelled = true
    }
  }, [head?.igdbGameId, head?.game?.image])

  // Stat chips — hours played (game_trackers) + started→finished span
  // (activities). "Your #Nth this year" arrives separately and later,
  // via celebrationService.updateCelebrationStats (see libraryService),
  // so it isn't fetched here — it's read directly off `head` below.
  useEffect(() => {
    if (!head?.igdbGameId) return
    let cancelled = false
    ;(async () => {
      const [tracker, startedAt] = await Promise.all([
        getTracker(head.igdbGameId),
        user?.id ? getPlaythroughStartedAt(user.id, head.igdbGameId) : Promise.resolve(null),
      ])
      if (cancelled) return
      const hoursPlayed =
        tracker?.hours_played != null && Number(tracker.hours_played) > 0
          ? Number(tracker.hours_played)
          : null
      const spanLabel = formatPlaythroughSpan(startedAt, head.completedAt)
      setStats({ hoursPlayed, spanLabel })
    })()
    return () => {
      cancelled = true
    }
  }, [head?.igdbGameId, head?.completedAt, user?.id])

  // ESC to dismiss.
  useEffect(() => {
    if (!head || onReviewComposer) return
    const onKey = (e) => {
      if (e.key === 'Escape') dismissCurrent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [head?.igdbGameId, onReviewComposer])

  const handleDone = () => {
    if (!head) return
    dismissCurrent()
  }

  if (!head || onReviewComposer) return null

  const coverInitial = reduced ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }
  const coverAnimate = { scale: 1, opacity: 1 }
  const coverTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 280, damping: 22 }

  const ordinalLabel =
    head.ordinal && head.ordinalYear ? `your #${head.ordinal} of ${head.ordinalYear}` : null

  const hasStats = stats.hoursPlayed != null || stats.spanLabel || ordinalLabel

  // Sole dynamic color for this whole screen: the game's extracted
  // accent, exposed as a CSS custom property so every element that
  // needs it (eyebrow, glow, backdrop, Done button) reads the same
  // source of truth. Falls back to --finish-fallback (defined in the
  // CSS, a neutral gold — never blue) when extraction hasn't resolved
  // yet or failed.
  const rootStyle = accentRgb
    ? { '--game-accent-rgb': `${accentRgb.r} ${accentRgb.g} ${accentRgb.b}` }
    : undefined

  return createPortal(
    <div
      className="completion-celebration"
      style={rootStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-celebration-title"
    >
      {/* Confetti / reduced-motion fallback */}
      {reduced ? (
        <div className="completion-celebration__static-mark" aria-hidden="true">
          <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
            <circle className="completion-celebration__static-mark-ring-fill" cx="48" cy="48" r="44" />
            <circle
              className="completion-celebration__static-mark-ring-stroke"
              cx="48"
              cy="48"
              r="44"
              fill="none"
              strokeWidth="2"
            />
            <path
              className="completion-celebration__static-mark-check"
              d="M30 49 L43 62 L66 36"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        <div
          key={`confetti-${head.igdbGameId}`}
          className="completion-celebration__confetti"
          aria-hidden="true"
        >
          <Lottie
            animationData={celebrationAnimation}
            loop={false}
            autoplay
            rendererSettings={{ preserveAspectRatio: 'xMidYMin slice' }}
          />
        </div>
      )}

      <div className="completion-celebration__content">
        {/* Badge */}
        <span className="completion-celebration__eyebrow">
          <span aria-hidden="true">&#10022;&nbsp;</span>Completed
        </span>

        {/* Cover — spring entrance, remounts per game so animation replays */}
        <motion.div
          key={`cover-${head.igdbGameId}`}
          className="completion-celebration__cover-wrap"
          initial={coverInitial}
          animate={coverAnimate}
          transition={coverTransition}
        >
          <div className="completion-celebration__cover-glow" aria-hidden="true" />
          {head.game?.image ? (
            <img
              src={head.game.image}
              alt=""
              className="completion-celebration__cover"
              crossOrigin="anonymous"
              draggable={false}
            />
          ) : (
            <div className="completion-celebration__cover completion-celebration__cover--fallback" />
          )}
        </motion.div>

        <h2
          id="completion-celebration-title"
          className="completion-celebration__title"
        >
          {head.game?.title || 'Game complete'}
        </h2>
        <p className="completion-celebration__subtitle">
          You finished it. That&rsquo;s a real one.
        </p>

        {/* Stat chips — real playthrough data only; any chip whose value
            is unavailable is simply omitted, never fabricated. */}
        {hasStats && (
          <div className="completion-celebration__stats" role="list">
            {stats.hoursPlayed != null && (
              <span className="completion-celebration__stat" role="listitem">
                <span className="completion-celebration__stat-icon" aria-hidden="true">&#9201;</span>
                {formatHours(stats.hoursPlayed)}h played
              </span>
            )}
            {stats.spanLabel && (
              <span className="completion-celebration__stat" role="listitem">
                <span className="completion-celebration__stat-icon" aria-hidden="true">&#128197;</span>
                {stats.spanLabel}
              </span>
            )}
            {ordinalLabel && (
              <span className="completion-celebration__stat" role="listitem">
                <span className="completion-celebration__stat-icon" aria-hidden="true">&#127942;</span>
                {ordinalLabel}
              </span>
            )}
          </div>
        )}

        <div className="completion-celebration__ctas">
          <button
            type="button"
            onClick={handleDone}
            className="completion-celebration__cta-done"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
