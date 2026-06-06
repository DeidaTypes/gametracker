import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  HiOutlineHeart,
  HiHeart,
  HiOutlineChat,
  HiOutlineShare,
  HiPlay,
  HiDotsVertical,
  HiOutlinePencil,
  HiOutlineFlag,
} from 'react-icons/hi'
import { LuPin, LuPinOff } from 'react-icons/lu'
import StarRating from './StarRating'
import Pressable from './Pressable'
import { useLikeState, publishLikeState } from '../hooks/useLikeState'
import { likeReview, unlikeReview } from '../services/likeService'
import { shareContent } from '../utils/share'
import { bumpSharesCount } from '../hooks/useUserStats'
import { getDominantColor } from '../services/colorExtract'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { showToast } from './Toast'
import ReportSheet from './ReportSheet'
import './ReviewCard.css'

/**
 * Canonical review card used across Sprint 5 surfaces:
 *   - Home timeline
 *   - Game detail page reviews section
 *   - Profile Reviews tab
 *
 * Visual sections (top to bottom):
 *   1. Optional "Your review" pill
 *   2. Cover header — color-tinted gradient pulled from the cover image
 *   3. Optional review title
 *   4. Star rating (read-only display)
 *   5. Body text with overflow-aware "Read more..." (default variant only)
 *   6. Author row (avatar + username)
 *   7. Action row (like / comment / share)
 *
 * Color extraction reuses the Sprint 4 P8 infrastructure
 * (`getDominantColor` from src/services/colorExtract.js), which is already
 * memoized in-process — multiple cards rendering the same cover share one
 * Vibrant pass.
 */
function ReviewCard({
  review,
  variant = 'default',
  showOwnPill = false,
  isOwn = false,
  onEdit,
  onAuthorClick,
  isPinned = false,
  onPin,
  onUnpin,
}) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const likeState = useLikeState(review.id)

  const [color, setColor] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  const [heartPulse, setHeartPulse] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)
  const kebabRef = useRef(null)
  const bodyRef = useRef(null)

  // Pull the dominant swatch for the cover-header gradient. Cached at the
  // service layer so timeline scroll doesn't re-extract the same image.
  useEffect(() => {
    let cancelled = false
    if (!review.game?.coverUrl) return undefined
    getDominantColor(review.game.coverUrl).then((c) => {
      if (!cancelled && c) setColor(c)
    })
    return () => {
      cancelled = true
    }
  }, [review.game?.coverUrl])

  // Detect whether the body actually overflows the clamp so we only
  // render "Read more..." when there's hidden content.
  useLayoutEffect(() => {
    if (variant === 'compact' || expanded) {
      setBodyOverflows(false)
      return
    }
    const el = bodyRef.current
    if (!el) return
    setBodyOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [review.body, variant, expanded])

  // Close the kebab when the user clicks outside it.
  useEffect(() => {
    if (!kebabOpen) return
    function handleOutside(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [kebabOpen])

  const handleLike = async () => {
    const prev = likeState
    const wasLiked = prev.liked
    // Optimistic flip — push the new state into the shared cache so
    // every mounted ReviewCard rendering this review id updates in
    // lockstep (Home timeline + Profile Reviews tab, etc.).
    const optimistic = {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    }
    publishLikeState(review.id, optimistic)

    if (!wasLiked && !reduced) {
      setHeartPulse(true)
      window.setTimeout(() => setHeartPulse(false), 260)
    }

    try {
      if (wasLiked) {
        await unlikeReview(review.id)
      } else {
        await likeReview(review.id)
      }
    } catch (err) {
      // Roll back to the pre-tap state and surface the error.
      // The service has already logged the underlying cause.
      publishLikeState(review.id, prev)
      showToast(
        wasLiked
          ? "Couldn't unlike — please try again."
          : "Couldn't like — please try again.",
        'error'
      )
    }
  }

  const handleShare = async () => {
    await shareContent({
      title:
        review.title ||
        `${review.author.username}'s review of ${review.game.name}`,
      text: review.body.slice(0, 100),
      url: `${window.location.origin}/reviews/${review.id}`,
    })
    // Sprint 5 P9 — feed the local-only `gt:shares-count` counter the
    // Shareholder badge scores against. We bump unconditionally (even
    // if the user dismisses the share sheet) so the counter is a
    // proxy for "share intent" rather than "successful share".
    bumpSharesCount(1)
  }

  const goToGame = () => navigate(`/game/${review.game.id}`)
  const goToComments = () => navigate(`/reviews/${review.id}/comments`)

  const handleAuthorClick = (e) => {
    e.stopPropagation()
    if (onAuthorClick) onAuthorClick(review.author.username)
    else navigate(`/user/${review.author.username}`)
  }

  // The CSS gradient reads --dominant-rgb as space-separated channels so
  // the rgba(... / alpha) modern syntax can compose alpha at use sites.
  const dominantStyle = color
    ? { '--dominant-rgb': `${color.r} ${color.g} ${color.b}` }
    : undefined

  const clampClass = variant === 'compact' ? 'clamp-3' : 'clamp-5'
  // likeState.count is now the canonical, Supabase-backed count
  // (seeded by parents via prefetchLikeStatesForReviews); the
  // review.likeCount fallback keeps demo / dev fixtures rendering.
  const displayedLikeCount = likeState.count || review.likeCount || 0

  return (
    <>
    <motion.article
      className="review-card"
      initial={reduced ? false : { opacity: 0 }}
      animate={reduced ? undefined : { opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {showOwnPill && (
        <div className="review-card__own-pill">Your review</div>
      )}

      <Pressable
        className="review-card__cover-header"
        onClick={goToGame}
        style={dominantStyle}
      >
        <img
          src={review.game.coverUrl}
          className="review-card__cover-thumb"
          alt=""
          loading="lazy"
        />
        <div className="review-card__cover-meta">
          <div className="review-card__game-name">{review.game.name}</div>
          <div className="review-card__game-sub">
            {review.game.developer} · Game
          </div>
        </div>
        <div className="review-card__play-btn" aria-hidden="true">
          <HiPlay size={18} />
        </div>
      </Pressable>

      {review.title && (
        <h3 className="review-card__title">{review.title}</h3>
      )}

      <StarRating rating={review.rating} size={24} />

      <div className="review-card__body">
        <p ref={bodyRef} className={expanded ? '' : clampClass}>
          {review.body}
        </p>
        {!expanded && bodyOverflows && variant !== 'compact' && (
          <button
            type="button"
            className="review-card__read-more"
            onClick={() => setExpanded(true)}
          >
            Read more…
          </button>
        )}
      </div>

      <button
        type="button"
        className="review-card__author"
        onClick={handleAuthorClick}
      >
        <img
          src={review.author.avatarUrl}
          className="review-card__avatar"
          alt=""
          loading="lazy"
        />
        <span className="review-card__username">
          {review.author.username}
        </span>
      </button>

      <div className="review-card__actions">
        <div className="review-card__actions-left">
          <Pressable
            onClick={handleLike}
            aria-label={likeState.liked ? 'Unlike' : 'Like'}
            aria-pressed={likeState.liked}
          >
            {likeState.liked ? (
              <HiHeart
                className={
                  heartPulse
                    ? 'review-card__heart-icon pulse'
                    : 'review-card__heart-icon'
                }
              />
            ) : (
              <HiOutlineHeart className="review-card__heart-icon" />
            )}
            <span>{displayedLikeCount}</span>
          </Pressable>
          <Pressable onClick={goToComments} aria-label="Comment">
            <HiOutlineChat />
            <span>{review.commentCount || 0}</span>
          </Pressable>
        </div>
        <div className="review-card__actions-right">
          <Pressable
            className="review-card__share"
            onClick={handleShare}
            aria-label="Share"
          >
            <HiOutlineShare />
          </Pressable>
          <div className="review-card__kebab-wrap" ref={kebabRef}>
            <button
              type="button"
              className="review-card__kebab-btn"
              onClick={() => setKebabOpen((v) => !v)}
              aria-label="More options"
              aria-expanded={kebabOpen}
            >
              <HiDotsVertical />
            </button>
            {kebabOpen && (
              <div className="review-card__kebab-menu" role="menu">
                {isOwn && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setKebabOpen(false)
                        onEdit?.()
                      }}
                    >
                      <HiOutlinePencil />
                      Edit review
                    </button>
                    {isPinned ? (
                      onUnpin && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setKebabOpen(false)
                            onUnpin()
                          }}
                        >
                          <LuPinOff />
                          Unpin from profile
                        </button>
                      )
                    ) : (
                      onPin && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setKebabOpen(false)
                            onPin()
                          }}
                        >
                          <LuPin />
                          Pin to profile
                        </button>
                      )
                    )}
                  </>
                )}
                {!isOwn && (
                  <button
                    type="button"
                    role="menuitem"
                    className="review-card__kebab-menu-report"
                    onClick={() => {
                      setKebabOpen(false)
                      setReportSheetOpen(true)
                    }}
                  >
                    <HiOutlineFlag />
                    Report review
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.article>

    <ReportSheet
      isOpen={reportSheetOpen}
      onClose={() => setReportSheetOpen(false)}
      contentType="review"
      contentId={review.id}
    />
    </>
  )
}

export default ReviewCard
