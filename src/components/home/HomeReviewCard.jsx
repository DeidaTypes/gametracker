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
import { useListPreview } from '../../hooks/useListPreview'
import { likeReview, unlikeReview } from '../../services/likeService'
import { showToast } from '../Toast'
import { ReviewCardShell, ReviewCardShellHeader } from '../reviews/ReviewCardShell'
import './HomeReviewCard.css'

// Fixed single emoji so the generic cross-surface reactions table
// (target_type: 'activity' — see supabase/reactions.sql) renders as a
// plain heart+count control, visually matching the review react button
// (which is backed by review_likes, a different table, for 'reviewed'/
// 'rated' items).
const EVENT_REACTION_EMOJI = '\u2764\uFE0F'

const REVIEW_TYPES = new Set(['reviewed', 'rated'])

function relativeTime(iso) {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * Formats `seconds` as "45m", "2h", or "2h 30m" for a status pill's
 * optional duration qualifier ('finished'/'played'). Returns null below
 * 60s or for missing/invalid values so the caller can omit the
 * qualifier entirely rather than rendering "for 0m" — never fabricated.
 */
function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 60) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * One-line header verb for `item.type` — no game name here (that lives
 * in the content zone below). `listName` is passed separately since it
 * may come from the item itself or from useListPreview's lazy hydration.
 */
function headerVerb(item, listName) {
  switch (item.type) {
    case 'reviewed':
      return 'reviewed'
    case 'rated':
      return 'rated'
    case 'listed':
      return listName ? `added a game to ${listName}` : 'added a game to a list'
    case 'backlogged':
      return 'added to backlog'
    case 'finished':
      return 'finished'
    case 'played':
      return 'played'
    case 'favorited':
      return 'favorited'
    default:
      return 'did something'
  }
}

/** Status pill copy for the finished/backlogged/played/favorited content zone. Omits any duration that isn't actually stored. */
function statusLabel(item) {
  switch (item.type) {
    case 'finished': {
      const d = formatDuration(item.durationSeconds)
      return d ? `Finished \u00b7 ${d}` : 'Finished'
    }
    case 'backlogged':
      return 'Backlog'
    case 'played': {
      const d = formatDuration(item.durationSeconds)
      return d ? `Played \u00b7 ${d}` : 'Played'
    }
    case 'favorited':
      return 'Favorited'
    default:
      return null
  }
}

/**
 * EventReactButton — like control for non-review event rows (listed,
 * backlogged, finished, played, favorited). Backed by the generic
 * `reactions` table (target_id = the activity_events row id) rather
 * than review_likes, since these rows aren't reviews. A single fixed
 * emoji keeps the visual language identical to the review ReactButton
 * even though useReactions supports a full emoji set for surfaces that
 * want one.
 */
function EventReactButton({ targetId }) {
  const { reactions, toggle } = useReactions('activity', targetId)
  const mine = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const reacted = mine?.reacted || false
  const count = mine?.count || 0
  return (
    <Pressable
      className="home-review-card__react"
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

/**
 * CommentAction — every card type gets a comment affordance (task
 * requirement), but `review_comments` only has a `review_id` FK (see
 * schema diagnosis: comments are NOT polymorphic today, unlike
 * `reactions`). For 'reviewed'/'rated' this is real and wired to the
 * existing comments thread; for every other type it renders visibly but
 * is a deliberate no-op — no invented schema, no fabricated count —
 * until a future migration adds a polymorphic comments target.
 */
function CommentAction({ item, onReply }) {
  if (REVIEW_TYPES.has(item.type)) {
    return (
      <Pressable className="home-review-card__reply" onClick={onReply} aria-label="Reply">
        <HiOutlineChat />
        <span>{item.commentCount || 0}</span>
      </Pressable>
    )
  }
  return (
    <Pressable
      className="home-review-card__reply home-review-card__reply--disabled"
      onClick={(e) => e.stopPropagation()}
      aria-disabled="true"
      aria-label="Comments aren't available for this activity yet"
    >
      <HiOutlineChat />
    </Pressable>
  )
}

/**
 * HomeCardContent — the adaptive content zone. Chosen from `item.type`,
 * this is the core of the concept: every event renders in the same
 * shell with the same one-line header, but what fills the middle
 * changes shape entirely so a rating never looks like a review missing
 * its text, and a list-add never looks like a bare cover.
 */
function HomeCardContent({
  item,
  img,
  onGameClick,
  onListClick,
  listName,
  listGameCount,
  listCovers,
  expanded,
  onExpand,
  bodyOverflows,
  bodyRef,
}) {
  const handleImgError = (e) => {
    e.target.src = COVER_FALLBACK
  }

  if (item.type === 'reviewed') {
    return (
      <div className="home-review-card__content">
        <Pressable
          as="div"
          className="home-review-card__game-row"
          onClick={onGameClick}
          aria-label={`View ${item.game.title}`}
        >
          <img
            src={img}
            className="home-review-card__cover home-review-card__cover--sm"
            alt=""
            loading="lazy"
            onError={handleImgError}
          />
          <div className="home-review-card__game-meta">
            <span className="home-review-card__game-title">{item.game.title}</span>
            {item.rating != null && <StarRating rating={item.rating} size={14} />}
          </div>
        </Pressable>

        <div className="home-review-card__body">
          <p ref={bodyRef} className={expanded ? '' : 'home-review-card__clamp'}>
            {item.body}
          </p>
          {!expanded && bodyOverflows && (
            <button type="button" className="home-review-card__more" onClick={onExpand}>
              more
            </button>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'rated') {
    return (
      <Pressable
        as="div"
        className="home-review-card__content home-review-card__content--rated"
        onClick={onGameClick}
        aria-label={`View ${item.game.title}`}
      >
        <img
          src={img}
          className="home-review-card__cover home-review-card__cover--lg"
          alt=""
          loading="lazy"
          onError={handleImgError}
        />
        <div className="home-review-card__rated-meta">
          <span className="home-review-card__game-title">{item.game.title}</span>
          {item.rating != null && (
            <div className="home-review-card__rated-stars">
              <StarRating rating={item.rating} size={26} />
              <span className="home-review-card__score">{item.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      </Pressable>
    )
  }

  if (item.type === 'listed') {
    const covers = (listCovers || []).slice(0, 4)
    return (
      <div className="home-review-card__content">
        <Pressable
          as="div"
          className="home-review-card__game-row"
          onClick={onGameClick}
          aria-label={`View ${item.game.title}`}
        >
          <img
            src={img}
            className="home-review-card__cover home-review-card__cover--lg"
            alt=""
            loading="lazy"
            onError={handleImgError}
          />
          <span className="home-review-card__game-title">{item.game.title}</span>
        </Pressable>

        {item.listId && (
          <Pressable
            className="home-review-card__list-pill"
            onClick={onListClick}
            aria-label={`View ${listName || 'list'}`}
          >
            {listName || 'a list'}
            {listGameCount != null ? ` \u00b7 ${listGameCount} game${listGameCount === 1 ? '' : 's'}` : ''}
          </Pressable>
        )}

        {covers.length > 0 && (
          <Pressable
            as="div"
            className="home-review-card__mosaic"
            onClick={onListClick}
            aria-label={`View ${listName || 'list'} covers`}
          >
            {covers.map((src, i) => (
              <span key={i} className="home-review-card__mosaic-cell">
                <img src={src} alt="" loading="lazy" />
              </span>
            ))}
          </Pressable>
        )}
      </div>
    )
  }

  // finished / backlogged / played / favorited — cover-forward status rows
  const label = statusLabel(item)
  return (
    <div className="home-review-card__content">
      <Pressable
        as="div"
        className="home-review-card__game-row"
        onClick={onGameClick}
        aria-label={`View ${item.game.title}`}
      >
        <img
          src={img}
          className="home-review-card__cover home-review-card__cover--lg"
          alt=""
          loading="lazy"
          onError={handleImgError}
        />
        <span className="home-review-card__game-title">{item.game.title}</span>
      </Pressable>
      {label && <span className="home-review-card__status-pill">{label}</span>}
    </div>
  )
}

/**
 * HomeReviewCard — "The Feed"'s per-item card. Renders every unified
 * activity type communityService.getHomeFeed returns (today just
 * 'reviewed'/'rated' — see getHomeFeed's doc comment) plus every type
 * this shell is built to support ('listed', 'backlogged', 'finished',
 * 'played', 'favorited') so it's ready the moment the feed emits them.
 *
 * Every type renders inside the identical <ReviewCardShell/> — one
 * surface, one hairline border, one radius/padding, no nested surfaces,
 * no dividers between cards — with a 3px left accent bar colored by
 * event type (green = review/rating, purple = list-add, cobalt = every
 * other status event) and a single-line header: avatar + "{actor} {verb}"
 * + a right-aligned relative timestamp. Only the CONTENT ZONE below the
 * header adapts per type (see HomeCardContent) — that's the part of the
 * concept that keeps a rating from ever looking like a review missing
 * its text, or a list-add from looking like a bare cover.
 *
 * Likes: 'reviewed'/'rated' use `review_likes` (via useLikeState); every
 * other type uses the generic cross-surface `reactions` table (via
 * EventReactButton/useReactions) — that table is polymorphic
 * (target_type: 'activity') and already supports non-review targets.
 * Comments: `review_comments` only has a review_id FK — NOT polymorphic
 * — so every non-review type renders the comment affordance as a
 * visible no-op rather than a fabricated count (see CommentAction).
 *
 * @param {{ item: object }} props  See communityService.getHomeFeed's
 *   doc comment for the 'reviewed'/'rated' item shape. Other types add:
 *   listId, listName?, listGameCount?, listPreviewCovers?, reactionTargetId,
 *   durationSeconds? (all optional/omitted rather than fabricated).
 */
export default function HomeReviewCard({ item }) {
  const navigate = useNavigate()
  const isReviewType = REVIEW_TYPES.has(item.type)
  const likeState = useLikeState(isReviewType ? item.id : null)
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  const bodyRef = useRef(null)

  const listPreview = useListPreview(item.type === 'listed' ? item.listId : null)
  const listName = item.listName || listPreview?.name || null
  const listGameCount = item.listGameCount ?? listPreview?.gameCount ?? null
  const listCovers =
    item.listPreviewCovers ||
    (listPreview?.previewGames || []).map((g) => g.image).filter(Boolean)

  useLayoutEffect(() => {
    if (item.type !== 'reviewed' || expanded) {
      setBodyOverflows(false)
      return
    }
    const el = bodyRef.current
    if (!el) return
    setBodyOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [item.body, item.type, expanded])

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

  const goToList = (e) => {
    e?.stopPropagation?.()
    if (item.listId) navigate(`/list/${item.listId}`)
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

  return (
    <ReviewCardShell className={`home-review-card home-review-card--${item.type}`}>
      <ReviewCardShellHeader
        avatar={
          <button type="button" className="home-review-card__avatar-btn" onClick={goToAuthor}>
            <Avatar user={item.author} size={32} />
          </button>
        }
        end={<span className="home-review-card__time">{when}</span>}
      >
        <button type="button" className="home-review-card__author-name" onClick={goToAuthor}>
          {item.author.displayName}
        </button>
        <span className="home-review-card__verb">{headerVerb(item, listName)}</span>
      </ReviewCardShellHeader>

      <HomeCardContent
        item={item}
        img={img}
        onGameClick={goToGame}
        onListClick={goToList}
        listName={listName}
        listGameCount={listGameCount}
        listCovers={listCovers}
        expanded={expanded}
        onExpand={(e) => {
          e.stopPropagation()
          setExpanded(true)
        }}
        bodyOverflows={bodyOverflows}
        bodyRef={bodyRef}
      />

      <div className="home-review-card__actions">
        {isReviewType ? (
          <Pressable
            className="home-review-card__react"
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
        ) : (
          <EventReactButton targetId={item.reactionTargetId} />
        )}
        <CommentAction item={item} onReply={goToReply} />
      </div>
    </ReviewCardShell>
  )
}
