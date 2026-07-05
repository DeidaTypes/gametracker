import React, { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { HiOutlineHeart, HiHeart, HiOutlineChat } from 'react-icons/hi'
import Avatar from '../explore/Avatar'
import StarRating from '../StarRating'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { useReactions } from '../../hooks/useReactions'
import { likeReview, unlikeReview } from '../../services/likeService'
import { showToast } from '../Toast'
import './HomeReviewCard.css'

// Fixed single emoji so the generic cross-surface reactions table
// (target_type: 'activity' — see supabase/reactions.sql) renders as a
// plain heart+count control, visually matching the review react button
// (which is backed by review_likes, a different table, for 'reviewed'/
// 'rated' items).
const EVENT_REACTION_EMOJI = '\u2764\uFE0F'

function relativeTime(iso) {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * Formats `seconds` as "45m", "2h", or "2h 30m" for the 'played' event
 * row's optional "for {duration}" qualifier. Returns null below 60s or
 * for missing/invalid values so the caller can skip the qualifier
 * entirely rather than rendering "for 0m".
 */
function formatPlayedDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 60) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * EventReactButton — react control for non-review event rows (listed,
 * backlogged, finished, played, favorited). Backed by the generic
 * `reactions` table (target_id = the activity_events row id) rather
 * than review_likes, since these rows aren't reviews. A single fixed
 * emoji keeps the visual language identical to the review ReactButton
 * even though useReactions supports a full emoji set for surfaces that
 * want one.
 */
function EventReactButton({ targetId, className = '' }) {
  const { reactions, toggle } = useReactions('activity', targetId)
  const mine = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const reacted = mine?.reacted || false
  const count = mine?.count || 0
  return (
    <Pressable
      className={`home-review-card__react${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        toggle(EVENT_REACTION_EMOJI)
      }}
      aria-pressed={reacted}
      aria-label={reacted ? 'Remove reaction' : 'React'}
    >
      {reacted ? (
        <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
      ) : (
        <HiOutlineHeart className="home-review-card__heart-icon" />
      )}
      <span>{count}</span>
    </Pressable>
  )
}

/** ListViewAction — "View" affordance for 'listed' rows, deep-links to the list. */
function ListViewAction({ listId }) {
  const navigate = useNavigate()
  if (!listId) return null
  return (
    <Pressable
      className="home-review-card__view-btn"
      onClick={(e) => {
        e.stopPropagation()
        navigate(`/list/${listId}`)
      }}
    >
      View
    </Pressable>
  )
}

/**
 * Renders the verb phrase (and any trailing qualifier) for a compact
 * event row's sentence, given `item.type`. Keeps HomeReviewCard's main
 * body focused on layout rather than per-type copy branching.
 */
function CompactVerbPhrase({ item, onGameClick }) {
  const gameBtn = (
    <button type="button" className="home-review-card__compact-game" onClick={onGameClick}>
      {item.game.title}
    </button>
  )
  switch (item.type) {
    case 'rated':
      return <span className="home-review-card__verb">rated {gameBtn}</span>
    case 'listed':
      return (
        <span className="home-review-card__verb">
          added {gameBtn} to {item.listName ? `\u2018${item.listName}\u2019` : 'a list'}
        </span>
      )
    case 'backlogged':
      return <span className="home-review-card__verb">added {gameBtn} to their backlog</span>
    case 'finished':
      return <span className="home-review-card__verb">finished {gameBtn}</span>
    case 'played': {
      const duration = formatPlayedDuration(item.durationSeconds)
      return (
        <span className="home-review-card__verb">
          played {gameBtn}
          {duration ? ` for ${duration}` : ''}
        </span>
      )
    }
    case 'favorited':
      return <span className="home-review-card__verb">favorited {gameBtn}</span>
    default:
      return <span className="home-review-card__verb">did something with {gameBtn}</span>
  }
}

/**
 * HomeReviewCard — "The Feed"'s per-item card. Renders every unified
 * activity type communityService.getHomeFeed returns.
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
 *     action row (react, reply).
 *   - anything else ('rated', 'listed', 'backlogged', 'finished',
 *     'played', 'favorited') → compact event row: cover + "{actor} {verb}
 *     {game}[...]" + timestamp + react, with "View" to the list for
 *     'listed' rows (see ListViewAction) where it makes sense.
 *
 * Reactions are real: 'reviewed'/'rated' use `review_likes` (via
 * useLikeState); every other event type uses the generic cross-surface
 * `reactions` table (via EventReactButton/useReactions). Reply counts on
 * the full card are `review_comments` (item.commentCount, batched by
 * communityService.getHomeFeed's getCommentCountsForReviews) — never
 * fabricated placeholders.
 *
 * @param {{ item: object }} props  See communityService.getHomeFeed's
 *   doc comment for the full per-type item shape.
 */
export default function HomeReviewCard({ item }) {
  const navigate = useNavigate()
  const isReviewType = item.type === 'reviewed' || item.type === 'rated'
  const isCompact = item.type !== 'reviewed' || !item.body
  const likeState = useLikeState(isReviewType ? item.id : null)
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
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
    const showViewAction = item.type === 'listed'
    return (
      <article className={`home-review-card home-review-card--compact home-review-card--${item.type}`}>
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
            <CompactVerbPhrase item={item} onGameClick={goToGame} />
          </p>
          <div className="home-review-card__compact-meta">
            {item.type === 'rated' && item.rating != null && <StarRating rating={item.rating} size={13} />}
            <span className="home-review-card__time">{when}</span>
          </div>
        </div>

        <div className="home-review-card__compact-actions">
          {showViewAction && <ListViewAction listId={item.listId} />}
          {isReviewType ? (
            <ReactButton className="home-review-card__react--compact" />
          ) : (
            <EventReactButton targetId={item.reactionTargetId} className="home-review-card__react--compact" />
          )}
        </div>
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
        <ReactButton />
        <Pressable className="home-review-card__reply" onClick={goToReply} aria-label="Reply">
          <HiOutlineChat />
          <span>{item.commentCount || 0}</span>
        </Pressable>
      </div>
    </article>
  )
}
