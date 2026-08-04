import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineHeart, HiHeart, HiOutlineChat } from 'react-icons/hi'
import Avatar from '../Avatar'
import StarRatingDisplay from '../StarRatingDisplay'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { likeReview, unlikeReview } from '../../services/likeService'
import { addGameToBacklog } from '../../services/libraryService'
import { genreColorVar } from '../../utils/genreColors'
import { ReviewCardShell, ReviewCardShellHeader } from '../reviews/ReviewCardShell'
import { shouldShowCount } from '../../utils/formatSocialCount'
import { hapticImpact } from '../../utils/haptics'
import './RecentActivityCard.css'

const ACTION_LABEL = { reviewed: 'reviewed', rated: 'rated' }

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.round(d / 7)}w`
}

/**
 * The algorithmic taste-match strip for a Recently card — overall % +
 * genre-overlap bar + top shared genres with their strengths, all sourced
 * from the real E0 `getTasteMatch` result. Renders nothing when the
 * engine returned null (below its confidence threshold) — never a
 * fabricated percentage or invented genre.
 */
function TasteMatchStrip({ tasteMatch }) {
  if (!tasteMatch) return null
  const topGenres = (tasteMatch.genres || []).slice(0, 3)
  const totalStrength = topGenres.reduce((sum, g) => sum + (g.strength || 0), 0) || 1

  return (
    <div className="recent-activity-card__taste">
      <span className="recent-activity-card__taste-score">
        {Math.round(tasteMatch.score)}% taste match
      </span>
      {topGenres.length > 0 && (
        <>
          <div
            className="recent-activity-card__taste-bar"
            role="img"
            aria-label={`Shared genres: ${topGenres.map((g) => `${g.genre} ${Math.round(g.strength)}%`).join(', ')}`}
          >
            {topGenres.map((g) => (
              <span
                key={g.genre}
                className="recent-activity-card__taste-seg"
                style={{
                  width: `${(g.strength / totalStrength) * 100}%`,
                  background: genreColorVar(g.genre),
                }}
              />
            ))}
          </div>
          <div className="recent-activity-card__taste-genres" aria-hidden="true">
            {topGenres.map((g) => (
              <span key={g.genre} className="recent-activity-card__taste-genre">
                <span
                  className="recent-activity-card__taste-dot"
                  style={{ background: genreColorVar(g.genre) }}
                />
                {g.genre} {Math.round(g.strength)}%
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * RecentActivityCard — one card in the Discover "Recently" shelf.
 *
 * actor + action + tappable game object + contextual actions, per item:
 *   - Add to backlog (always — writes want-to-play + game_trackers)
 *   - React / reply (only when the activity has a reviewId — a bare
 *     `rated` event with no review has nothing to like/comment on)
 *
 * Renders inside the shared <ReviewCardShell/> (same bounded box as
 * Home/GameDetail/Profile/thread) with a one-line <ReviewCardShellHeader/>
 * (avatar + actor + action + game, rating + time pinned to the end).
 * The algorithmic taste-match strip below the cover is Explore-exclusive
 * content and is NOT part of the shared shell — Home's card never shows
 * it, per the discovery-vs-conversation distinction between the two feeds.
 */
export default function RecentActivityCard({ item }) {
  const navigate = useNavigate()
  const likeState = useLikeState(item.reviewId)
  const [backlogged, setBacklogged] = useState(false)
  const [backlogging, setBacklogging] = useState(false)

  const canReact = !!item.reviewId
  const img = item.game.image || COVER_FALLBACK

  const goToGame = () => navigate(`/game/${item.game.id}`)

  const goToReply = (e) => {
    e.stopPropagation()
    if (item.reviewId) navigate(`/reviews/${item.reviewId}/comments`)
  }

  const goToAuthor = (e) => {
    e.stopPropagation()
    if (item.actor.username) navigate(`/user/${encodeURIComponent(item.actor.username)}`)
    else if (item.actor.id) navigate(`/user/id/${encodeURIComponent(item.actor.id)}`)
  }

  const handleReact = async (e) => {
    e.stopPropagation()
    if (!canReact) return
    const prev = likeState
    const wasLiked = prev.liked
    hapticImpact('Light')
    publishLikeState(item.reviewId, {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    })
    try {
      if (wasLiked) await unlikeReview(item.reviewId)
      else await likeReview(item.reviewId)
    } catch {
      publishLikeState(item.reviewId, prev)
    }
  }

  const handleBacklog = async (e) => {
    e.stopPropagation()
    if (backlogging || backlogged) return
    setBacklogging(true)
    const added = await addGameToBacklog({
      id: item.game.id,
      title: item.game.title,
      image: item.game.image,
    })
    setBacklogging(false)
    if (added) setBacklogged(true)
  }

  return (
    <ReviewCardShell className="recent-activity-card">
      <ReviewCardShellHeader
        avatar={
          <button type="button" className="recent-activity-card__avatar-btn" onClick={goToAuthor}>
            <Avatar user={item.actor} size="sm" />
          </button>
        }
        end={
          <>
            {item.rating != null && <StarRatingDisplay rating={item.rating} size="xs" />}
            <span className="recent-activity-card__time">{timeAgo(item.timestamp)}</span>
          </>
        }
      >
        <button type="button" className="recent-activity-card__actor-name" onClick={goToAuthor}>
          {item.actor.displayName}
        </button>
        <span className="recent-activity-card__verb">{ACTION_LABEL[item.type] || 'rated'}</span>
        <button type="button" className="recent-activity-card__game-name" onClick={goToGame}>
          {item.game.title}
        </button>
      </ReviewCardShellHeader>

      <Pressable
        as="div"
        className="recent-activity-card__cover-row"
        onClick={goToGame}
        aria-label={`View ${item.game.title}`}
      >
        <SharedCover gameId={item.game.id} imageSrc={img}>
          <img src={img} alt="" className="recent-activity-card__cover" loading="lazy" />
        </SharedCover>
        <span className="recent-activity-card__game-title-overlay">{item.game.title}</span>
      </Pressable>

      <TasteMatchStrip tasteMatch={item.tasteMatch} />

      <div className="recent-activity-card__actions">
        <Pressable
          className="recent-activity-card__backlog-btn"
          onClick={handleBacklog}
          disabled={backlogging || backlogged}
          aria-label={`Add ${item.game.title} to backlog`}
        >
          {backlogged ? 'Added to Backlog' : '+ Add to Backlog'}
        </Pressable>
        {canReact && (
          <div className="recent-activity-card__icon-actions">
            <Pressable
              className="recent-activity-card__icon-btn"
              onClick={handleReact}
              aria-pressed={likeState.liked}
              aria-label={likeState.liked ? 'Unlike' : 'Like'}
            >
              {likeState.liked ? (
                <HiHeart className="recent-activity-card__heart-icon recent-activity-card__heart-icon--liked" />
              ) : (
                <HiOutlineHeart className="recent-activity-card__heart-icon" />
              )}
              {shouldShowCount(likeState.count) && <span>{likeState.count}</span>}
            </Pressable>
            <Pressable
              className="recent-activity-card__icon-btn"
              onClick={goToReply}
              aria-label="Reply"
            >
              <HiOutlineChat />
            </Pressable>
          </div>
        )}
      </div>
    </ReviewCardShell>
  )
}
