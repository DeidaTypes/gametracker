import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineHeart, HiHeart, HiOutlineChat, HiOutlineFlag, HiOutlineCheck } from 'react-icons/hi'
import { Gamepad2 } from 'lucide-react'
import Avatar from '../Avatar'
import Pressable from '../Pressable'
import StarRatingDisplay from '../StarRatingDisplay'
import ListCoverCluster from '../ListCoverCluster'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useReactions } from '../../hooks/useReactions'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { likeReview, unlikeReview } from '../../services/likeService'
import { EVENT_REACTION_EMOJI } from './HomeReviewCard'
import { formatActivityDate } from '../../utils/formatActivityDate'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useListPreview } from '../../hooks/useListPreview'
import { getGameStatus } from '../../services/libraryService'
import { warmQaQuestion } from '../../pages/qa/qaCache'
import { showToast } from '../Toast'
import { hapticImpact } from '../../utils/haptics'
import './PulsePosts.css'

function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 60) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function actorLabel(item) {
  return item.isOwn ? 'You' : item.author?.displayName || 'Player'
}

function coverSrc(item, size = 26) {
  return item.game?.image ? getSizedImageUrl(item.game.image, size) : COVER_FALLBACK
}

function handleImgError(e) {
  e.target.src = COVER_FALLBACK
}

function goProfile(navigate, author) {
  if (!author) return
  if (author.username) navigate(`/user/${encodeURIComponent(author.username)}`)
  else if (author.id) navigate(`/user/id/${encodeURIComponent(author.id)}`)
}

function goGame(navigate, game, e) {
  e?.stopPropagation?.()
  if (!game) return
  navigate(`/game/${game.id}`, { state: getGameNavStub(game) })
}

function joinNames(members) {
  const names = members.map((m) => actorLabel(m))
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function PulseShell({ followsReview, compact, children }) {
  return (
    <article
      className={`pulse-post${compact ? ' pulse-post--cmp' : ''}${
        followsReview ? ' pulse-post--after-review' : ''
      }`}
    >
      {children}
    </article>
  )
}

function PulseAvatar({ user, onClick, compact }) {
  return (
    <button
      type="button"
      className={`pulse-post__avatar${compact ? ' pulse-post__avatar--cmp' : ''}`}
      onClick={onClick}
      aria-label={user?.displayName ? `View ${user.displayName}'s profile` : 'View profile'}
    >
      <Avatar user={user} size={compact ? 'xs' : 'sm'} />
    </button>
  )
}

function PulseTime({ when }) {
  return (
    <span className="pulse-post__time">
      {'\u00b7'} {when}
    </span>
  )
}

function useActivityHeart(item) {
  const { reduced } = useMotionPreference()
  const { reactions, toggle } = useReactions('activity', item.reactionTargetId)
  const reaction = reactions.find((r) => r.emoji === EVENT_REACTION_EMOJI)
  const active = reaction?.reacted || false
  const count = reaction?.count || 0
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

  return {
    active,
    count,
    heartPop,
    toggle: () => toggle(EVENT_REACTION_EMOJI),
  }
}

function useReviewHeart(item) {
  const likeState = useLikeState(item.id)
  const likeInFlightRef = useRef(false)

  const toggle = async (e) => {
    e.stopPropagation()
    if (item.isOwn || likeInFlightRef.current) return
    likeInFlightRef.current = true
    const prev = likeState
    const wasLiked = prev.liked
    if (!wasLiked) hapticImpact('Light')
    publishLikeState(item.id, {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    })
    try {
      if (wasLiked) await unlikeReview(item.id)
      else await likeReview(item.id)
    } catch (err) {
      publishLikeState(item.id, prev)
      showToast(wasLiked ? "Couldn't unreact" : "Couldn't react", 'error', null, null, null, {
        sub: err?.message || 'Try again',
      })
    } finally {
      likeInFlightRef.current = false
    }
  }

  return { active: likeState.liked, count: likeState.count || item.likeCount || 0, toggle }
}

function PulseActions({
  item,
  isReviewType,
  onComments,
  showHeart = true,
  heartReadOnly = false,
}) {
  const activity = useActivityHeart(item)
  const review = useReviewHeart(item)
  const active = isReviewType ? review.active : activity.active
  const count = isReviewType ? review.count : activity.count
  const heartPop = isReviewType ? false : activity.heartPop

  const onHeart = (e) => {
    if (heartReadOnly) return
    if (isReviewType) review.toggle(e)
    else {
      e.stopPropagation()
      activity.toggle()
    }
  }

  return (
    <div className="pulse-post__act">
      {showHeart && (
        <Pressable
          className={`pulse-post__ab${active ? ' pulse-post__ab--on' : ''}${
            heartReadOnly ? ' pulse-post__ab--readonly' : ''
          }`}
          onClick={heartReadOnly ? undefined : onHeart}
          disabled={heartReadOnly}
          aria-disabled={heartReadOnly ? true : undefined}
          aria-pressed={heartReadOnly ? undefined : active}
          aria-label={
            heartReadOnly
              ? count > 0
                ? `${count} likes`
                : 'Like'
              : active
                ? 'Remove reaction'
                : 'React'
          }
        >
          <span
            className={`pulse-post__heart${heartPop ? ' pulse-post__heart--pop' : ''}`}
            aria-hidden="true"
          >
            {active ? <HiHeart /> : <HiOutlineHeart />}
          </span>
          {count > 0 && <span className="pulse-post__ab-count text-label">{count}</span>}
        </Pressable>
      )}
      <Pressable className="pulse-post__ab" onClick={onComments} aria-label="View comments">
        <HiOutlineChat aria-hidden="true" />
        {item.commentCount > 0 && (
          <span className="pulse-post__ab-count text-label">{item.commentCount}</span>
        )}
      </Pressable>
      <span className="pulse-post__backlog-slot" aria-hidden="true" />
    </div>
  )
}

function FinishedBand({ item, onGameClick, coverPriority, showFinishedBadge = true }) {
  const src = coverSrc(item, 44)
  const coverVar = item.game?.image ? getSizedImageUrl(item.game.image, 200) : null
  return (
    <button type="button" className="pulse-post__fin" onClick={onGameClick}>
      {coverVar && (
        <span
          className="pulse-post__fin-bg"
          style={{ '--pulse-fin-cover': `url("${coverVar}")` }}
          aria-hidden="true"
        />
      )}
      <span className="pulse-post__fin-scrim" aria-hidden="true" />
      <img
        className="pulse-post__fin-cover"
        src={src}
        alt=""
        width={66}
        height={88}
        onError={handleImgError}
        {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
      />
      <span className="pulse-post__fin-text">
        {showFinishedBadge && (
          <span className="pulse-post__fin-badge">
            <HiOutlineFlag aria-hidden="true" />
            Finished
          </span>
        )}
        <span className="pulse-post__fin-title">{item.game?.title || ''}</span>
        {item.rating != null && (
          <span className="pulse-post__fin-stars">
            <StarRatingDisplay rating={item.rating} size={13} />
          </span>
        )}
      </span>
    </button>
  )
}

function FinishedPost({ item, coverPriority, followsReview, navigate }) {
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const onComments = (e) => {
    e?.stopPropagation?.()
    navigate(`/activity/${item.id}/comments`)
  }
  return (
    <PulseShell followsReview={followsReview}>
      <PulseAvatar
        user={item.author}
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">finished</span>
          <PulseTime when={when} />
        </p>
        <FinishedBand
          item={item}
          coverPriority={coverPriority}
          onGameClick={(e) => goGame(navigate, item.game, e)}
        />
        <PulseActions item={item} onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function RatedPost({ item, coverPriority, followsReview, navigate }) {
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const onComments = (e) => {
    e?.stopPropagation?.()
    navigate(`/reviews/${item.id}/comments`)
  }
  return (
    <PulseShell followsReview={followsReview}>
      <PulseAvatar
        user={item.author}
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--opinion">rated</span>
          <PulseTime when={when} />
        </p>
        <FinishedBand
          item={item}
          coverPriority={coverPriority}
          showFinishedBadge={false}
          onGameClick={(e) => goGame(navigate, item.game, e)}
        />
        <PulseActions item={item} isReviewType onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function ClusterPost({ entry, coverPriority, followsReview, navigate }) {
  const { members, item: lead } = entry
  const others = members.length - 1
  const othersLabel = others === 1 ? 'and 1 other' : `and ${others} others`
  const heartItem = lead
  const onComments = (e) => {
    e?.stopPropagation?.()
    navigate(`/activity/${lead.id}/comments`)
  }
  const stack = members.slice(0, 3)

  return (
    <PulseShell followsReview={followsReview}>
      <PulseAvatar
        user={lead.author}
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, lead.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(lead)}</b>
          <span className="pulse-post__time">{othersLabel}</span>
          <span className="pulse-post__verb pulse-post__verb--status">finished</span>
          <span className="pulse-post__time">{'\u00b7'} this week</span>
        </p>
        <button
          type="button"
          className="pulse-post__cl"
          onClick={(e) => goGame(navigate, lead.game, e)}
        >
          <img
            className="pulse-post__cl-cover"
            src={coverSrc(lead, 21)}
            alt=""
            width={42}
            height={56}
            onError={handleImgError}
            {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
          />
          <span className="pulse-post__cl-text">
            <b>{lead.game?.title || ''}</b>
            <span>{joinNames(members)}</span>
          </span>
          <span className="pulse-post__stack" aria-hidden="true">
            {stack.map((m) => (
              <span key={m.id} className="pulse-post__stack-av">
                <Avatar user={m.author} size="xs" />
              </span>
            ))}
          </span>
        </button>
        <PulseActions item={heartItem} onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function QaPost({ item, followsReview, navigate }) {
  const { questionId, title, igdbGameId, gameTitle, gameCoverImageId } = item.qa
  const isBest = item.type === 'qa_best'
  const name = item.author?.displayName || 'Player'
  const actor = isBest ? `${name}\u2019s` : name
  const verbText = isBest ? 'answer was picked as best on' : 'asked about'
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const status = igdbGameId != null ? getGameStatus(igdbGameId) : null
  let statusHint = null
  if (status === 'played') statusHint = "You've played this"
  else if (status === 'currently') statusHint = "You're playing this"

  const openQuestion = () => {
    warmQaQuestion({
      id: questionId,
      title,
      igdb_game_id: igdbGameId,
      game_title: gameTitle,
      game_cover_image_id: gameCoverImageId,
    })
    navigate(`/qa/q/${questionId}`)
  }

  return (
    <PulseShell followsReview={followsReview}>
      <PulseAvatar
        user={item.author}
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actor}</b>
          <span className="pulse-post__verb pulse-post__verb--journal">{verbText}</span>
          {!isBest && gameTitle && (
            <button
              type="button"
              className="pulse-post__game-link"
              onClick={(e) => {
                e.stopPropagation()
                if (igdbGameId != null) {
                  navigate(`/game/${igdbGameId}`, {
                    state: getGameNavStub({ id: igdbGameId, title: gameTitle, image: item.game?.image }),
                  })
                }
              }}
            >
              {gameTitle}
            </button>
          )}
          {isBest && gameTitle && <b>{gameTitle}</b>}
          <PulseTime when={when} />
        </p>
        {!isBest && (
          <div className="pulse-post__qa">
            <button type="button" className="pulse-post__qa-tap" onClick={openQuestion}>
              <p className="pulse-post__qa-q">{title}</p>
            </button>
            {statusHint && (
              <div className="pulse-post__qa-foot">
                <span className="pulse-post__qa-hint">
                  <HiOutlineCheck aria-hidden="true" />
                  {statusHint}
                </span>
                <button type="button" className="pulse-post__ans" onClick={openQuestion}>
                  Answer
                </button>
              </div>
            )}
          </div>
        )}
        {isBest && (
          <button type="button" className="pulse-post__qa pulse-post__qa--best" onClick={openQuestion}>
            <p className="pulse-post__qa-q">{title}</p>
          </button>
        )}
      </div>
    </PulseShell>
  )
}

function SessionsPost({ entry, coverPriority, followsReview, navigate }) {
  const items = entry.items
  const item = items[0]
  const count = items.length
  const totalSeconds = items.reduce((sum, it) => {
    const s = Number(it.durationSeconds)
    return Number.isFinite(s) && s > 0 ? sum + s : sum
  }, 0)
  const duration = formatDuration(totalSeconds)
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const sessionLabel =
    count === 1
      ? duration
        ? `1 session today \u00b7 ${duration}`
        : '1 session today'
      : duration
        ? `${count} sessions today \u00b7 ${duration}`
        : `${count} sessions today`

  return (
    <PulseShell followsReview={followsReview} compact>
      <PulseAvatar
        user={item.author}
        compact
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">played</span>
          <button
            type="button"
            className="pulse-post__game-link"
            onClick={(e) => goGame(navigate, item.game, e)}
          >
            {item.game?.title || ''}
          </button>
        </p>
        <p className="pulse-post__sub">
          <Gamepad2 size={13} strokeWidth={1.8} aria-hidden="true" />
          {sessionLabel}
        </p>
      </div>
      <div className="pulse-post__end">
        <button type="button" onClick={(e) => goGame(navigate, item.game, e)} aria-label={item.game?.title}>
          <img
            className="pulse-post__end-cover"
            src={coverSrc(item, 15)}
            alt=""
            width={30}
            height={40}
            onError={handleImgError}
            {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
          />
        </button>
      </div>
    </PulseShell>
  )
}

function PulseListGate({ item, coverPriority, followsReview, navigate }) {
  const preview = useListPreview(item.listId)
  const gameCount = item.listGameCount ?? preview?.gameCount ?? null
  if (gameCount === 0) return null
  return (
    <ListPost
      item={item}
      preview={preview}
      gameCount={gameCount}
      coverPriority={coverPriority}
      followsReview={followsReview}
      navigate={navigate}
    />
  )
}

function ListPost({ item, preview, gameCount, coverPriority, followsReview, navigate }) {
  const listName = item.listName || preview?.name || null
  const games = preview?.previewGames || []

  const when = formatActivityDate(item.createdAt, { pulse: true })
  const onComments = (e) => {
    e?.stopPropagation?.()
    navigate(`/activity/${item.id}/comments`)
  }

  return (
    <PulseShell followsReview={followsReview}>
      <PulseAvatar
        user={item.author}
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--journal">made a list</span>
          <PulseTime when={when} />
        </p>
        <button
          type="button"
          className="pulse-post__ls"
          onClick={(e) => {
            e.stopPropagation()
            if (item.listId) navigate(`/list/${item.listId}`)
          }}
        >
          <span className="pulse-post__fan">
            <ListCoverCluster games={games} name={listName || ''} size="md" variant="tile" />
          </span>
          <span className="pulse-post__ls-meta">
            <span className="pulse-post__ls-name">{listName || 'Untitled list'}</span>
            {gameCount != null && (
              <span className="pulse-post__ls-count">
                {gameCount} game{gameCount === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </button>
        <PulseActions item={item} onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function StartedPost({ item, coverPriority, followsReview, navigate }) {
  const when = formatActivityDate(item.createdAt, { pulse: true })
  return (
    <PulseShell followsReview={followsReview} compact>
      <PulseAvatar
        user={item.author}
        compact
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">started</span>
          <button
            type="button"
            className="pulse-post__game-link"
            onClick={(e) => goGame(navigate, item.game, e)}
          >
            {item.game?.title || ''}
          </button>
        </p>
        <p className="pulse-post__sub">{when}</p>
        <span className="pulse-post__backlog-slot pulse-post__backlog-slot--inline" aria-hidden="true" />
      </div>
      <div className="pulse-post__end">
        <button type="button" onClick={(e) => goGame(navigate, item.game, e)} aria-label={item.game?.title}>
          <img
            className="pulse-post__end-cover"
            src={coverSrc(item, 15)}
            alt=""
            width={30}
            height={40}
            onError={handleImgError}
            {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
          />
        </button>
      </div>
    </PulseShell>
  )
}

function OwnPost({ item, coverPriority, followsReview, navigate }) {
  const activity = useActivityHeart(item)
  return (
    <PulseShell followsReview={followsReview} compact>
      <PulseAvatar
        user={item.author}
        compact
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>You</b>
          <span className="pulse-post__verb pulse-post__verb--status">finished</span>
          <button
            type="button"
            className="pulse-post__game-link"
            onClick={(e) => goGame(navigate, item.game, e)}
          >
            {item.game?.title || ''}
          </button>
        </p>
        <p className="pulse-post__sub pulse-post__sub--own">
          {activity.count > 0 && (
            <>
              <HiOutlineHeart aria-hidden="true" />
              <span>{activity.count}</span>
            </>
          )}
        </p>
      </div>
      <div className="pulse-post__end">
        <button type="button" onClick={(e) => goGame(navigate, item.game, e)} aria-label={item.game?.title}>
          <img
            className="pulse-post__end-cover"
            src={coverSrc(item, 15)}
            alt=""
            width={30}
            height={40}
            onError={handleImgError}
            {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
          />
        </button>
      </div>
    </PulseShell>
  )
}

function CompactPost({ item, coverPriority, followsReview, navigate }) {
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const onComments = (e) => {
    e?.stopPropagation?.()
    if (item.type === 'listed' && item.listId) navigate(`/list/${item.listId}`)
    else navigate(`/activity/${item.id}/comments`)
  }
  const verb =
    item.type === 'listed'
      ? item.listKind === 'created'
        ? 'made a list'
        : 'added to a list'
      : item.type === 'played'
        ? 'played'
        : item.type === 'backlogged'
          ? 'wants to play'
          : item.type || 'updated'

  return (
    <PulseShell followsReview={followsReview} compact>
      <PulseAvatar
        user={item.author}
        compact
        onClick={(e) => {
          e.stopPropagation()
          goProfile(navigate, item.author)
        }}
      />
      <div className="pulse-post__body">
        <p className="pulse-post__head">
          <b>{actorLabel(item)}</b>
          <span
            className={`pulse-post__verb ${
              item.type === 'listed' ? 'pulse-post__verb--journal' : 'pulse-post__verb--status'
            }`}
          >
            {verb}
          </span>
          {item.game?.title && (
            <button
              type="button"
              className="pulse-post__game-link"
              onClick={(e) => goGame(navigate, item.game, e)}
            >
              {item.game.title}
            </button>
          )}
        </p>
        <p className="pulse-post__sub">{when}</p>
      </div>
      {item.game && (
        <div className="pulse-post__end">
          <button type="button" onClick={(e) => goGame(navigate, item.game, e)} aria-label={item.game.title}>
            <img
              className="pulse-post__end-cover"
              src={coverSrc(item, 15)}
              alt=""
              width={30}
              height={40}
              onError={handleImgError}
              {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
            />
          </button>
        </div>
      )}
    </PulseShell>
  )
}

/**
 * PulsePost — one shaped pulse entry from shapePulseFeedEntries.
 */
export default function PulsePost({ entry, coverPriority, followsReview = false }) {
  const navigate = useNavigate()
  switch (entry.kind) {
    case 'finished':
      return (
        <FinishedPost
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'rated':
      return (
        <RatedPost
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'cluster':
      return (
        <ClusterPost
          entry={entry}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'qa':
      return <QaPost item={entry.item} followsReview={followsReview} navigate={navigate} />
    case 'sessions':
      return (
        <SessionsPost
          entry={entry}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'list':
      return (
        <PulseListGate
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'started':
      return (
        <StartedPost
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'own':
      return (
        <OwnPost
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    case 'compact':
      return (
        <CompactPost
          item={entry.item}
          coverPriority={coverPriority}
          followsReview={followsReview}
          navigate={navigate}
        />
      )
    default:
      return null
  }
}
