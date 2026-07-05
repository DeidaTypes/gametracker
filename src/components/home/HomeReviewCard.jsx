import React, { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { HiOutlineHeart, HiHeart, HiOutlineChat } from 'react-icons/hi'
import Avatar from '../explore/Avatar'
import StarRating from '../StarRating'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { likeReview, unlikeReview } from '../../services/likeService'
import { addGameToBacklog } from '../../services/libraryService'
import { showToast } from '../Toast'
import './HomeReviewCard.css'

function relativeTime(iso) {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * HomeReviewCard — Home feed's text-forward community review card.
 *
 * Distinct from Explore's `RecentActivityCard` (the taste-match /
 * genre-overlap strip lives there exclusively — never here) and from
 * the canonical `ReviewCard` (cover-header + gradient treatment used by
 * Profile/GameDetail). Home's version leads with the review TEXT.
 *
 * Two layouts, chosen from `item.type` (a property of the data, not a
 * display preference the caller passes in):
 *   - 'reviewed' → full card: avatar/name/timestamp header, game cover +
 *     title + stars, clamped body with a "more" affordance, and an
 *     action row (react, reply, ＋ List).
 *   - 'rated'    → compact single row for rating-only activity (no
 *     review body): cover + "{name} rated {game} ★★★★☆" + timestamp +
 *     react only — no reply/list actions, since there's no review to
 *     discuss and the game affordance is already one tap away via the
 *     cover.
 *
 * Reactions and reply counts are real (`review_likes` / `review_comments`
 * via useLikeState + item.commentCount from communityService.getHomeFeed's
 * batched getCommentCountsForReviews) — never fabricated placeholders.
 *
 * @param {{ item: {
 *   id: string, type: 'reviewed'|'rated', body: string, rating: number|null,
 *   hasSpoilers: boolean, createdAt: string,
 *   author: { id: string|null, username: string|null, displayName: string, avatarUrl: string|null },
 *   game: { id: number|string, title: string, image: string|null },
 *   likeCount: number, commentCount: number,
 * } }} props
 */
export default function HomeReviewCard({ item }) {
  const navigate = useNavigate()
  const isCompact = item.type !== 'reviewed' || !item.body
  const likeState = useLikeState(item.id)
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  const [backlogged, setBacklogged] = useState(false)
  const [backlogging, setBacklogging] = useState(false)
  const bodyRef = useRef(null)

  useLayoutEffect(() => {
    if (isCompact || expanded) {
      setBodyOverflows(false)
      return
    }
    const el = bodyRef.current
    if (!el) return
    setBodyOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [item.body, isCompact, expanded])

  const when = relativeTime(item.createdAt)
  const img = item.game.image || COVER_FALLBACK
  const displayedLikeCount = likeState.count || item.likeCount || 0

  const goToAuthor = (e) => {
    e.stopPropagation()
    const { username, id } = item.author
    if (username) navigate(`/user/${encodeURIComponent(username)}`)
    else if (id) navigate(`/user/id/${encodeURIComponent(id)}`)
  }

  const goToGame = (e) => {
    e?.stopPropagation?.()
    navigate(
      `/game/${item.game.id}`,
      item.game.image ? { state: { coverImage: item.game.image } } : undefined
    )
  }

  // TODO(reply-thread): a dedicated /reviews/:id/comments thread screen is
  // out of scope for this sprint — route to the existing review-comments
  // page (same destination ReviewCard.jsx's comment action uses) until it
  // exists.
  const goToReply = (e) => {
    e.stopPropagation()
    navigate(`/reviews/${item.id}/comments`)
  }

  const handleReact = async (e) => {
    e.stopPropagation()
    const prev = likeState
    const wasLiked = prev.liked
    publishLikeState(item.id, {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    })
    try {
      if (wasLiked) await unlikeReview(item.id)
      else await likeReview(item.id)
    } catch {
      publishLikeState(item.id, prev)
      showToast(
        wasLiked ? "Couldn't unreact — please try again." : "Couldn't react — please try again.",
        'error'
      )
    }
  }

  const handleAddToList = async (e) => {
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

  const ReactButton = ({ className = '' }) => (
    <Pressable
      className={`home-review-card__react${className ? ` ${className}` : ''}`}
      onClick={handleReact}
      aria-pressed={likeState.liked}
      aria-label={likeState.liked ? 'Remove reaction' : 'React'}
    >
      {likeState.liked ? (
        <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
      ) : (
        <HiOutlineHeart className="home-review-card__heart-icon" />
      )}
      <span>{displayedLikeCount}</span>
    </Pressable>
  )

  if (isCompact) {
    return (
      <article className="home-review-card home-review-card--compact">
        <Pressable
          as="div"
          className="home-review-card__compact-cover"
          onClick={goToGame}
          aria-label={`View ${item.game.title}`}
        >
          <img src={img} alt="" loading="lazy" onError={(e) => { e.target.src = COVER_FALLBACK }} />
        </Pressable>

        <div className="home-review-card__compact-body">
          <p className="home-review-card__compact-sentence">
            <button type="button" className="home-review-card__compact-name" onClick={goToAuthor}>
              {item.author.displayName}
            </button>{' '}
            rated{' '}
            <button type="button" className="home-review-card__compact-game" onClick={goToGame}>
              {item.game.title}
            </button>
          </p>
          <div className="home-review-card__compact-meta">
            {item.rating != null && <StarRating rating={item.rating} size={13} />}
            <span className="home-review-card__time">{when}</span>
          </div>
        </div>

        <ReactButton className="home-review-card__react--compact" />
      </article>
    )
  }

  return (
    <article className="home-review-card">
      <header className="home-review-card__head">
        <button type="button" className="home-review-card__avatar-btn" onClick={goToAuthor}>
          <Avatar user={item.author} size={36} />
        </button>
        <div className="home-review-card__head-text">
          <p className="home-review-card__sentence">
            <button type="button" className="home-review-card__author-name" onClick={goToAuthor}>
              {item.author.displayName}
            </button>{' '}
            <span className="home-review-card__verb">reviewed</span>
          </p>
          <span className="home-review-card__time">{when}</span>
        </div>
      </header>

      <Pressable
        as="div"
        className="home-review-card__game-row"
        onClick={goToGame}
        aria-label={`View ${item.game.title}`}
      >
        <img
          src={img}
          className="home-review-card__game-cover"
          alt=""
          loading="lazy"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
        <div className="home-review-card__game-meta">
          <span className="home-review-card__game-title">{item.game.title}</span>
          {item.rating != null && <StarRating rating={item.rating} size={15} />}
        </div>
      </Pressable>

      <div className="home-review-card__body">
        <p ref={bodyRef} className={expanded ? '' : 'home-review-card__clamp'}>
          {item.body}
        </p>
        {!expanded && bodyOverflows && (
          <button
            type="button"
            className="home-review-card__more"
            onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
          >
            more
          </button>
        )}
      </div>

      <div className="home-review-card__actions">
        <div className="home-review-card__actions-left">
          <ReactButton />
          <Pressable className="home-review-card__reply" onClick={goToReply} aria-label="Reply">
            <HiOutlineChat />
            <span>{item.commentCount || 0}</span>
          </Pressable>
        </div>
        <Pressable
          className="home-review-card__list-btn"
          onClick={handleAddToList}
          disabled={backlogging || backlogged}
          aria-label={`Add ${item.game.title} to your list`}
        >
          {backlogged ? 'Added' : '\uFF0B List'}
        </Pressable>
      </div>
    </article>
  )
}
