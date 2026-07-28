import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { HiOutlineHeart, HiHeart, HiOutlineChat, HiOutlinePlus, HiCheck } from 'react-icons/hi'
import { List as ListIcon } from 'lucide-react'
import Avatar from '../explore/Avatar'
import StarRating from '../StarRating'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { useReactions } from '../../hooks/useReactions'
import { useListPreview } from '../../hooks/useListPreview'
import { likeReview, unlikeReview } from '../../services/likeService'
import { addGameToBacklog } from '../../services/libraryService'
import { showToast } from '../Toast'
import { ReviewCardShell, ReviewCardShellHeader } from '../reviews/ReviewCardShell'
import { shouldShowCount } from '../../utils/formatSocialCount'
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
 * Formats `seconds` as "45m", "2h", or "2h 30m". Returns null below 60s
 * or for missing/invalid values so callers omit the qualifier entirely
 * rather than rendering "for 0m" — never fabricated.
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
 * Trims a review body down to a single short "quoted note" for the
 * game row's secondary line — never a multi-line paragraph. Cuts at
 * the nearest word boundary (never mid-word) and only falls back to a
 * hard cut if there's no reasonable space to break on.
 */
function truncateQuote(body, max = 88) {
  if (!body) return null
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > 40 ? cut.slice(0, lastSpace) : cut
  return `${safe.trimEnd()}\u2026`
}

/**
 * One-line header verb for `item.type` — deliberately short and never
 * carrying the game/list title (that lives in the game row below, so
 * nothing on the card repeats it). Identical for own vs. others' cards
 * — only the subject differs ("You" vs. the author's name, handled by
 * the caller), so no isOwn branching is needed here at all.
 */
function headerVerb(item) {
  switch (item.type) {
    case 'reviewed':
      return 'reviewed'
    case 'rated':
      return 'rated'
    case 'listed':
      return item.listKind === 'created' ? 'created a list' : 'added to a list'
    case 'backlogged':
      return 'backlogged'
    case 'finished':
      return 'finished'
    case 'started':
      return 'started'
    case 'played': {
      const duration = formatDuration(item.durationSeconds)
      return duration ? `logged ${duration}` : 'logged a session'
    }
    case 'favorited':
      return 'favorited'
    default:
      return 'did something'
  }
}

/**
 * The single secondary line under the game title, per type — never a
 * paragraph, never more than one line. Most types render nothing here
 * (the header verb + title already say everything there is to say);
 * only 'reviewed' (a short quoted note) and 'finished' (total playtime,
 * since the bare "finished" verb doesn't carry it) add one.
 */
function secondaryLine(item) {
  switch (item.type) {
    case 'reviewed': {
      const quote = truncateQuote(item.body)
      return quote ? `\u201c${quote}\u201d` : null
    }
    case 'listed':
      return item.listKind === 'created' ? null : `Added to ${item._listName || 'a list'}`
    case 'finished': {
      const d = formatDuration(item.durationSeconds)
      return d ? `${d} played` : null
    }
    default:
      return null
  }
}

/**
 * EventReactButton — like control for non-review event rows. Backed by
 * the generic `reactions` table (target_id = the activity_events row
 * id) rather than review_likes, since these rows aren't reviews. A
 * single fixed emoji keeps the visual language identical to the review
 * react button even though useReactions supports a full emoji set for
 * surfaces that want one.
 */
function EventReactButton({ targetId }) {
  const { reactions, toggle } = useReactions('activity', targetId)
  const mine = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const reacted = mine?.reacted || false
  const count = mine?.count || 0
  return (
    <Pressable
      className="home-review-card__icon-btn home-review-card__icon-btn--social"
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
      {shouldShowCount(count) && <span>{count}</span>}
    </Pressable>
  )
}

/**
 * ReadOnlyLikeCount — own-card like control: no self-reactions, but the
 * count still renders so the viewer can see engagement on their own
 * activity. A plain non-interactive `<span>` (not a button/Pressable) —
 * nothing to press, so nothing pretends to be pressable.
 */
function ReadOnlyLikeCount({ count, liked }) {
  const showCount = shouldShowCount(count)
  return (
    <span
      className="home-review-card__icon-btn home-review-card__icon-btn--social home-review-card__icon-btn--readonly"
      aria-label={showCount ? `${count} likes` : 'Like'}
    >
      {liked ? (
        <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
      ) : (
        <HiOutlineHeart className="home-review-card__heart-icon" />
      )}
      {showCount && <span>{count}</span>}
    </span>
  )
}

/**
 * ReadOnlyEventLikeCount — same as ReadOnlyLikeCount but for non-review
 * own event types, reading the live count off the same polymorphic
 * `reactions` cache EventReactButton uses (target_type: 'activity'), so
 * a reaction added by someone else after page load still shows up here
 * without a separate round-trip.
 */
function ReadOnlyEventLikeCount({ targetId }) {
  const { reactions } = useReactions('activity', targetId)
  const mine = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  return <ReadOnlyLikeCount count={mine?.count || 0} liked={false} />
}

/**
 * CommentAction — every card type (except the lightest 'backlogged'
 * type — see the no-action-row branch in the main render) gets a real,
 * working comment affordance. `review_comments` is polymorphic — it can
 * target either a review or an activity_events row (see
 * supabase/migrations/20260728140000_polymorphic_activity_comments.sql
 * + commentService.js) — so this is identical for every type, just
 * routed to the matching thread page (see goToReply).
 */
function CommentAction({ item, onReply }) {
  return (
    <Pressable
      className="home-review-card__icon-btn home-review-card__icon-btn--social"
      onClick={onReply}
      aria-label="Reply"
    >
      <HiOutlineChat />
      {shouldShowCount(item.commentCount) && <span>{item.commentCount}</span>}
    </Pressable>
  )
}

/**
 * BacklogAction — icon-only quick "add this game to my backlog" action.
 * Used two ways: (1) contextual, inside the bordered actions row, on
 * other people's cards that have a game (rating/review/list-add/status
 * events alike); (2) as the lightest card type's inline trailing icon
 * on a 'backlogged' event's game row (see HomeCardBody) — mirrors the
 * identical control Explore's Discover "Recently" shelf already ships
 * (RecentActivityCard.handleBacklog). Hidden on own cards — backlogging
 * a game you already have activity on makes no sense.
 */
function BacklogAction({ game }) {
  const [backlogged, setBacklogged] = useState(false)
  const [backlogging, setBacklogging] = useState(false)

  const handleClick = async (e) => {
    e.stopPropagation()
    if (backlogging || backlogged) return
    setBacklogging(true)
    const added = await addGameToBacklog(game)
    setBacklogging(false)
    if (added) setBacklogged(true)
  }

  return (
    <Pressable
      className="home-review-card__icon-btn home-review-card__icon-btn--accent"
      onClick={handleClick}
      disabled={backlogging || backlogged}
      aria-label={backlogged ? `${game.title} added to backlog` : `Add ${game.title} to backlog`}
    >
      {backlogged ? <HiCheck /> : <HiOutlinePlus />}
    </Pressable>
  )
}

/**
 * HomeCardBody — the compact content zone: a small cover + title (+ at
 * most one secondary line) for every type that has a specific game, or
 * a small mosaic/list-icon "cover" + list name + game count for a
 * list_created event (which has no specific game). Every type renders
 * through this same one-row shape — that's what keeps the feed's
 * rhythm steady per type rather than each type inventing its own block.
 *
 * `trailing` is an optional node rendered at the end of the row itself
 * (used only by the 'backlogged' lightest-card variant's inline "+" —
 * see the main render below) so that card never needs a separate,
 * bordered actions row at all.
 */
function HomeCardBody({ item, img, onGameClick, onListClick, listName, listGameCount, listCovers, trailing }) {
  const handleImgError = (e) => {
    e.target.src = COVER_FALLBACK
  }

  if (item.type === 'listed' && item.listKind === 'created') {
    const covers = (listCovers || []).slice(0, 4)
    return (
      <Pressable
        as="div"
        className="home-review-card__row"
        onClick={onListClick}
        aria-label={`View ${listName || 'list'}`}
      >
        <span className="home-review-card__thumb home-review-card__thumb--mosaic" aria-hidden="true">
          {covers.length > 0 ? (
            covers.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)
          ) : (
            <ListIcon size={16} />
          )}
        </span>
        <span className="home-review-card__meta">
          <span className="home-review-card__title">{listName || 'a list'}</span>
          {listGameCount != null && (
            <span className="home-review-card__secondary">
              {listGameCount} game{listGameCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </Pressable>
    )
  }

  if (!item.game) return null

  const secondary = secondaryLine({ ...item, _listName: listName })

  return (
    <Pressable
      as="div"
      className="home-review-card__row"
      onClick={onGameClick}
      aria-label={`View ${item.game.title}`}
    >
      <img
        src={img}
        className="home-review-card__thumb"
        alt=""
        loading="lazy"
        onError={handleImgError}
      />
      <span className="home-review-card__meta">
        <span className="home-review-card__title">{item.game.title}</span>
        {secondary && <span className="home-review-card__secondary">{secondary}</span>}
      </span>
      {trailing}
    </Pressable>
  )
}

/**
 * HomeReviewCard — "The pulse"'s per-item card. Renders every unified
 * activity type communityService.getHomeFeed returns — 'reviewed' /
 * 'rated' (from `reviews`) plus 'started' / 'finished' / 'listed' /
 * 'played' / 'backlogged' / 'favorited' (from `activity_events`, for
 * both the viewer and everyone else — see getHomeFeed's doc comment) —
 * through the exact same compact shell: a single-line header (avatar +
 * "{actor} {verb}" + a right-aligned timestamp, with stars appended
 * next to the timestamp for reviewed/rated), a small cover + title (+
 * at most one secondary line) game row, and — except for the lightest
 * 'backlogged' type, which stops at the game row plus an inline "+" —
 * an icon-only actions row separated by a hairline top border.
 *
 * Every type renders inside the identical <ReviewCardShell/> — one
 * surface, one hairline border, one radius/padding — with a 3px left
 * accent bar colored by event type (green = review/rating, purple =
 * list-add, cobalt = every other status event).
 *
 * Likes: 'reviewed'/'rated' use `review_likes` (via useLikeState); every
 * other type uses the generic cross-surface `reactions` table (via
 * EventReactButton/useReactions) — that table is polymorphic
 * (target_type: 'activity') and already supports non-review targets.
 * Every count on this card (likes, comments, reactions) goes through
 * `shouldShowCount` — the zero-state rule: a count renders as a numeral
 * only once it's >= 3, otherwise just the bare icon affordance, so
 * nothing here ever reads "0 likes" / "0 comments". The whole
 * like+comment cluster is pushed to the right edge of the actions row
 * (`margin-left: auto` — see HomeReviewCard.css) so a contextual
 * backlog "+" on the left never crowds it.
 * Comments: `review_comments` is polymorphic (review_id OR
 * activity_event_id, exactly one set — see commentService.js) so every
 * type except 'backlogged' gets a real, counted comment affordance
 * routed to the matching thread page (see CommentAction / goToReply).
 *
 * Contextual "add to backlog": any non-own card with a game gets the
 * small "+" icon in the actions row EXCEPT 'backlogged' cards, which
 * get it inline in the game row itself instead (no bordered actions
 * row at all) — that event type is deliberately the lightest card:
 * header + game row + one inline icon, nothing else.
 *
 * Own cards (`item.isOwn`, Home-is-the-hub sprint): "You" replaces the
 * author name in the header, and the like control becomes a read-only
 * count (ReadOnlyLikeCount / ReadOnlyEventLikeCount) — no
 * self-reactions, but engagement from others is still visible. The
 * comment affordance is untouched by `isOwn`: tapping the count on an
 * own review still opens the thread, same as anyone else's.
 *
 * @param {{ item: object }} props  See communityService.getHomeFeed's
 *   doc comment for the full item shape. Non-review types add: listId,
 *   listKind? ('created'|'added'), listName?, listGameCount?,
 *   listPreviewCovers?, reactionTargetId, durationSeconds? (all
 *   optional/omitted rather than fabricated).
 */
export default function HomeReviewCard({ item }) {
  const navigate = useNavigate()
  const isReviewType = REVIEW_TYPES.has(item.type)
  const likeState = useLikeState(isReviewType ? item.id : null)

  const listPreview = useListPreview(item.type === 'listed' ? item.listId : null)
  const listName = item.listName || listPreview?.name || null
  const listGameCount = item.listGameCount ?? listPreview?.gameCount ?? null
  const listCovers =
    item.listPreviewCovers ||
    (listPreview?.previewGames || []).map((g) => g.image).filter(Boolean)

  const when = relativeTime(item.createdAt)
  const img = item.game?.image || COVER_FALLBACK
  const displayedLikeCount = likeState.count || item.likeCount || 0

  const goToAuthor = (e) => {
    e.stopPropagation()
    const { username, id } = item.author
    if (username) navigate(`/user/${encodeURIComponent(username)}`)
    else if (id) navigate(`/user/id/${encodeURIComponent(id)}`)
  }

  const goToGame = (e) => {
    e?.stopPropagation?.()
    if (!item.game) return
    navigate(
      `/game/${item.game.id}`,
      item.game.image ? { state: { coverImage: item.game.image } } : undefined
    )
  }

  const goToList = (e) => {
    e?.stopPropagation?.()
    if (item.listId) navigate(`/list/${item.listId}`)
  }

  // Reviews/ratings route to the existing review-comments thread (same
  // destination ReviewCard.jsx's comment action uses); every other
  // type routes to the equivalent thread keyed by the activity_events
  // row id instead (item.id IS that row's id for non-review items —
  // see communityService._homeFeedItemFromEventRow).
  const goToReply = (e) => {
    e.stopPropagation()
    if (isReviewType) navigate(`/reviews/${item.id}/comments`)
    else navigate(`/activity/${item.id}/comments`)
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

  // 'backlogged' is the lightest card type — header + game row + an
  // inline "+" (for other people's cards only) is enough, per this
  // sprint's decluttering pass. No like/comment affordance at all.
  const isLightBacklog = item.type === 'backlogged'
  const showBacklogAdd = !item.isOwn && !!item.game && !isLightBacklog

  return (
    <ReviewCardShell className={`home-review-card home-review-card--${item.type}`}>
      <ReviewCardShellHeader
        avatar={
          <button type="button" className="home-review-card__avatar-btn" onClick={goToAuthor}>
            <Avatar user={item.author} size={28} />
          </button>
        }
        end={
          <>
            {isReviewType && item.rating != null && <StarRating rating={item.rating} size={12} />}
            <span className="home-review-card__time">{when}</span>
          </>
        }
      >
        <button type="button" className="home-review-card__author-name" onClick={goToAuthor}>
          {item.isOwn ? 'You' : item.author.displayName}
        </button>
        <span className="home-review-card__verb">{headerVerb(item)}</span>
      </ReviewCardShellHeader>

      <HomeCardBody
        item={item}
        img={img}
        onGameClick={goToGame}
        onListClick={goToList}
        listName={listName}
        listGameCount={listGameCount}
        listCovers={listCovers}
        trailing={
          isLightBacklog && !item.isOwn && item.game ? <BacklogAction game={item.game} /> : null
        }
      />

      {!isLightBacklog && (
        <div className="home-review-card__actions">
          {showBacklogAdd && <BacklogAction game={item.game} />}
          <div className="home-review-card__social-actions">
            {item.isOwn ? (
              isReviewType ? (
                <ReadOnlyLikeCount count={displayedLikeCount} liked={likeState.liked} />
              ) : (
                <ReadOnlyEventLikeCount targetId={item.reactionTargetId} />
              )
            ) : isReviewType ? (
              <Pressable
                className="home-review-card__icon-btn home-review-card__icon-btn--social"
                onClick={handleReact}
                aria-pressed={likeState.liked}
                aria-label={likeState.liked ? 'Remove reaction' : 'React'}
              >
                {likeState.liked ? (
                  <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
                ) : (
                  <HiOutlineHeart className="home-review-card__heart-icon" />
                )}
                {shouldShowCount(displayedLikeCount) && <span>{displayedLikeCount}</span>}
              </Pressable>
            ) : (
              <EventReactButton targetId={item.reactionTargetId} />
            )}
            <CommentAction item={item} onReply={goToReply} />
          </div>
        </div>
      )}
    </ReviewCardShell>
  )
}
