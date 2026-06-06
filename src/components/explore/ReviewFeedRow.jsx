import React from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import StarRating from '../StarRating'
import SharedCover from '../SharedCover'
import SpoilerOverlay from '../SpoilerOverlay'
import { useAuth } from '../../contexts/AuthContext'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './ReviewFeedRow.css'

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.round(d / 7)
  return `${w}w ago`
}

/**
 * Normalise both shapes the feed can receive:
 *   1. Supabase row with joined users: { id, user_id, igdb_game_id, body,
 *        rating, has_spoilers, game_title, game_image, created_at,
 *        users: { display_name, avatar_url } }
 *   2. Mock community shape: { id, game: { id, title, image }, reviewer:
 *        { username, avatarColor }, rating, text, timestamp, has_spoilers? }
 */
function normaliseFeedReview(r) {
  if (!r) return null
  // Mock shape detection: mock rows always carry a pre-built `game` object.
  if (r.game && r.reviewer) {
    return {
      id: r.id,
      userId: r.reviewer?.id || null,
      gameId: r.game?.id,
      gameTitle: r.game?.title,
      gameImage: r.game?.image,
      reviewer: r.reviewer,
      rating: r.rating || 0,
      text: r.text || '',
      timestamp: r.timestamp || (r.date ? new Date(r.date).getTime() : 0),
      hasSpoilers: !!r.has_spoilers,
    }
  }
  // Supabase row shape.
  const joined = r.users || {}
  return {
    id: r.id,
    userId: r.user_id || null,
    gameId: r.igdb_game_id,
    gameTitle: r.game_title || 'Untitled Game',
    gameImage: r.game_image || '',
    reviewer: {
      id: r.user_id,
      displayName: joined.display_name || 'someone',
      username: joined.display_name || 'someone',
      avatarUrl: joined.avatar_url || null,
    },
    rating: r.rating || 0,
    text: r.body || '',
    timestamp: r.created_at ? new Date(r.created_at).getTime() : 0,
    hasSpoilers: !!r.has_spoilers,
  }
}

function ReviewFeedRow({ review }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const v = normaliseFeedReview(review)
  if (!v) return null

  const fallback = COVER_FALLBACK
  const img = v.gameImage || fallback

  // Don't blur the viewer's own reviews even on a community feed.
  const shouldBlur = v.hasSpoilers && v.userId !== user?.id

  const handleClick = () => {
    // Try to deep-link to the specific review on the game detail page.
    // GameDetail will scroll to it if it can, otherwise it just lands on the page.
    navigate(`/game/${v.gameId}?review=${encodeURIComponent(v.id || '')}`, {
      state: { coverImage: img },
    })
  }

  return (
    <button type="button" className="review-feed-row" onClick={handleClick}>
      <div className="review-feed-row__cover">
        <SharedCover gameId={v.gameId} imageSrc={img}>
          <img
            src={img}
            alt={v.gameTitle}
            loading="lazy"
            onError={(e) => { e.currentTarget.src = fallback }}
          />
        </SharedCover>
      </div>

      <div className="review-feed-row__body">
        <div className="review-feed-row__head">
          <Avatar user={v.reviewer} size={26} />
          <div className="review-feed-row__head-text">
            <span className="review-feed-row__user">@{v.reviewer?.username || 'someone'}</span>
            <span className="review-feed-row__sep">·</span>
            <span className="review-feed-row__game">{v.gameTitle}</span>
          </div>
        </div>

        {shouldBlur ? (
          <SpoilerOverlay>
            <p className="review-feed-row__text">{v.text}</p>
          </SpoilerOverlay>
        ) : (
          <p className="review-feed-row__text">{v.text}</p>
        )}

        <div className="review-feed-row__foot">
          {v.rating > 0 && (
            <span className="review-feed-row__stars">
              <StarRating rating={v.rating} size={12} />
            </span>
          )}
          <span className="review-feed-row__time">{timeAgo(v.timestamp)}</span>
        </div>
      </div>
    </button>
  )
}

export default ReviewFeedRow
