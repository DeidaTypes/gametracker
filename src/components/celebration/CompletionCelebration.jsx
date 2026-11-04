import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'

import {
  subscribe as subscribeCelebration,
  getCurrentCelebration,
  dismissCurrent,
} from '../../services/celebrationService'
import { maybeOpenRateItSheet } from '../../services/ratePrompt'
import { getOrExtractGameColor, peekGameColor } from '../../services/gameColorService'
import { useComposerOpen } from '../composer/ComposerHost'
import { normalizeAccentColor, peekDominantColor } from '../../services/colorExtract'
import { getTracker } from '../../services/hoursService'
import {
  getPlaythroughStartedAt,
  formatPlaythroughSpan,
} from '../../services/finishStatsService'
import { useAuth } from '../../contexts/AuthContext'

import './CompletionCelebration.css'

// Hold an unknown finish color this long, then open on the gold fallback.
const FINISH_COLOR_WAIT_MS = 600

// accent: undefined = still resolving, null = no color, { r, g, b } = locked.
const EMPTY_ACCENT = { id: null, accent: undefined }

function accentFromPeek(igdbGameId, imageUrl) {
  const raw = peekGameColor(igdbGameId) ?? peekDominantColor(imageUrl)
  if (raw === undefined) return undefined
  return raw ? normalizeAccentColor(raw) : null
}

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

function ConfettiBurst({ Lottie, animationData }) {
  return (
    <div className="completion-celebration__confetti" aria-hidden="true">
      <Lottie
        animationData={animationData}
        loop={false}
        autoplay
        rendererSettings={{ preserveAspectRatio: 'xMidYMin slice' }}
      />
    </div>
  )
}

/* ============================================================
   CompletionCelebration — single mount in App
   ============================================================ */
export default function CompletionCelebration() {
  const head = useCurrentCelebration()
  const reduced = useReducedMotion()
  const location = useLocation()
  const { user } = useAuth()
  const [confetti, setConfetti] = useState(null)
  // Locked color for the head currently on screen. A later resolve must
  // not repaint it — the cache still updates for the next finish.
  const [shown, setShown] = useState(EMPTY_ACCENT)

  // Real playthrough data only — see finishStatsService. Each field is
  // null until resolved, and stays null (chip omitted) when the
  // underlying data doesn't exist for this game/user.
  const [stats, setStats] = useState({ hoursPlayed: null, spanLabel: null })

  // Pause while the review composer is open so a queued celebration
  // doesn't paint on top of the composer. See original comment above
  // for full rationale. The box is no longer a route (ComposerHost opens it
  // over the page); /review/new is the old-link fallback.
  const composerOpen = useComposerOpen()
  const onReviewComposer = composerOpen || location.pathname.startsWith('/review/new')

  const headId = head?.igdbGameId ?? null
  const imageUrl = head?.game?.image
  const peeked = headId != null ? accentFromPeek(headId, imageUrl) : undefined

  // Known color: lock it before paint so the first frame is final.
  // Dismiss: drop the lock so a later finish of this game can use the cache.
  if (headId == null) {
    if (shown !== EMPTY_ACCENT) setShown(EMPTY_ACCENT)
  } else if (peeked !== undefined && shown.id !== headId) {
    setShown({ id: headId, accent: peeked })
  }

  const accentRgb = headId == null
    ? undefined
    : shown.id === headId
      ? shown.accent
      : peeked

  const showing = headId != null && !onReviewComposer && accentRgb !== undefined

  // lottie-web is large. Load it only when a celebration is actually
  // on screen and motion is allowed.
  useEffect(() => {
    if (!showing || reduced || confetti) return undefined
    let cancelled = false
    Promise.all([
      import('lottie-react'),
      import('../../assets/lottie/celebration.json'),
    ])
      .then(([lottieMod, animMod]) => {
        if (cancelled) return
        setConfetti({
          Lottie: lottieMod.default,
          animationData: animMod.default,
        })
      })
      .catch((err) => {
        console.error('[celebration] animation failed to load', err)
      })
    return () => {
      cancelled = true
    }
  }, [showing, reduced, confetti])

  // Reset transient state on head change.
  useEffect(() => {
    if (head) setStats({ hoursPlayed: null, spanLabel: null })
  }, [head?.igdbGameId])

  // Lock body scroll while celebration is open.
  useEffect(() => {
    if (!showing) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [showing])

  // Resolve a color we don't already have. Whichever lands first — the
  // extract, or the wait above — is the color this screen keeps.
  useEffect(() => {
    if (headId == null) return undefined

    const known = accentFromPeek(headId, imageUrl)
    let settled = known !== undefined
    let cancelled = false

    if (known !== undefined) {
      setShown((prev) => (prev.id === headId ? prev : { id: headId, accent: known }))
    }

    const commit = (accent) => {
      if (cancelled || settled) return
      settled = true
      setShown((prev) => (prev.id === headId ? prev : { id: headId, accent }))
    }

    const timer = settled
      ? null
      : setTimeout(() => commit(null), FINISH_COLOR_WAIT_MS)

    getOrExtractGameColor(headId, imageUrl).then(
      (raw) => {
        if (timer) clearTimeout(timer)
        commit(raw ? normalizeAccentColor(raw) : null)
      },
      () => {
        if (timer) clearTimeout(timer)
        commit(null)
      },
    )

    return () => {
      cancelled = true
      settled = true
      if (timer) clearTimeout(timer)
    }
  }, [headId, imageUrl])

  // Stat chips — hours played (game_trackers) + started→finished span
  // (activities). "Your #Nth this year" arrives separately and later,
  // via celebrationService.updateCelebrationStats (see libraryService),
  // so it isn't fetched here — it's read directly off `head` below.
  useEffect(() => {
    if (!showing || !head?.igdbGameId) return undefined
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
  }, [showing, head?.igdbGameId, head?.completedAt, user?.id])

  const handleDone = () => {
    if (!head) return
    const game = head.game
      ? { ...head.game, id: head.game.id || head.igdbGameId }
      : { id: head.igdbGameId }
    dismissCurrent()
    maybeOpenRateItSheet(game)
  }

  // ESC to dismiss — same path as Done so Rate it? still opens when unrated.
  useEffect(() => {
    if (!showing) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') handleDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showing, head?.igdbGameId])

  if (!showing) return null

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
  // source of truth. null leaves --finish-fallback (a neutral gold,
  // defined in the CSS) in place for the whole time this screen is up.
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
      ) : confetti ? (
        <ConfettiBurst
          key={`confetti-${head.igdbGameId}`}
          Lottie={confetti.Lottie}
          animationData={confetti.animationData}
        />
      ) : (
        <div className="completion-celebration__confetti" aria-hidden="true" />
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
