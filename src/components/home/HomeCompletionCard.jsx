import React from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineHeart, HiHeart, HiOutlineChat } from 'react-icons/hi'
import Avatar from '../Avatar'
import StarRatingDisplay from '../StarRatingDisplay'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useReactions } from '../../hooks/useReactions'
import { shouldShowCount } from '../../utils/formatSocialCount'
import { formatActivityDate } from '../../utils/formatActivityDate'
import { ReviewCardShell } from '../reviews/ReviewCardShell'
import './HomeReviewCard.css'

// Same single-emoji heart the review card uses for activity_events
// reactions (target_type: 'activity'). Quoted from HomeReviewCard.jsx.
const EVENT_REACTION_EMOJI = '\u2764\uFE0F'

function ActionRow({ likeActive, likeInteractive, likeCount, commentCount, onLike, onComment }) {
  const heartIcon = likeActive ? (
    <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
  ) : (
    <HiOutlineHeart className="home-review-card__heart-icon" />
  )

  return (
    <div className="home-review-card__actions">
      {likeInteractive ? (
        <Pressable
          className="home-review-card__action"
          onClick={onLike}
          aria-pressed={likeActive}
          aria-label={likeActive ? 'Remove reaction' : 'React'}
        >
          {heartIcon}
          {shouldShowCount(likeCount) && (
            <span className="home-review-card__action-count">{likeCount}</span>
          )}
        </Pressable>
      ) : (
        <span
          className="home-review-card__action home-review-card__action--readonly"
          aria-label={
            shouldShowCount(likeCount) ? `${likeCount} likes` : likeActive ? 'Liked' : 'Like'
          }
        >
          {heartIcon}
          {shouldShowCount(likeCount) && (
            <span className="home-review-card__action-count">{likeCount}</span>
          )}
        </span>
      )}

      <Pressable className="home-review-card__action" onClick={onComment} aria-label="Reply">
        <HiOutlineChat />
        {shouldShowCount(commentCount) && (
          <span className="home-review-card__action-count">{commentCount}</span>
        )}
      </Pressable>
    </div>
  )
}

/**
 * HomeCompletionCard — Pulse card for 'finished' / 'completed' items.
 *
 * Mirrors the frozen HomeReviewCard layout exactly:
 *   A. Game zone — cover + title, stars (rated) or "Completed" (unrated)
 *   B. Byline — avatar + "{name} finished · {time}" below the content
 *   C. Actions — heart + comment row with divider
 *
 * Does not change HomeReviewCard.
 */
export default function HomeCompletionCard({ item, linkToThread = true }) {
  const navigate = useNavigate()
  const eventReactions = useReactions('activity', item.reactionTargetId)

  const when = formatActivityDate(item.createdAt, { compactAbsolute: true })
  const rating = item.rating != null ? Number(item.rating) : null
  const isRated = Number.isFinite(rating) && rating > 0
  const img = item.game?.image ? getSizedImageUrl(item.game.image, 60) : COVER_FALLBACK

  const eventReaction = eventReactions.reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const heartActive = !item.isOwn && (eventReaction?.reacted || false)
  const heartCount = eventReaction?.count || 0

  const authorLabel = item.isOwn
    ? 'You'
    : item.author?.displayName || item.author?.username
  const gameTitle = item.game?.title

  const goToAuthor = (e) => {
    e.stopPropagation()
    const { username, id } = item.author || {}
    if (username) navigate(`/user/${encodeURIComponent(username)}`)
    else if (id) navigate(`/user/id/${encodeURIComponent(id)}`)
  }

  const goToGame = (e) => {
    e?.stopPropagation?.()
    if (!item.game) return
    navigate(`/game/${item.game.id}`, { state: getGameNavStub(item.game) })
  }

  const goToReply = (e) => {
    e?.stopPropagation?.()
    navigate(`/activity/${item.id}/comments`)
  }

  const handleHeartClick = (e) => {
    e.stopPropagation()
    eventReactions.toggle(EVENT_REACTION_EMOJI)
  }

  const handleImgError = (e) => {
    e.target.src = COVER_FALLBACK
  }

  return (
    <ReviewCardShell
      className={`home-review-card home-review-card--finished${
        linkToThread ? ' home-review-card--opens-thread' : ''
      }`}
      onClick={linkToThread ? goToReply : undefined}
    >
      {item.game && (
        <div className="home-review-card__game">
          <img
            src={img}
            className="home-review-card__cover"
            alt=""
            loading="lazy"
            onError={handleImgError}
          />
          <span className="home-review-card__game-meta">
            {gameTitle ? (
              <button
                type="button"
                className="home-review-card__game-title"
                onClick={goToGame}
              >
                <span className="home-review-card__game-title-text">{gameTitle}</span>
              </button>
            ) : null}
            {isRated ? (
              <span className="home-review-card__rating">
                <StarRatingDisplay rating={rating} size="xs" />
              </span>
            ) : (
              <span className="home-review-card__score">Completed</span>
            )}
          </span>
        </div>
      )}

      <div className="home-review-card__byline">
        <button
          type="button"
          className="home-review-card__avatar-btn"
          onClick={goToAuthor}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Avatar user={item.author} size="xs" />
        </button>
        <button type="button" className="home-review-card__author-name" onClick={goToAuthor}>
          {authorLabel}
        </button>
        <span className="home-review-card__verb">finished</span>
        <span className="home-review-card__dot" aria-hidden="true">
          {'\u00b7'}
        </span>
        <span className="home-review-card__time">{when}</span>
      </div>

      <ActionRow
        likeActive={heartActive}
        likeInteractive={!item.isOwn}
        likeCount={heartCount}
        commentCount={item.commentCount}
        onLike={handleHeartClick}
        onComment={goToReply}
      />
    </ReviewCardShell>
  )
}
