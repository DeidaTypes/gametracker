import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import Lottie from 'lottie-react'
import { toPng } from 'html-to-image'

import {
  subscribe as subscribeCelebration,
  getCurrentCelebration,
  dismissCurrent,
  storeShareableCard,
} from '../../services/celebrationService'
import { getGameProgress } from '../../services/libraryService'
import { getDominantColor } from '../../services/colorExtract'
import { getCachedUserReviews } from '../../services/reviewService'
import { getGamesFromList } from '../../services/libraryService'
import { useAuth } from '../../contexts/AuthContext'
import ShareCard from './ShareCard'

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

/* ============================================================
   Stat helpers
   ============================================================ */
function diffDays(fromIso, toIso) {
  if (!fromIso) return null
  const from = new Date(fromIso).getTime()
  const to = toIso ? new Date(toIso).getTime() : Date.now()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const ms = Math.max(0, to - from)
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)))
}

function formatHours(h) {
  if (h == null || Number.isNaN(Number(h))) return '0'
  const num = Number(h)
  if (num >= 100) return Math.round(num).toString()
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)
}

/**
 * Reviews the user has written for games currently on Played status.
 * Spec calls this "you're a critic now" milestone — count is the value
 * shown; multiples of 5 / 10 / 25 get a small flex (rendered by parent).
 */
function countPlayedReviews() {
  try {
    const playedGames = getGamesFromList('played') || []
    const playedIds = new Set(playedGames.map((g) => String(g.id)))
    const reviews = getCachedUserReviews()
    let n = 0
    for (const r of reviews) {
      if (r?.igdb_game_id != null && playedIds.has(String(r.igdb_game_id))) n++
    }
    return n
  } catch {
    return 0
  }
}

const MILESTONE_THRESHOLDS = new Set([5, 10, 25, 50, 100, 250])

/* ============================================================
   CompletionCelebration — single mount in App
   ============================================================ */
export default function CompletionCelebration() {
  const head = useCurrentCelebration()
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()

  // Pause the celebration overlay while the review composer is open.
  //
  // The celebration is a single document-body portal that renders whenever
  // the queue head is non-null, regardless of route. "Write a review"
  // dismisses the current head (advancing the queue) and navigates to
  // /review/new — but without this guard the *next* queued celebration
  // would immediately paint on top of the composer, so the user could only
  // ever reach the composer for the LAST queued game (every earlier click
  // just looked like it "skipped" to the next prompt). Onboarding seeds
  // three "Played" games at once, which is exactly how that queue piles up.
  //
  // Suppressing the overlay on the composer route lets each game be
  // reviewed in turn: post → navigate(-1) returns to the launching screen,
  // the next celebration appears there, and once the queue drains the user
  // lands cleanly on Home instead of bouncing through stale history entries.
  const onReviewComposer = location.pathname.startsWith('/review/new')

  // Local UI state, reset whenever a new head item arrives.
  const [accentRgb, setAccentRgb] = useState(null)
  const [shareCardPreview, setShareCardPreview] = useState(null)
  const shareCardRef = useRef(null)

  // Reset transient state on head change.
  useEffect(() => {
    if (head) {
      setAccentRgb(null)
      setShareCardPreview(null)
    }
  }, [head?.igdbGameId])

  // Lock body scroll while celebration is open (but not while it's paused
  // behind the review composer — that route owns its own scroll lock).
  useEffect(() => {
    if (!head || onReviewComposer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [head, onReviewComposer])

  // Dominant-color extraction (same path used by GameDetail's hero).
  useEffect(() => {
    if (!head?.game?.image) return
    let cancelled = false
    getDominantColor(head.game.image).then((c) => {
      if (!cancelled && c) setAccentRgb(c)
    })
    return () => {
      cancelled = true
    }
  }, [head?.game?.image])

  // ESC to dismiss.
  useEffect(() => {
    if (!head || onReviewComposer) return
    const onKey = (e) => {
      if (e.key === 'Escape') handleDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head?.igdbGameId, reduced, onReviewComposer])

  // Stats — derived synchronously per head.
  const stats = useMemo(() => {
    if (!head) {
      return { hours: 0, days: null, reviews: 0, milestone: false }
    }
    const progress = getGameProgress(head.igdbGameId)
    const startedIso = head.game?.addedAt || progress.lastPlayedAt || null
    const days = diffDays(startedIso, head.completedAt)
    const reviewsForPlayed = countPlayedReviews()
    return {
      hours: progress.hoursPlayed ?? 0,
      days,
      reviews: reviewsForPlayed,
      milestone: MILESTONE_THRESHOLDS.has(reviewsForPlayed),
    }
  }, [head])

  const displayName =
    profile?.display_name ||
    profile?.displayName ||
    user?.email?.split('@')?.[0] ||
    'You'

  /* ------------------------------------------------------------------
     Share-card generation (Sprint 4: preview only).
     Skipped under reduced-motion per spec — "it's not a visual experience,
     it's a media artifact" and we don't want to spend the CPU.
     ------------------------------------------------------------------ */
  const generateShareCard = useCallback(async () => {
    if (reduced || !shareCardRef.current || !head) return null
    try {
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 1,
        // Background must match the card's own gradient — html-to-image
        // honours backgroundColor when the source element is transparent.
        // Our ShareCard has its own background, so this is a fallback.
        backgroundColor: 'var(--color-bg-primary)',
      })
      storeShareableCard(head.igdbGameId, dataUrl)
      // Sprint 4 verification preview. Wrapped in a query-string guard so
      // the preview is opt-in for testing without shipping it on by
      // default. Set ?previewShareCard=1 in the URL to see the captured
      // PNG inline before pressing Done.
      try {
        if (typeof window !== 'undefined' && window.location?.search?.includes('previewShareCard=1')) {
          setShareCardPreview(dataUrl)
        }
      } catch {
        // Non-fatal: preview is a debug affordance.
      }
      return dataUrl
    } catch (err) {
      console.warn('[celebration] share-card capture failed:', err)
      return null
    }
  }, [reduced, head])

  /* ------------------------------------------------------------------
     Done — closes the celebration, generates the share card in the
     background. Reduced-motion users skip the capture entirely.
     ------------------------------------------------------------------ */
  const handleDone = useCallback(async () => {
    if (!head) return
    if (!reduced) {
      // Fire-and-forget so the celebration dismisses immediately and the
      // user doesn't sit on a frozen overlay while we rasterise 1080×1920.
      generateShareCard()
    }
    dismissCurrent()
  }, [head, reduced, generateShareCard])

  /* ------------------------------------------------------------------
     Write a review — routes to the single, keyboard-aware review composer
     (ReviewNew at /review/new) with the celebrated game pre-loaded. We
     capture the share card, dismiss the celebration, then navigate, so the
     review experience is identical everywhere in the app.
     ------------------------------------------------------------------ */
  const handleOpenReview = useCallback(() => {
    if (!head) return
    if (!reduced) generateShareCard()
    const gameId = head.igdbGameId
    dismissCurrent()
    navigate(`/review/new?gameId=${gameId}`, { state: { game: head.game } })
  }, [head, reduced, generateShareCard, navigate])

  if (!head || onReviewComposer) return null

  const accentCss = accentRgb
    ? `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`
    : 'var(--color-brand-primary)'

  // Vertical gradient: extracted color at the top, navy at the bottom.
  const backdropGradient = accentRgb
    ? `linear-gradient(180deg,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.65) 0%,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.22) 32%,
        rgba(10, 15, 31, 0.96) 70%,
        #0a0f1f 100%)`
    : `linear-gradient(180deg,
        rgba(59, 130, 246, 0.55) 0%,
        rgba(59, 130, 246, 0.18) 32%,
        rgba(10, 15, 31, 0.96) 70%,
        #0a0f1f 100%)`

  // Cover entrance: spring 280/22 over ~480ms. Reduced motion → instant.
  const coverInitial = reduced ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }
  const coverAnimate = { scale: 1, opacity: 1 }
  const coverTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 280, damping: 22 }

  return createPortal(
    <div
      className="completion-celebration"
      style={{ background: backdropGradient }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-celebration-title"
    >
      {/* Confetti — Lottie. Reduced motion gets a static checkmark in
          amber instead. Anchored top-center, particles fall toward the
          cover. Pointer-events disabled so taps land on the CTAs. */}
      {reduced ? (
        <div className="completion-celebration__static-mark" aria-hidden="true">
          <svg
            viewBox="0 0 96 96"
            width="96"
            height="96"
            aria-hidden="true"
          >
            <circle cx="48" cy="48" r="44" fill="rgba(200,150,90,0.14)" />
            <circle
              cx="48"
              cy="48"
              r="44"
              fill="none"
              stroke="rgba(200,150,90,0.45)"
              strokeWidth="2"
            />
            <path
              d="M30 49 L43 62 L66 36"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        // `key` remounts the Lottie player when the queue advances so the
        // confetti replays for every celebration, not just the first.
        <div
          key={`confetti-${head.igdbGameId}`}
          className="completion-celebration__confetti"
          aria-hidden="true"
        >
          <Lottie
            animationData={celebrationAnimation}
            loop={false}
            autoplay
            rendererSettings={{
              preserveAspectRatio: 'xMidYMin slice',
            }}
          />
        </div>
      )}

      <div className="completion-celebration__content">
        <span className="completion-celebration__eyebrow">Completed</span>

        {/* `key` forces remount when the queue shifts to the next game so
            the spring entrance fires for each celebration in turn — without
            it, the motion.div sees the same props and skips `initial`. */}
        <motion.div
          key={`cover-${head.igdbGameId}`}
          className="completion-celebration__cover-wrap"
          initial={coverInitial}
          animate={coverAnimate}
          transition={coverTransition}
        >
          <div
            className="completion-celebration__cover-glow"
            style={{ background: accentCss }}
            aria-hidden="true"
          />
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
          You finished it. That's a real one.
        </p>

        <div className="completion-celebration__stats">
          <div className="completion-celebration__stat">
            <span className="completion-celebration__stat-num">
              {formatHours(stats.hours)}
            </span>
            <span className="completion-celebration__stat-label">Hours</span>
          </div>
          <div className="completion-celebration__stat-divider" aria-hidden="true" />
          <div className="completion-celebration__stat">
            <span className="completion-celebration__stat-num">
              {stats.days ?? '—'}
            </span>
            <span className="completion-celebration__stat-label">
              {stats.days === 1 ? 'Day' : 'Days'}
            </span>
          </div>
          <div className="completion-celebration__stat-divider" aria-hidden="true" />
          <div className="completion-celebration__stat">
            <span className="completion-celebration__stat-num">
              {stats.reviews}
            </span>
            <span className="completion-celebration__stat-label">
              {stats.milestone
                ? "Reviews · You're a critic"
                : stats.reviews === 1
                  ? 'Review'
                  : 'Reviews'}
            </span>
          </div>
        </div>

        <div className="completion-celebration__ctas">
          <button
            type="button"
            onClick={handleOpenReview}
            className="form-button form-button--primary completion-celebration__cta-primary"
          >
            Write a review
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="form-button form-button--secondary completion-celebration__cta-secondary"
          >
            Done
          </button>
        </div>
      </div>

      {/* Offscreen share-card render target. html-to-image walks this DOM
          subtree to produce the 1080×1920 PNG. It is *not* the visible
          celebration card — that's the .completion-celebration__content
          tree above. */}
      <div className="completion-celebration__share-host" aria-hidden="true">
        <ShareCard
          ref={shareCardRef}
          game={head.game}
          displayName={displayName}
          hoursPlayed={stats.hours}
          daysPlaying={stats.days}
          reviewCount={stats.reviews}
          accentRgb={accentRgb}
        />
      </div>

      {/* Sprint 4 manual verification preview. Hidden behind a query-string
          gate (`?previewShareCard=1`) so it doesn't ship by default. */}
      {shareCardPreview && (
        <div className="completion-celebration__preview" aria-hidden="true">
          <img src={shareCardPreview} alt="" />
        </div>
      )}

    </div>,
    document.body
  )
}
