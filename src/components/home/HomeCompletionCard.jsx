import React from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../Avatar'
import StarRatingDisplay from '../StarRatingDisplay'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useReactions } from '../../hooks/useReactions'
import { formatActivityDate } from '../../utils/formatActivityDate'
import { ReviewCardShell } from '../reviews/ReviewCardShell'
import { ActionRow, EVENT_REACTION_EMOJI } from './HomeReviewCard'
import LikedBy from '../LikedBy'
import './HomeCompletionCard.css'

/**
 * HomeCompletionCard — Pulse card for 'finished' / 'completed' items.
 *
 * Mirrors the frozen HomeReviewCard layout exactly:
 *   A. Game zone — cover + title, stars (rated) or "Completed" (unrated)
 *   B. Byline — avatar + "{name} finished · {time}" below the content
 *   C. Actions — Like + Reply pills with divider
 *
 * Does not change HomeReviewCard.
 */
export default function HomeCompletionCard({ item, linkToThread = true, onCommentClick, likedBy }) {
  const navigate = useNavigate()
  const eventReactions = useReactions('activity', item.reactionTargetId)

  const when = formatActivityDate(item.createdAt, { compactAbsolute: true })
  const rating = item.rating != null ? Number(item.rating) : null
  const isRated = Number.isFinite(rating) && rating > 0
  const img = item.game?.image ? getSizedImageUrl(item.game.image, 48) : COVER_FALLBACK

  const eventReaction = eventReactions.reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const heartActive = eventReaction?.reacted || false
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

  const handleComment = (e) => {
    e?.stopPropagation?.()
    if (onCommentClick) {
      onCommentClick()
      return
    }
    goToReply(e)
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

      <div className="home-review-card__footer">
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
      </div>

      <LikedBy total={likedBy?.total} likers={likedBy?.likers} />

      <ActionRow
        likeActive={heartActive}
        likeInteractive={!item.isOwn}
        likeCount={heartCount}
        commentCount={item.commentCount}
        onLike={handleHeartClick}
        onComment={handleComment}
      />
    </ReviewCardShell>
  )
}
