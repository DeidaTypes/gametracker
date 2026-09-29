import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineHeart, HiHeart, HiOutlineChat, HiChevronDown } from 'react-icons/hi'
import Avatar from '../Avatar'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useReactions } from '../../hooks/useReactions'
import { EVENT_REACTION_EMOJI } from './HomeReviewCard'
import { formatActivityDate } from '../../utils/formatActivityDate'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import './FeedRow.css'

// Fixed vocabulary for the two verb categories V4-01 defines for COMPACT
// rows. Deliberately narrower/plainer than HomeReviewCard's own
// bylineVerb() (which is FULL-card-specific and per-status-colored) —
// this table exists so every COMPACT type maps to exactly one of the
// two category colors below, not a fifth shade per type.
const STATUS_VERB = {
  started: 'started',
  backlogged: 'wants to play',
  finished: 'finished',
  dropped: 'dropped',
  played: 'logged a session for',
  favorited: 'favorited',
  journaled: 'journaled about',
}

const REVIEW_TYPES = new Set(['reviewed', 'rated'])

/** @returns {{ text: string, category: 'status'|'curation' }} */
function verbFor(item) {
  if (item.type === 'listed') {
    return item.listKind === 'created'
      ? { text: 'created list', category: 'curation' }
      : { text: 'added to list', category: 'curation' }
  }
  return { text: STATUS_VERB[item.type] || 'updated', category: 'status' }
}

/**
 * Object portion of "{actor} {verb} {object}". A game title for every
 * ordinary event; for a list event, "{n} games to {list name}" per the
 * V4-01 spec, with the list name its own (purple) span — `listGameCount`
 * is the destination list's total size, the only count communityService
 * attaches to a 'listed' item today (see getHomeFeed's doc comment), so
 * a single ungrouped list-add reads "1 game to {list}" rather than
 * fabricating a per-event add count.
 *
 * The game title is a real <button> (same pattern as HomeReviewCard's
 * `.home-review-card__game-title`) so it can navigate to Game Detail
 * without living inside the row's comments tap target.
 */
function ObjectSpan({ item, onGameClick }) {
  if (item.type === 'listed') {
    if (item.listKind === 'created') {
      return <span className="feed-row__object feed-row__object--purple">{item.listName || 'a list'}</span>
    }
    const n = item.listGameCount != null ? item.listGameCount : 1
    return (
      <>
        {n} game{n === 1 ? '' : 's'} to{' '}
        <span className="feed-row__object feed-row__object--purple">{item.listName || 'a list'}</span>
      </>
    )
  }
  const title = item.game?.title || ''
  if (!title) return null
  if (!onGameClick) {
    return <span className="feed-row__object">{title}</span>
  }
  return (
    <button
      type="button"
      className="feed-row__object feed-row__object-btn"
      onClick={onGameClick}
      aria-label={`View ${title}`}
    >
      {title}
    </button>
  )
}

/** Plain-text twin of <ObjectSpan/>, for the row's aria-label. */
function objectText(item) {
  if (item.type === 'listed') {
    if (item.listKind === 'created') return item.listName || 'a list'
    const n = item.listGameCount != null ? item.listGameCount : 1
    return `${n} game${n === 1 ? '' : 's'} to ${item.listName || 'a list'}`
  }
  return item.game?.title || ''
}

function coverSrc(item) {
  return item.game?.image ? getSizedImageUrl(item.game.image, 26) : COVER_FALLBACK
}

function handleImgError(e) {
  e.target.src = COVER_FALLBACK
}

function RowCover({ item }) {
  if (!item.game) return null
  return (
    <img
      className="feed-row__cover"
      src={coverSrc(item)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={handleImgError}
    />
  )
}

/** Two-cover stack for grouped summary rows — oldest behind, next in front. */
function CoverStack({ items }) {
  const withGame = items.filter((it) => it.game)
  if (withGame.length === 0) return null

  const back = withGame[withGame.length - 1]
  const front = withGame.length > 1 ? withGame[withGame.length - 2] : back

  return (
    <span className="feed-row__cover-stack" aria-hidden="true">
      <img className="feed-row__cover-stack-img feed-row__cover-stack-img--back" src={coverSrc(back)} alt="" loading="lazy" decoding="async" onError={handleImgError} />
      <img className="feed-row__cover-stack-img feed-row__cover-stack-img--front" src={coverSrc(front)} alt="" loading="lazy" decoding="async" onError={handleImgError} />
    </span>
  )
}

function RowMeta({ when, commentCount }) {
  return (
    <span className="feed-row__line2">
      <span className="feed-row__when">{when}</span>
      {commentCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="feed-row__comments-meta" aria-hidden="true">
            <HiOutlineChat />
            <span>{commentCount}</span>
          </span>
        </>
      )}
    </span>
  )
}

function RowText({ actorLabel, verbText, category, objectNode, when, commentCount, subline }) {
  return (
    <span className="feed-row__text">
      <span className="feed-row__line1">
        <span className="feed-row__actor">{actorLabel}</span>{' '}
        <span className={`feed-row__verb feed-row__verb--${category}`}>{verbText}</span>{' '}
        {objectNode}
      </span>
      {subline != null ? (
        <span className="feed-row__line2">{subline}</span>
      ) : (
        when != null && <RowMeta when={when} commentCount={commentCount ?? 0} />
      )}
    </span>
  )
}

function RowTrailing({ children }) {
  return <span className="feed-row__trailing">{children}</span>
}

/**
 * FeedRow — "The pulse"'s COMPACT row for every non-opinion-bearing
 * event (see communityService.pulseItemHasOpinion). One anatomy for
 * every row: avatar → text → cover → trailing.
 *
 * Tap targets are three siblings, never nested (iOS WKWebView activates
 * a role="button" ancestor before a non-button descendant's onClick):
 *   1. Game name <button> → Game Detail
 *   2. Heart <Pressable>/<button> → reaction toggle
 *   3. Overlay <button> covering everything else → comment thread
 *      (listed rows keep navigating to `/list/:id`)
 */
export default function FeedRow({ item, indented = false }) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const { reactions, toggle } = useReactions('activity', item.reactionTargetId)
  const reaction = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const active = reaction?.reacted || false
  const likeCount = reaction?.count || 0
  const [heartPop, setHeartPop] = useState(false)
  const prevActiveRef = useRef(active)

  useEffect(() => {
    if (active && !prevActiveRef.current && !item.isOwn && !reduced) {
      setHeartPop(true)
      const t = window.setTimeout(() => setHeartPop(false), 180)
      prevActiveRef.current = active
      return () => window.clearTimeout(t)
    }
    prevActiveRef.current = active
  }, [active, item.isOwn, reduced])

  const { text: verbText, category } = verbFor(item)
  const actorLabel = item.isOwn ? 'You' : item.author?.displayName || 'Player'
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const ariaLabel = `${actorLabel} ${verbText} ${objectText(item)}`.trim()
  const isListed = item.type === 'listed'
  const isReviewType = REVIEW_TYPES.has(item.type)

  // Same destinations HomeReviewCard.goToReply already uses — do not
  // invent a third comments route.
  const goToComments = (e) => {
    e?.stopPropagation?.()
    if (isReviewType) navigate(`/reviews/${item.id}/comments`)
    else navigate(`/activity/${item.id}/comments`)
  }

  const goToList = (e) => {
    e?.stopPropagation?.()
    if (item.listId) navigate(`/list/${item.listId}`)
  }

  // Same navigation HomeReviewCard.goToGame / the previous goToRow used
  // for the game name only.
  const goToGame = (e) => {
    e?.stopPropagation?.()
    if (!item.game) return
    navigate(`/game/${item.game.id}`, { state: getGameNavStub(item.game) })
  }

  const handleHeartClick = (e) => {
    e.stopPropagation()
    toggle(EVENT_REACTION_EMOJI)
  }

  // Own posts: self-reactions are disallowed (same rule as
  // HomeReviewCard). The heart is still a real sibling <button> with a
  // 44px hit area so the tap is swallowed here — a handler-less control
  // (or a 13px span) lets iOS activate the row overlay instead.
  const rowAction = isListed ? goToList : goToComments
  const rowAria = isListed
    ? ariaLabel
    : `View comments on ${ariaLabel}`

  return (
    <div className={`feed-row${indented ? ' feed-row--indented' : ''}`}>
      {/* Comments / list target — sibling of the heart, NOT its parent.
          Absolutely positioned so avatar / actor / verb / timestamp /
          cover / empty space all land on this button via pointer-events
          pass-through on .feed-row__content. */}
      <button
        type="button"
        className="feed-row__tap"
        aria-label={rowAria}
        onClick={rowAction}
      />

      <div className="feed-row__content">
        {!indented && (
          <span className="feed-row__avatar" aria-hidden="true">
            <Avatar user={item.author} size="xs" />
          </span>
        )}

        <RowText
          actorLabel={actorLabel}
          verbText={verbText}
          category={category}
          objectNode={
            <ObjectSpan
              item={item}
              onGameClick={isListed ? undefined : goToGame}
            />
          }
          when={when}
          commentCount={item.commentCount}
        />

        <RowCover item={item} />
      </div>

      <Pressable
        className={`feed-row__heart-btn${active ? ' feed-row__heart-btn--active' : ''}${
          item.isOwn ? ' feed-row__heart-btn--own' : ''
        }`}
        onClick={item.isOwn ? undefined : handleHeartClick}
        disabled={item.isOwn}
        aria-disabled={item.isOwn ? true : undefined}
        aria-pressed={item.isOwn ? undefined : active}
        aria-label={
          item.isOwn
            ? likeCount > 0
              ? `${likeCount} likes`
              : 'Like'
            : active
              ? 'Remove reaction'
              : 'React'
        }
      >
        <span
          className={`feed-row__heart${heartPop ? ' feed-row__heart--pop' : ''}`}
          aria-hidden="true"
        >
          {active ? <HiHeart /> : <HiOutlineHeart />}
        </span>
        {likeCount > 0 && (
          <span className="feed-row__heart-count text-label">{likeCount}</span>
        )}
      </Pressable>
    </div>
  )
}

/**
 * FeedGroupRow — collapsed summary for 2+ consecutive COMPACT events
 * sharing actor + verb within 24h. Same anatomy as FeedRow (avatar →
 * text → cover stack → chevron); hearts live on expanded child rows.
 */
export function FeedGroupRow({ items }) {
  const [open, setOpen] = useState(false)
  const { reduced } = useMotionPreference()

  const newest = items[0]
  const { text: verbText, category } = verbFor(newest)
  const actorLabel = newest.isOwn ? 'You' : newest.author?.displayName || 'Player'
  const when = formatActivityDate(newest.createdAt, { pulse: true })
  const gameCount = items.length

  const titles = items.map((it) => it.game?.title || it.listName || 'a list')
  const joined =
    titles.length === 2
      ? `${titles[0]} and ${titles[1]}`
      : titles.length === 3
        ? `${titles[0]}, ${titles[1]}, and ${titles[2]}`
        : `${titles[0]}, ${titles[1]}, and ${titles.length - 2} more`

  const ariaLabel = `${actorLabel} ${verbText} ${joined}`
  const subline = `${when} · ${gameCount} game${gameCount === 1 ? '' : 's'}`

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen((o) => !o)
    }
  }

  return (
    <div className={`feed-group-row${open ? ' feed-group-row--open' : ''}`}>
      <div
        className="feed-row feed-group-row__summary"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${ariaLabel}. Double tap to ${open ? 'collapse' : 'expand'}.`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="feed-row__avatar" aria-hidden="true">
          <Avatar user={newest.author} size="xs" />
        </span>

        <RowText
          actorLabel={actorLabel}
          verbText={verbText}
          category={category}
          objectNode={<span className="feed-row__object">{joined}</span>}
          subline={subline}
        />

        <CoverStack items={items} />

        <RowTrailing>
          <HiChevronDown
            className={`feed-group-row__chevron${open ? ' feed-group-row__chevron--open' : ''}`}
            aria-hidden="true"
          />
        </RowTrailing>
      </div>

      <div
        className={`feed-group-row__children${open ? ' feed-group-row__children--open' : ''}`}
        style={reduced ? { transitionDuration: '0ms' } : undefined}
      >
        <div className="feed-group-row__children-inner">
          {items.map((it) => (
            <FeedRow key={it.id} item={it} indented />
          ))}
        </div>
      </div>
    </div>
  )
}
