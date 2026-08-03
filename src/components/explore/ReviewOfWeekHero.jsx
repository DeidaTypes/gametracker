import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { shouldShowCount } from '../../utils/formatSocialCount'
import StarRatingDisplay from '../StarRatingDisplay'
import './ReviewOfWeekHero.css'

/**
 * Rating display: stars + numeric value, e.g. "★★★★·  4.0".
 * Previously rendered its own Unicode-glyph stars snapped to the
 * nearest half; now shares StarRatingDisplay's renderer (true
 * fractional fill) so this reads identically to every other screen.
 */
function RatingDisplay({ rating }) {
  const val = Number(rating) || 0
  return (
    <span className="rotw-stars">
      <StarRatingDisplay rating={val} size="sm" />
      <span className="rotw-rating-num">{val.toFixed(1)}</span>
    </span>
  )
}

/**
 * Spotlight hero for the most-liked review of the last 7 days.
 * Renders nothing when `review` is null (no qualifying review this week).
 *
 * Props:
 *   review — raw Supabase row enriched with `_likeCount` by getReviewOfWeek(),
 *            or null to hide the section.
 */
export default function ReviewOfWeekHero({ review }) {
  const navigate = useNavigate()

  if (!review) return null

  const coverUrl  = review.game_image || COVER_FALLBACK
  const gameTitle = review.game_title || 'Unknown Game'
  const rating    = Number(review.rating) || 0
  const body      = review.body || ''
  const likeCount = review._likeCount || 0
  const authorName = review.users?.display_name || review.users?.username || 'Anonymous'
  const avatarUrl  = review.users?.avatar_url || ''
  const gameId     = review.igdb_game_id

  function handleClick() {
    navigate(`/game/${gameId}`, { state: { coverImage: coverUrl } })
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div className="rotw-outer">
      <div
        className="rotw-hero"
        role="button"
        tabIndex={0}
        aria-label={`Review of the Week: ${gameTitle} by ${authorName}. Tap to view game.`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {/* Blurred background from the game cover */}
        <div className="rotw-bg" aria-hidden="true">
          <img src={coverUrl} alt="" className="rotw-bg-img" loading="eager" />
          <div className="rotw-bg-overlay" />
        </div>

        {/* Copper accent bar at top */}
        <div className="rotw-accent-bar" aria-hidden="true" />

        {/* Foreground content row */}
        <div className="rotw-fg">
          {/* Game cover */}
          <div className="rotw-cover-wrap" aria-hidden="true">
            <img
              src={coverUrl}
              alt={gameTitle}
              className="rotw-cover"
              loading="eager"
              onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
            />
          </div>

          {/* Info stack */}
          <div className="rotw-info">
            <span className="eyebrow rotw-eyebrow">Review of the Week</span>

            <h2 className="rotw-game-title">{gameTitle}</h2>

            <RatingDisplay rating={rating} />

            {body && <p className="rotw-body">{body}</p>}

            {/* Author row + like badge */}
            <div className="rotw-meta">
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt=""
                  className="rotw-avatar"
                  aria-hidden="true"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <span className="rotw-author">{authorName}</span>
              {shouldShowCount(likeCount) && (
                <span className="rotw-like-badge" aria-label={`${likeCount} likes`}>
                  <Heart size={11} className="rotw-like-icon" aria-hidden="true" />
                  {likeCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
