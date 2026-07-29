import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { formatActivityDate } from '../../utils/formatActivityDate'
import './HomeReviewCard.css'

// Fixed single emoji so the generic cross-surface reactions table
// (target_type: 'activity' — see supabase/reactions.sql) renders as a
// plain heart control, visually matching the review react button
// (which is backed by review_likes, a different table, for 'reviewed'/
// 'rated' items).
const EVENT_REACTION_EMOJI = '\u2764\uFE0F'

const REVIEW_TYPES = new Set(['reviewed', 'rated'])

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
 * ZONE 1 (header) verb — deliberately short, fixed vocabulary, and
 * NEVER carries the game/list title or a star rating (those live in
 * zone 2, the game row below). Identical for own vs. others' cards —
 * only the subject differs ("You" vs. the author's name, handled by
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
    case 'journaled':
      return 'added a journal entry'
    default:
      return 'did something'
  }
}

/**
 * ZONE 2 (game row) secondary text line, per type — this is the text
 * half of the game row's second line; the star-rating half (when the
 * type carries a rating) is rendered separately in HomeCardBody so the
 * two can stack without either one needing to fabricate the other.
 * Most types render nothing here (the header verb + title already say
 * everything there is to say); only 'reviewed' (a short quoted note)
 * and 'finished' (total playtime, since the bare "finished" verb
 * doesn't carry it) add one.
 */
function secondaryText(item) {
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
 * CommentButton — icon-only comment affordance, grouped into zone 3's
 * left icon cluster for every card type (except the lightest
 * 'backlogged' type — see the no-action-row branch in the main
 * render). `review_comments` is polymorphic — it can target either a
 * review or an activity_events row (see
 * supabase/migrations/20260728140000_polymorphic_activity_comments.sql
 * + commentService.js) — so this is identical for every type, just
 * routed to the matching thread page (see goToReply). Its count is
 * rendered separately, right-aligned, by <ActionCounts/> below — never
 * inline on the icon itself.
 */
function CommentButton({ onClick }) {
  return (
    <Pressable
      className="home-review-card__icon-btn home-review-card__icon-btn--social"
      onClick={onClick}
      aria-label="Reply"
    >
      <HiOutlineChat />
    </Pressable>
  )
}

/**
 * HeartButton — icon-only like/react affordance for zone 3's left
 * icon cluster. Interactive (a real toggle) on every non-own card;
 * read-only (a plain, non-focusable `<span>` — nothing to press, so
 * nothing pretends to be pressable) on the viewer's own cards, which
 * still show accurate fill state/engagement from others without
 * allowing self-reactions.
 */
function HeartButton({ active, interactive, onClick }) {
  const icon = active ? (
    <HiHeart className="home-review-card__heart-icon home-review-card__heart-icon--active" />
  ) : (
    <HiOutlineHeart className="home-review-card__heart-icon" />
  )

  if (!interactive) {
    return (
      <span
        className="home-review-card__icon-btn home-review-card__icon-btn--social home-review-card__icon-btn--readonly"
        aria-label={active ? 'Liked' : 'Like'}
      >
        {icon}
      </span>
    )
  }

  return (
    <Pressable
      className="home-review-card__icon-btn home-review-card__icon-btn--social"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? 'Remove reaction' : 'React'}
    >
      {icon}
    </Pressable>
  )
}

/**
 * ActionCounts — zone 3's right-aligned numerals, entirely separate
 * from the left icon cluster above. Each count goes through
 * `shouldShowCount` — the zero-state rule: a count only renders once
 * it's >= 3, otherwise it's omitted outright, so nothing here ever
 * reads "0 likes" / "1 comment". Renders nothing at all (not even the
 * wrapper) once both counts are below threshold, so it never leaves a
 * dangling gap on an otherwise-quiet card.
 */
function ActionCounts({ likeCount, commentCount }) {
  const parts = []
  if (shouldShowCount(likeCount)) parts.push(String(likeCount))
  if (shouldShowCount(commentCount)) parts.push(String(commentCount))
  if (parts.length === 0) return null

  const label = [
    shouldShowCount(likeCount) && `${likeCount} likes`,
    shouldShowCount(commentCount) && `${commentCount} comments`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <span className="home-review-card__counts" aria-label={label}>
      {parts.join(' \u00b7 ')}
    </span>
  )
}

/**
 * BacklogAction — icon-only quick "add this game to my backlog" action.
 * Used two ways: (1) contextual, as the last icon in zone 3's left
 * cluster, on other people's cards that have a game (rating/review/
 * list-add/status events alike); (2) as the lightest card type's
 * inline trailing icon on a 'backlogged' event's game row (see
 * HomeCardBody) — mirrors the identical control Explore's Discover
 * "Recently" shelf already ships (RecentActivityCard.handleBacklog).
 * Hidden on own cards — backlogging a game you already have activity
 * on makes no sense.
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
 * HomeCardBody — ZONE 2, the game row. A small cover + title, wrapping
 * up to 2 lines (never mid-word truncated) + at most one secondary
 * line underneath for every type that has a specific game, or a small
 * mosaic/list-icon "cover" + list name + game count for a list_created
 * event (which has no specific game). Every type renders through this
 * same one-row shape — that's what keeps the feed's rhythm steady per
 * type rather than each type inventing its own block.
 *
 * The secondary line is where the star rating lives (for 'reviewed' /
 * 'rated', whenever the event carries a rating) — never in the header
 * above. When a type also has a short text line (a quoted review
 * excerpt, or total playtime), that text stacks directly beneath the
 * stars; most types have neither and the row is just cover + title.
 *
 * `trailing` is an optional node rendered at the end of the row itself
 * (used only by the 'backlogged' lightest-card variant's inline "+" —
 * see the main render below) so that card never needs a separate zone
 * 3 actions row at all.
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

  const showRating = REVIEW_TYPES.has(item.type) && item.rating != null
  const text = secondaryText({ ...item, _listName: listName })

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
        {showRating && <StarRating rating={item.rating} size={12} />}
        {text && <span className="home-review-card__secondary">{text}</span>}
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
 * through the exact same compact THREE-ZONE shell:
 *
 *   Zone 1 — header: avatar (28px) + display name + short verb +
 *     timestamp pinned right, one line, never wrapping. The name
 *     ellipsizes if it's genuinely long; the verb never does (it's
 *     always short, fixed vocabulary — see headerVerb) — no star
 *     rating and no game/list title ever render here.
 *   Zone 2 — game row: small cover + title (wraps up to 2 lines) +
 *     the star rating (reviewed/rated only) and/or a short secondary
 *     text line (quote/hours), stacked tight beneath the title. This
 *     is the ONLY place stars ever render on this card.
 *   Zone 3 — actions row: a left-grouped icon cluster (heart, comment,
 *     + contextual backlog "+"), a thin top hairline, and
 *     right-aligned like/comment counts (only once >= 3 — see
 *     shouldShowCount) — never spread across the row. Skipped
 *     entirely for the lightest 'backlogged' type, which stops at the
 *     game row plus an inline "+" instead.
 *
 * Every type renders inside the identical <ReviewCardShell/> — one
 * surface, one hairline border, one radius/padding — with a 3px left
 * accent bar colored by event type (green = review/rating, purple =
 * list-add, cobalt = every other status event). Zone spacing itself
 * (header→game row, game row→actions) is tightened with scoped
 * `.home-review-card`-only overrides in HomeReviewCard.css rather than
 * touching ReviewCardShell's shared `--section-gap` token, since that
 * token is also used by other, out-of-scope surfaces (GameDetail,
 * Profile, RecentActivityCard, etc.).
 *
 * Likes: 'reviewed'/'rated' use `review_likes` (via useLikeState); every
 * other type uses the generic cross-surface `reactions` table (via
 * useReactions, target_type: 'activity') — both feed the same
 * <HeartButton/>, with a single shared <ActionCounts/> reading whichever
 * count applies. Comments: `review_comments` is polymorphic (review_id
 * OR activity_event_id, exactly one set — see commentService.js) so
 * every type except 'backlogged' gets a real, counted comment
 * affordance routed to the matching thread page (see CommentButton /
 * goToReply).
 *
 * Contextual "add to backlog": any non-own card with a game gets the
 * small "+" icon in zone 3's left cluster EXCEPT 'backlogged' cards,
 * which get it inline in the game row itself instead (no zone 3 at
 * all) — that event type is deliberately the lightest card: header +
 * game row + one inline icon, nothing else.
 *
 * Own cards (`item.isOwn`, Home-is-the-hub sprint): "You" replaces the
 * author name in the header, and the heart becomes read-only (no
 * self-reactions, but engagement from others is still visible via its
 * count). The comment affordance is untouched by `isOwn`: tapping the
 * count on an own review still opens the thread, same as anyone else's.
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
  const eventReactions = useReactions('activity', item.reactionTargetId)

  const listPreview = useListPreview(item.type === 'listed' ? item.listId : null)
  const listName = item.listName || listPreview?.name || null
  const listGameCount = item.listGameCount ?? listPreview?.gameCount ?? null
  const listCovers =
    item.listPreviewCovers ||
    (listPreview?.previewGames || []).map((g) => g.image).filter(Boolean)

  const when = formatActivityDate(item.createdAt)
  const img = item.game?.image || COVER_FALLBACK
  const displayedLikeCount = likeState.count || item.likeCount || 0

  const eventReaction = eventReactions.reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const eventReacted = eventReaction?.reacted || false
  const eventCount = eventReaction?.count || 0

  const heartCount = isReviewType ? displayedLikeCount : eventCount
  const heartActive = isReviewType ? likeState.liked : !item.isOwn && eventReacted

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

  const handleReviewReact = async (e) => {
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

  const handleHeartClick = (e) => {
    if (isReviewType) handleReviewReact(e)
    else {
      e.stopPropagation()
      eventReactions.toggle(EVENT_REACTION_EMOJI)
    }
  }

  // 'backlogged' is the lightest card type — header + game row + an
  // inline "+" (for other people's cards only) is enough, per this
  // sprint's decluttering pass. No zone 3 actions row at all.
  const isLightBacklog = item.type === 'backlogged'
  const showBacklogAdd = !item.isOwn && !!item.game && !isLightBacklog

  return (
    <ReviewCardShell className={`home-review-card home-review-card--${item.type}`}>
      {/* ZONE 1 — header: avatar, name, short verb, timestamp. Stars
          never render here — see the game row below. */}
      <ReviewCardShellHeader
        avatar={
          <button type="button" className="home-review-card__avatar-btn" onClick={goToAuthor}>
            <Avatar user={item.author} size={28} />
          </button>
        }
        end={<span className="home-review-card__time">{when}</span>}
      >
        <button type="button" className="home-review-card__author-name" onClick={goToAuthor}>
          {item.isOwn ? 'You' : item.author.displayName}
        </button>
        <span className="home-review-card__verb">{headerVerb(item)}</span>
      </ReviewCardShellHeader>

      {/* ZONE 2 — game row: cover, title, stars/hours/quote. */}
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

      {/* ZONE 3 — actions row: left icon cluster, right-aligned counts. */}
      {!isLightBacklog && (
        <div className="home-review-card__actions">
          <div className="home-review-card__icons">
            <HeartButton active={heartActive} interactive={!item.isOwn} onClick={handleHeartClick} />
            <CommentButton onClick={goToReply} />
            {showBacklogAdd && <BacklogAction game={item.game} />}
          </div>
          <ActionCounts likeCount={heartCount} commentCount={item.commentCount} />
        </div>
      )}
    </ReviewCardShell>
  )
}
