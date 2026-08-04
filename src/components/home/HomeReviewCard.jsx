import React, { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineHeart, HiHeart, HiOutlineChat, HiCheck } from 'react-icons/hi'
import { List as ListIcon } from 'lucide-react'
import Avatar from '../Avatar'
import StarRatingDisplay from '../StarRatingDisplay'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { useReactions } from '../../hooks/useReactions'
import { useListPreview } from '../../hooks/useListPreview'
import { likeReview, unlikeReview } from '../../services/likeService'
import { showToast } from '../Toast'
import { ReviewCardShell } from '../reviews/ReviewCardShell'
import StatusChip from '../StatusChip'
import { shouldShowCount } from '../../utils/formatSocialCount'
import { formatActivityDate } from '../../utils/formatActivityDate'
import { hapticImpact } from '../../utils/haptics'
import './HomeReviewCard.css'

// Fixed single emoji so the generic cross-surface reactions table
// (target_type: 'activity' — see supabase/reactions.sql) renders as a
// plain heart control, visually matching the review react button
// (which is backed by review_likes, a different table, for 'reviewed'/
// 'rated' items).
const EVENT_REACTION_EMOJI = '\u2764\uFE0F'

const REVIEW_TYPES = new Set(['reviewed', 'rated'])

// Covers shown in the list-add mosaic. getListById returns up to 6
// previewGames, so this never has to pad the row with placeholders.
const LIST_MOSAIC_MAX = 5

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
 * BYLINE verb — deliberately short, fixed vocabulary, and never carries
 * the game/list title or a star rating (those lead the card, in the game
 * zone above). Identical for own vs. others' cards — only the subject
 * differs ("You" vs. the author's name, handled by the caller).
 */
function bylineVerb(item) {
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
 * Status-pill label for the types whose whole content IS their status —
 * finished / backlogged / started / played / favorited / journaled. The
 * pill replaces the old secondary text line, and folds in the playtime a
 * bare "Finished" would otherwise drop. Returns null for the types that
 * lead with a rating, a review body, or a list instead.
 */
function statusPillLabel(item) {
  switch (item.type) {
    case 'backlogged':
      return 'Backlogged'
    case 'finished': {
      const d = formatDuration(item.durationSeconds)
      return d ? `Finished \u00b7 ${d}` : 'Finished'
    }
    case 'started':
      return 'Started playing'
    case 'played': {
      const d = formatDuration(item.durationSeconds)
      return d ? `Played \u00b7 ${d}` : 'Session logged'
    }
    case 'favorited':
      return 'Favorite'
    case 'journaled':
      return 'Journal entry'
    default:
      return null
  }
}

/**
 * Of the six event types statusPillLabel covers, only these three are
 * actual tracker statuses (Want to Play / Currently Playing / Played) —
 * the other three (session logged, favorited, journaled) are distinct
 * activity types with no corresponding tracker status, so they keep the
 * plain cobalt pill instead of routing through StatusChip's status map.
 */
const TRACKER_STATUS_BY_TYPE = {
  backlogged: 'want',
  started: 'currently',
  finished: 'played',
}

/**
 * ExpandableBody — the review text, full width and free to grow. Clamped
 * at CLAMP_LINES with an inline "more" that expands the card in place;
 * short reviews render short (the clamp only ever removes height it would
 * otherwise have taken, so nothing reserves empty space). "more" only
 * renders once the text actually overflows the clamp, measured after
 * layout rather than guessed from character count — a 6-line clamp at a
 * fluid width can't be predicted from the string.
 */
function ExpandableBody({ text }) {
  const ref = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    if (expanded) {
      setOverflows(false)
      return
    }
    const el = ref.current
    if (!el) return
    setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  return (
    <div className="home-review-card__body">
      <p
        ref={ref}
        className={
          expanded
            ? 'home-review-card__body-text'
            : 'home-review-card__body-text home-review-card__body-text--clamped'
        }
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          className="home-review-card__more"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(true)
          }}
        >
          more
        </button>
      )}
    </div>
  )
}

/**
 * ActionRow — like + comment, and nothing else. Each count renders
 * beside its own icon rather than as a separate right-aligned cluster,
 * and goes through `shouldShowCount` — the app-wide zero-state rule, so
 * nothing here ever reads "0 likes" / "1 comment".
 *
 * The heart is a real toggle on other people's cards and a plain,
 * non-focusable <span> on the viewer's own (nothing to press, so nothing
 * pretends to be pressable) — own cards still show accurate fill state
 * and engagement from others, just no self-likes.
 */
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
 * GameZone — the card's lead. Cover + game title (the most prominent
 * text on the card) + whichever content zone the event type calls for,
 * stacked directly beneath the title:
 *
 *   rated (no body)  — large stars + the numeric score
 *   reviewed         — small stars (the body carries the weight below)
 *   listed / added   — the destination-list pill
 *   status events    — a status pill (Finished · 4h, Backlogged, …)
 *   listed / created — a cover mosaic in place of the game cover, with
 *                      the list name as the title (no specific game)
 *
 * Deliberately flat: no background, border, or radius of its own, so
 * the card keeps exactly one surface.
 */
function GameZone({
  item,
  img,
  ratingOnly,
  listName,
  listGameCount,
  listCovers,
  onGameClick,
  onListClick,
}) {
  const handleImgError = (e) => {
    e.target.src = COVER_FALLBACK
  }

  if (item.type === 'listed' && item.listKind === 'created') {
    const covers = (listCovers || []).slice(0, 4)
    return (
      <Pressable
        as="div"
        className="home-review-card__game"
        onClick={onListClick}
        aria-label={`View ${listName || 'list'}`}
      >
        <span className="home-review-card__cover home-review-card__cover--mosaic" aria-hidden="true">
          {covers.length > 0 ? (
            covers.map((src, i) => <img key={i} src={getSizedImageUrl(src, 62)} alt="" loading="lazy" />)
          ) : (
            <ListIcon size={18} />
          )}
        </span>
        <span className="home-review-card__game-meta">
          <span className="home-review-card__game-title">{listName || 'a list'}</span>
          {listGameCount != null && (
            <span className="home-review-card__pill home-review-card__pill--list">
              <ListIcon size={12} aria-hidden="true" />
              {listGameCount} game{listGameCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </Pressable>
    )
  }

  if (!item.game) return null

  const showRating = REVIEW_TYPES.has(item.type) && item.rating != null
  // The stored rating is 0.5–5.0; the same value on the 10-point scale is
  // exactly rating × 2 — a rescale of real data, not a second metric.
  const score = showRating ? Math.round(Number(item.rating) * 20) / 10 : null
  const statusLabel = statusPillLabel(item)
  const trackerStatus = TRACKER_STATUS_BY_TYPE[item.type]
  const isListAdd = item.type === 'listed' && item.listKind !== 'created'

  return (
    <Pressable
      as="div"
      className="home-review-card__game"
      onClick={onGameClick}
      aria-label={`View ${item.game.title}`}
    >
      <img
        src={img}
        className="home-review-card__cover"
        alt=""
        loading="lazy"
        onError={handleImgError}
      />
      <span className="home-review-card__game-meta">
        <span className="home-review-card__game-title">{item.game.title}</span>

        {showRating && (
          <span className="home-review-card__rating">
            <StarRatingDisplay rating={item.rating} size={ratingOnly ? 'md' : 'xs'} />
            {ratingOnly && <span className="home-review-card__score">{score} / 10</span>}
          </span>
        )}

        {isListAdd && listName && (
          <span className="home-review-card__pill home-review-card__pill--list">
            <ListIcon size={12} aria-hidden="true" />
            {listName}
            {listGameCount != null && ` \u00b7 ${listGameCount} games`}
          </span>
        )}

        {statusLabel && trackerStatus && (
          <StatusChip
            variant="pill"
            status={trackerStatus}
            label={statusLabel}
            icon={item.type === 'backlogged' || item.type === 'finished' ? (
              <HiCheck aria-hidden="true" />
            ) : null}
          />
        )}

        {statusLabel && !trackerStatus && (
          <span className="home-review-card__pill home-review-card__pill--status">
            {statusLabel}
          </span>
        )}
      </span>
    </Pressable>
  )
}

/**
 * HomeReviewCard — "The pulse"'s per-item card. Renders every unified
 * activity type communityService.getHomeFeed returns — 'reviewed' /
 * 'rated' (from `reviews`) plus 'started' / 'finished' / 'listed' /
 * 'played' / 'backlogged' / 'favorited' (from `activity_events`, for
 * both the viewer and everyone else — see getHomeFeed's doc comment) —
 * through the same content-forward, top-to-bottom shape:
 *
 *   A. GAME ZONE — cover + game title (the largest text on the card) +
 *      the type's content zone (large stars + score, list pill, status
 *      pill). Flat, no inner surface. See <GameZone/>.
 *   B. BODY — the review text at full card width, its own line height,
 *      free to grow. Clamped only at 6 lines with an inline "more" that
 *      expands in place. Absent entirely for types with no text, so a
 *      bare rating is a genuinely short card. See <ExpandableBody/>.
 *   C. BYLINE — small avatar (22px) + username in muted caption weight
 *      + the type-colored verb + a compact timestamp. Deliberately
 *      secondary metadata: it must never compete with the game title.
 *   D. ACTIONS — like + comment only. See <ActionRow/>.
 *
 * Card height follows content: nothing is fixed-height and nothing
 * reserves space for a zone the event doesn't have.
 *
 * Every type renders inside the identical <ReviewCardShell/> — one
 * surface, one hairline border, one radius/padding — with a 3px left
 * accent bar colored by event type (green = review/rating, purple =
 * list-add, cobalt = every other status event). The shell's shared
 * `--section-gap` is tightened with scoped `.home-review-card`-only
 * overrides in HomeReviewCard.css rather than being changed globally,
 * since that token is also used by other, out-of-scope surfaces
 * (GameDetail, Profile, RecentActivityCard, etc.).
 *
 * Likes: 'reviewed'/'rated' use `review_likes` (via useLikeState); every
 * other type uses the generic cross-surface `reactions` table (via
 * useReactions, target_type: 'activity') — both feed the same heart.
 * Comments: `review_comments` is polymorphic (review_id OR
 * activity_event_id, exactly one set — see commentService.js) so every
 * type gets a real, counted comment affordance routed to the matching
 * thread page (see goToReply).
 *
 * Own cards (`item.isOwn`): "You" replaces the author name in the
 * byline, and the heart becomes read-only (no self-reactions, but
 * engagement from others is still visible via its count). The comment
 * affordance is untouched by `isOwn`.
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
  // Guards the review_likes path against a double-tap firing a second
  // like/unlike write before the first resolves. The activity-reactions
  // path (eventReactions.toggle) is guarded inside useReactions itself.
  const likeInFlightRef = useRef(false)

  const listPreview = useListPreview(item.type === 'listed' ? item.listId : null)
  const listName = item.listName || listPreview?.name || null
  const listGameCount = item.listGameCount ?? listPreview?.gameCount ?? null
  const listCovers =
    item.listPreviewCovers ||
    (listPreview?.previewGames || []).map((g) => g.image).filter(Boolean)

  const when = formatActivityDate(item.createdAt, { compactAbsolute: true })
  const body = (item.body || '').trim()
  // A rating with no review text is the compact card — its cover grows and
  // its stars render large, since the rating IS the whole content.
  const ratingOnly = isReviewType && !body && item.rating != null
  // 44x60 (or 56x76 when rating-only) cover — sized down from the full
  // t_cover_big the game data carries, not requested at that size.
  const img = item.game?.image
    ? getSizedImageUrl(item.game.image, ratingOnly ? 76 : 60)
    : COVER_FALLBACK
  const displayedLikeCount = likeState.count || item.likeCount || 0

  const eventReaction = eventReactions.reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const eventReacted = eventReaction?.reacted || false
  const eventCount = eventReaction?.count || 0

  const heartCount = isReviewType ? displayedLikeCount : eventCount
  const heartActive = isReviewType ? likeState.liked : !item.isOwn && eventReacted

  // The list-add mosaic — the destination list's other covers, so the
  // card shows what the game was added *to*. Omitted when the preview
  // read returned nothing rather than padded with placeholders.
  const isListAdd = item.type === 'listed' && item.listKind !== 'created'
  const mosaicCovers = isListAdd ? (listCovers || []).slice(0, LIST_MOSAIC_MAX) : []

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
    if (likeInFlightRef.current) return
    likeInFlightRef.current = true

    const prev = likeState
    const wasLiked = prev.liked
    hapticImpact('Light')
    publishLikeState(item.id, {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    })
    try {
      if (wasLiked) await unlikeReview(item.id)
      else await likeReview(item.id)
    } catch (err) {
      publishLikeState(item.id, prev)
      showToast(
        err?.message ||
          (wasLiked ? "Couldn't unreact — please try again." : "Couldn't react — please try again."),
        'error'
      )
    } finally {
      likeInFlightRef.current = false
    }
  }

  const handleHeartClick = (e) => {
    if (isReviewType) handleReviewReact(e)
    else {
      e.stopPropagation()
      eventReactions.toggle(EVENT_REACTION_EMOJI)
    }
  }

  return (
    <ReviewCardShell
      className={`home-review-card home-review-card--${item.type}${
        ratingOnly ? ' home-review-card--rating-only' : ''
      }`}
    >
      {/* A — GAME ZONE: cover + title + the type's content zone. */}
      <GameZone
        item={item}
        img={img}
        ratingOnly={ratingOnly}
        listName={listName}
        listGameCount={listGameCount}
        listCovers={listCovers}
        onGameClick={goToGame}
        onListClick={goToList}
      />

      {mosaicCovers.length > 0 && (
        <Pressable
          as="div"
          className="home-review-card__mosaic"
          onClick={goToList}
          aria-label={`View ${listName || 'list'}`}
        >
          {mosaicCovers.map((src, i) => (
            <img key={i} src={getSizedImageUrl(src, 60)} alt="" loading="lazy" />
          ))}
        </Pressable>
      )}

      {/* B — BODY: full width, expands to fit, clamps at 6 lines. */}
      {body && <ExpandableBody text={body} />}

      {/* C — BYLINE: demoted author metadata, never the headline. */}
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
          {item.isOwn ? 'You' : item.author.displayName}
        </button>
        <span className="home-review-card__verb">{bylineVerb(item)}</span>
        <span className="home-review-card__dot" aria-hidden="true">
          {'\u00b7'}
        </span>
        <span className="home-review-card__time">{when}</span>
      </div>

      {/* D — ACTIONS: like + comment only. */}
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
