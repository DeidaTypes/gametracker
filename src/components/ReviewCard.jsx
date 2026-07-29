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
import { LuPin, LuPinOff, LuQuote } from 'react-icons/lu'
import StarRating from './StarRating'
import Pressable from './Pressable'
import { useLikeState, publishLikeState } from '../hooks/useLikeState'
import { likeReview, unlikeReview } from '../services/likeService'
import { shareCard } from '../services/share'
import { shouldShowCount } from '../utils/formatSocialCount'
import { formatActivityDate } from '../utils/formatActivityDate'
import DmShareSheet from './DmShareSheet'
import { bumpSharesCount } from '../hooks/useUserStats'
import { getDominantColor } from '../services/colorExtract'
import { getSizedImageUrl } from '../services/imageUtils'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { showToast } from './Toast'
import ReportSheet from './ReportSheet'
import { ReviewCardShell, ReviewCardShellHeader } from './reviews/ReviewCardShell'
import './ReviewCard.css'

/**
 * Pick the punchiest sentence from a review body.
 * Tries to find a sentence (ends in . ! ?) that is 40–280 chars.
 * Falls back to the first 200 chars trimmed to a word boundary.
 * Quote-selection logic (sprint 9A) is out of scope here.
 */
function extractQuote(body) {
  if (!body) return ''
  const text = body.trim()
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const s of sentences) {
    const t = s.trim()
    if (t.length >= 40 && t.length <= 280) return t
  }
  if (text.length <= 200) return text
  const cut = text.slice(0, 200)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + '\u2026'
}

const VIBE_LABELS = {
  masterpiece: 'Masterpiece',
  underrated:  'Underrated',
  mid:         'Mid',
  rage_quit:   'Rage Quit',
  comfort:     'Comfort',
}

const LIFE_LABELS = {
  childhood:   'Childhood',
  teen_years:  'Teen Years',
  college:     'College',
  burnout:     'Burnout',
  healing:     'Healing',
  traveling:   'Traveling',
  new_chapter: 'New Chapter',
}

/**
 * Canonical review card used across Sprint 5 surfaces:
 *   - Profile Reviews tab
 *   - Review detail/thread page (variant="detail")
 *   - Game detail page reviews section (variant="gamedetail")
 *   - Both "all reviews" screens (GameReviewsAll, DiscoverReviewsAll)
 *
 * The outer card surface (background, hairline border, radius, padding,
 * internal spacing) is the shared <ReviewCardShell/> — the same shell
 * every other review-display surface in the app uses (HomeReviewCard,
 * RecentActivityCard), so the bounded box is pixel-identical everywhere
 * even though each surface's content differs.
 *
 * Visual sections (top to bottom), for variant "default" / "compact" / "detail":
 *   1. Optional "Your review" pill
 *   2. Cover header — color-tinted gradient pulled from the cover image
 *   3. Optional review title
 *   4. Star rating (read-only display)
 *   5. Body text with overflow-aware "Read more..." (default variant only)
 *   6. Author row (avatar + username)
 *   7. Action row (like / comment / share)
 * This cover-header-first / author-at-bottom ordering is an intentional,
 * documented exception to the shared <ReviewCardShellHeader/> one-line
 * actor pattern (see ReviewCardShell.jsx) — it's the locked, cross-screen
 * Sprint 5 layout reused identically by Profile/thread/both "all reviews"
 * screens, so it is NOT reordered here; only the surrounding shell (this
 * component's root element) is shared.
 *
 * variant="gamedetail" is a compact, text-forward layout used only on the
 * Game Detail page's review list, where the cover/title are redundant
 * (the surrounding page is already scoped to that game):
 *   1. Header row (<ReviewCardShellHeader/>) — avatar, display name +
 *      "relationship · time ago" meta, whole-star rating right-aligned
 *   2. Body text
 *   3. Footer row — like count + comment count only (no share/kebab)
 * All markup/styling for this variant lives behind `variant === 'gamedetail'`
 * checks and a scoped `review-card--gamedetail` class, so it cannot affect
 * the other variants.
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
  const [sharingQuote, setSharingQuote] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)
  const kebabRef = useRef(null)
  const bodyRef = useRef(null)

  // Sized once at 64px — the cover header's actual on-screen footprint
  // (--cover-thumb-size) — so the <img> below and getDominantColor
  // share the exact same small IGDB URL: one download total, no
  // separate full-size fetch just to sample a swatch.
  const coverThumbUrl = getSizedImageUrl(review.game?.coverUrl, 64)

  // Pull the dominant swatch for the cover-header gradient. Cached at the
  // service layer so timeline scroll doesn't re-extract the same image.
  useEffect(() => {
    let cancelled = false
    if (!coverThumbUrl) return undefined
    getDominantColor(coverThumbUrl).then((c) => {
      if (!cancelled && c) setColor(c)
    })
    return () => {
      cancelled = true
    }
  }, [coverThumbUrl])

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

  const handleShare = () => {
    setDmShareOpen(true)
    bumpSharesCount(1)
  }

  const dmShareAttachment = {
    type: 'review',
    id: review.id,
    title:
      review.title ||
      `${review.author?.username || 'Someone'}\u2019s review of ${review.game?.name || 'a game'}`,
    cover_url: review.game?.coverUrl || null,
    subtitle: review.game?.name || null,
    url_path: `/reviews/${review.id}`,
  }

  const handleShareQuote = async () => {
    if (sharingQuote) return
    setKebabOpen(false)
    const quote = extractQuote(review.body)
    if (!quote) {
      showToast('No quotable text in this review.', 'error')
      return
    }
    setSharingQuote(true)
    showToast('Building share card\u2026')
    try {
      await shareCard({
        variant: 'quotable-review',
        data: {
          quote,
          game: {
            title: review.game.name || review.game.title || '',
            coverUrl: review.game.coverUrl || null,
          },
          rating: review.rating,
          username: review.author.username || review.author.displayName || '',
        },
        target: { type: 'review', id: review.id },
        title: `Review of ${review.game.name || 'a game'} on GameTracker`,
      })
      bumpSharesCount(1)
    } catch (err) {
      console.error('[ReviewCard] shareQuote error:', err)
      showToast('Could not create share card.', 'error')
    } finally {
      setSharingQuote(false)
    }
  }

  const goToReview = () => {
    if (variant === 'detail') return
    navigate(`/reviews/${review.id}/comments`)
  }
  const goToGame = (e) => {
    e.stopPropagation()
    navigate(`/game/${review.game.id}`)
  }

  const handleAuthorClick = (e) => {
    e.stopPropagation()
    const username = review.author.username
    const userId = review.author.userId || review.userId
    const target = username
      ? `/user/${encodeURIComponent(username)}`
      : userId
      ? `/user/id/${encodeURIComponent(userId)}`
      : null
    if (!target) return
    if (onAuthorClick) {
      onAuthorClick(username || userId)
    } else {
      navigate(target)
    }
  }

  // The CSS gradient reads --dominant-rgb as space-separated channels so
  // the rgba(... / alpha) modern syntax can compose alpha at use sites.
  const dominantStyle = color
    ? { '--dominant-rgb': `${color.r} ${color.g} ${color.b}` }
    : undefined

  // detail variant: no body clamping, card is not a tappable button
  const clampClass = variant === 'compact' ? 'clamp-3' : variant === 'detail' ? '' : 'clamp-5'
  // likeState.count is now the canonical, Supabase-backed count
  // (seeded by parents via prefetchLikeStatesForReviews); the
  // review.likeCount fallback keeps demo / dev fixtures rendering.
  const displayedLikeCount = likeState.count || review.likeCount || 0
  const displayedCommentCount = review.commentCount || 0

  // gamedetail variant: whole stars only (no half-star glyphs), and a
  // "relationship · time ago" meta line — relationship is read from the
  // review data when present, otherwise the line falls back to just the
  // relative time.
  const gdWholeRating = Math.round(
    Math.max(0, Math.min(5, Number(review.rating) || 0))
  )
  const gdTimeAgo = formatActivityDate(review.createdAt)
  const gdMeta = [review.relationship, gdTimeAgo].filter(Boolean).join(' · ')

  // Shared between variants so the clamp / "Read more…" logic isn't
  // duplicated — only its position in the tree differs by variant.
  const bodyContent = (
    <div className="review-card__body">
      <p ref={bodyRef} className={expanded ? '' : clampClass}>
        {review.body}
      </p>
      {!expanded && bodyOverflows && variant !== 'compact' && (
        <button
          type="button"
          className="review-card__read-more"
          onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
        >
          Read more…
        </button>
      )}
    </div>
  )

  return (
    <>
    <ReviewCardShell
      as={motion.article}
      className={
        variant === 'gamedetail' ? 'review-card review-card--gamedetail' : 'review-card'
      }
      initial={reduced ? false : { opacity: 0 }}
      animate={reduced ? undefined : { opacity: 1 }}
      transition={{ duration: 0.2 }}
      onClick={variant === 'detail' ? undefined : goToReview}
      role={variant === 'detail' ? undefined : 'button'}
      tabIndex={variant === 'detail' ? undefined : 0}
      onKeyDown={variant === 'detail' ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') goToReview() }}
    >
      {showOwnPill && (
        <div className="review-card__own-pill">Your review</div>
      )}

      {variant === 'gamedetail' ? (
        <>
          <ReviewCardShellHeader
            avatar={
              <button
                type="button"
                className="review-card__gd-avatar-btn"
                onClick={handleAuthorClick}
              >
                {review.author.avatarUrl ? (
                  <img
                    src={review.author.avatarUrl}
                    className="review-card__avatar review-card__gd-avatar"
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="review-card__avatar review-card__avatar--fallback review-card__gd-avatar"
                    aria-hidden="true"
                  >
                    {(review.author.username || review.author.displayName || '?')
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}
              </button>
            }
            end={<StarRating rating={gdWholeRating} size={16} />}
          >
            <button
              type="button"
              className="review-card__gd-name"
              onClick={handleAuthorClick}
            >
              {review.author.displayName || review.author.username || 'Anonymous'}
            </button>
            {gdMeta && <span className="review-card__gd-meta">{gdMeta}</span>}
          </ReviewCardShellHeader>

          {bodyContent}

          <div className="review-card__gd-footer">
            <Pressable
              onClick={(e) => { e.stopPropagation(); handleLike() }}
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
              {shouldShowCount(displayedLikeCount) && <span>{displayedLikeCount}</span>}
            </Pressable>
            <Pressable onClick={(e) => { e.stopPropagation(); goToReview() }} aria-label="Comment">
              <HiOutlineChat />
              {shouldShowCount(displayedCommentCount) && <span>{displayedCommentCount}</span>}
            </Pressable>
          </div>
        </>
      ) : (
        <>
        <Pressable
          className="review-card__cover-header"
          onClick={goToGame}
          style={dominantStyle}
          aria-label={`View ${review.game.name}`}
        >
          <img
            src={coverThumbUrl}
            className="review-card__cover-thumb"
            alt=""
            loading="lazy"
          />
          <div className="review-card__cover-meta">
            <div className="review-card__game-name">{review.game.name}</div>
            {(review.game.platform || review.game.year || review.game.developer) && (
              <div className="review-card__game-sub">
                {review.game.platform || review.game.year
                  ? [review.game.platform, review.game.year].filter(Boolean).join(' · ')
                  : review.game.developer}
              </div>
            )}
          </div>
          <div className="review-card__play-btn" aria-hidden="true">
            <HiPlay size={18} />
          </div>
        </Pressable>
  
        {review.title && (
          <h3 className="review-card__title">{review.title}</h3>
        )}
  
        <div className="review-card__rating-row">
          <StarRating rating={review.rating} size={24} />
          {review.hoursPlayed > 0 && (
            <span
              className="review-card__hours-chip"
              aria-label={`${review.hoursPlayed} hours played`}
            >
              {review.hoursPlayed % 1 === 0
                ? review.hoursPlayed
                : Number(review.hoursPlayed).toFixed(1)}{' '}
              hrs
            </span>
          )}
        </div>
  
        {(review.vibeStamp || review.lifeContext) && (
          <div className="review-card__stamps">
            {review.vibeStamp && (
              <span className="review-card__vibe-pill" data-vibe={review.vibeStamp}>
                {VIBE_LABELS[review.vibeStamp] || review.vibeStamp}
              </span>
            )}
            {review.lifeContext && (
              <span className="review-card__life-pill">
                {LIFE_LABELS[review.lifeContext] || review.lifeContext}
              </span>
            )}
          </div>
        )}
  
        {bodyContent}
  
        <button
          type="button"
          className="review-card__author"
          onClick={handleAuthorClick}
        >
          {review.author.avatarUrl ? (
            <img
              src={review.author.avatarUrl}
              className="review-card__avatar"
              alt=""
              loading="lazy"
            />
          ) : (
            <div className="review-card__avatar review-card__avatar--fallback" aria-hidden="true">
              {(review.author.username || review.author.displayName || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <span className="review-card__username">
            {review.author.username || review.author.displayName || 'Anonymous'}
          </span>
        </button>
  
        <div className="review-card__actions">
          <div className="review-card__actions-left">
            <Pressable
              onClick={(e) => { e.stopPropagation(); handleLike() }}
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
              {shouldShowCount(displayedLikeCount) && <span>{displayedLikeCount}</span>}
            </Pressable>
            <Pressable onClick={(e) => { e.stopPropagation(); goToReview() }} aria-label="Comment">
              <HiOutlineChat />
              {shouldShowCount(displayedCommentCount) && <span>{displayedCommentCount}</span>}
            </Pressable>
          </div>
          <div className="review-card__actions-right">
            <Pressable
              className="review-card__share"
              onClick={(e) => { e.stopPropagation(); handleShare() }}
              aria-label="Share"
            >
              <HiOutlineShare />
            </Pressable>
            <div className="review-card__kebab-wrap" ref={kebabRef}>
              <button
                type="button"
                className="review-card__kebab-btn"
                onClick={(e) => { e.stopPropagation(); setKebabOpen((v) => !v) }}
                aria-label="More options"
                aria-expanded={kebabOpen}
              >
                <HiDotsVertical />
              </button>
              {kebabOpen && (
                <div className="review-card__kebab-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={sharingQuote}
                    onClick={(e) => { e.stopPropagation(); handleShareQuote() }}
                  >
                    <LuQuote />
                    {sharingQuote ? 'Creating card\u2026' : 'Share quote'}
                  </button>
                  {isOwn && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation()
                          setKebabOpen(false)
                          onEdit?.(review)
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
                            onClick={(e) => {
                              e.stopPropagation()
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
                            onClick={(e) => {
                              e.stopPropagation()
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
                      onClick={(e) => {
                        e.stopPropagation()
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
        </>
      )}
    </ReviewCardShell>

    <ReportSheet
      isOpen={reportSheetOpen}
      onClose={() => setReportSheetOpen(false)}
      contentType="review"
      contentId={review.id}
    />
    <DmShareSheet
      isOpen={dmShareOpen}
      onClose={() => setDmShareOpen(false)}
      attachment={dmShareAttachment}
    />
    </>
  )
}

export default ReviewCard
