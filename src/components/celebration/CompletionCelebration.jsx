import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import Lottie from 'lottie-react'
import { toPng } from 'html-to-image'
import { Share } from '@capacitor/share'

import {
  subscribe as subscribeCelebration,
  getCurrentCelebration,
  dismissCurrent,
  storeShareableCard,
} from '../../services/celebrationService'
import { getDominantColor } from '../../services/colorExtract'
import { getCachedUserReviews } from '../../services/reviewService'
import { useAuth } from '../../contexts/AuthContext'
import StarRating from '../StarRating'
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

const SNIPPET_MAX = 140

/* ============================================================
   CompletionCelebration — single mount in App
   ============================================================ */
export default function CompletionCelebration() {
  const head = useCurrentCelebration()
  const reduced = useReducedMotion()
  const location = useLocation()
  const { user, profile } = useAuth()

  // Pause while the review composer is open so a queued celebration
  // doesn't paint on top of the composer. See original comment above
  // for full rationale.
  const onReviewComposer = location.pathname.startsWith('/review/new')

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

  // Lock body scroll while celebration is open.
  useEffect(() => {
    if (!head || onReviewComposer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [head, onReviewComposer])

  // Dominant-color extraction.
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
      if (e.key === 'Escape') dismissCurrent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [head?.igdbGameId, onReviewComposer])

  // Look up the user's own review for this game from the in-memory cache.
  // postReview() prepends to _cachedUserReviews synchronously before
  // dispatching reviewAdded, so by the time this celebration renders after
  // a ReviewNew submit the review is already present in the cache.
  const userReview = useMemo(() => {
    if (!head) return null
    const reviews = getCachedUserReviews()
    return (
      reviews.find((r) => String(r.igdb_game_id) === String(head.igdbGameId)) ||
      null
    )
  }, [head?.igdbGameId])

  const reviewRating = userReview?.rating ? Number(userReview.rating) : 0
  const reviewBody = userReview?.body?.trim() || ''
  const reviewHours = userReview?.hours_played ? Number(userReview.hours_played) : 0

  const snippet =
    reviewBody.length > SNIPPET_MAX
      ? reviewBody.slice(0, SNIPPET_MAX).trimEnd() + '\u2026'
      : reviewBody

  const displayName =
    profile?.display_name ||
    profile?.displayName ||
    user?.email?.split('@')?.[0] ||
    'You'

  /* ------------------------------------------------------------------
     Share-card generation — rasterise the offscreen ShareCard for
     sharing. Skipped under reduced-motion (no CPU spent on visual).
     ------------------------------------------------------------------ */
  const generateShareCard = useCallback(async () => {
    if (reduced || !shareCardRef.current || !head) return null
    try {
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 1,
        backgroundColor: 'var(--color-bg-primary)',
      })
      storeShareableCard(head.igdbGameId, dataUrl)
      try {
        if (
          typeof window !== 'undefined' &&
          window.location?.search?.includes('previewShareCard=1')
        ) {
          setShareCardPreview(dataUrl)
        }
      } catch {
        // Non-fatal debug affordance.
      }
      return dataUrl
    } catch (err) {
      console.warn('[celebration] share-card capture failed:', err)
      return null
    }
  }, [reduced, head])

  /* ------------------------------------------------------------------
     Share — fires Capacitor Share if available, falls back to
     Web Share API, then clipboard.
     ------------------------------------------------------------------ */
  const handleShare = useCallback(async () => {
    if (!head) return
    const title = head.game?.title || 'a game'
    const ratingText = reviewRating > 0 ? ` \u2014 ${reviewRating}/5 stars` : ''
    const shareText = `Just finished ${title}${ratingText} on GameTracker`

    if (!reduced) generateShareCard()

    try {
      await Share.share({
        title: `Finished ${title}`,
        text: shareText,
        dialogTitle: 'Share',
      })
    } catch {
      try {
        if (typeof navigator?.share === 'function') {
          await navigator.share({ title: `Finished ${title}`, text: shareText })
        } else if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareText)
        }
      } catch {
        // User dismissed the sheet — ignore.
      }
    }
  }, [head, reviewRating, reduced, generateShareCard])

  /* ------------------------------------------------------------------
     Done — dismisses the celebration.
     ------------------------------------------------------------------ */
  const handleDone = useCallback(() => {
    if (!head) return
    dismissCurrent()
  }, [head])

  if (!head || onReviewComposer) return null

  const accentCss = accentRgb
    ? `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`
    : 'var(--color-brand-primary)'

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

  const coverInitial = reduced ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }
  const coverAnimate = { scale: 1, opacity: 1 }
  const coverTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 280, damping: 22 }

  // Whether there's any real verdict content to show in the card.
  const hasVerdict = reviewRating > 0 || snippet || reviewHours > 0

  return createPortal(
    <div
      className="completion-celebration"
      style={{ background: backdropGradient }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-celebration-title"
    >
      {/* Confetti / reduced-motion fallback */}
      {reduced ? (
        <div className="completion-celebration__static-mark" aria-hidden="true">
          <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
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
              stroke="var(--color-brand-primary)"
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
        <span className="completion-celebration__eyebrow">Completed</span>

        {/* Cover — spring entrance, remounts per game so animation replays */}
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
          You finished it. That&rsquo;s a real one.
        </p>

        {/* Verdict card — only rendered when there's real data to show */}
        {hasVerdict && (
          <div className="completion-celebration__verdict">
            {reviewRating > 0 && (
              <div className="completion-celebration__rating-wrap">
                <span className="completion-celebration__rating-label">Your Rating</span>
                <StarRating rating={reviewRating} size={28} />
                <span className="completion-celebration__rating-value">
                  {reviewRating}&thinsp;/&thinsp;5
                </span>
              </div>
            )}

            {snippet && (
              <p className="completion-celebration__snippet">
                &ldquo;{snippet}&rdquo;
              </p>
            )}

            {reviewHours > 0 && (
              <p className="completion-celebration__hours">
                {reviewHours % 1 === 0
                  ? reviewHours.toFixed(0)
                  : reviewHours.toFixed(1)}{' '}
                hrs played
              </p>
            )}
          </div>
        )}

        <div className="completion-celebration__ctas">
          <button
            type="button"
            onClick={handleShare}
            className="form-button form-button--primary completion-celebration__cta-primary"
          >
            Share
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
          subtree to produce the PNG. Not the visible card — that's above. */}
      <div className="completion-celebration__share-host" aria-hidden="true">
        <ShareCard
          ref={shareCardRef}
          game={head.game}
          displayName={displayName}
          rating={reviewRating}
          accentRgb={accentRgb}
        />
      </div>

      {/* Debug preview gate: ?previewShareCard=1 */}
      {shareCardPreview && (
        <div className="completion-celebration__preview" aria-hidden="true">
          <img src={shareCardPreview} alt="" />
        </div>
      )}
    </div>,
    document.body
  )
}
