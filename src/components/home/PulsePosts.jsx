import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiOutlineFlag, HiOutlineCheck } from 'react-icons/hi'
import { Gamepad2, Layers, Play } from 'lucide-react'
import Avatar from '../Avatar'
import StarRatingDisplay from '../StarRatingDisplay'
import ListCoverCluster from '../ListCoverCluster'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { getSizedImageUrl } from '../../services/imageUtils'
import { useReactions } from '../../hooks/useReactions'
import { useLikeState, publishLikeState } from '../../hooks/useLikeState'
import { likeReview, unlikeReview } from '../../services/likeService'
import { ActionRow, EVENT_REACTION_EMOJI } from './HomeReviewCard'
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

function formatDurationWords(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 60) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

function sessionMomentDetail(items, totalSeconds) {
  const count = items.length
  const today = isLocalToday(items[0].createdAt)
  const durationWords = formatDurationWords(totalSeconds)
  const sessionPart = count === 1 ? '1 session' : `${count} sessions`
  if (!durationWords) {
    if (today && count === 1) return '1 session today'
    if (today) return `${count} sessions today`
    return sessionPart
  }
  const durationPart = today ? `${durationWords} today` : durationWords
  return `${durationPart} \u00b7 ${sessionPart}`
}

function compactMomentDetail(item) {
  if (item.type === 'backlogged') return 'Added to Backlog'
  if (item.type === 'listed' && item.listKind === 'added') {
    return item.listName ? `Added to ${item.listName}` : 'Added to a list'
  }
  if (item.type === 'played') {
    const words = formatDurationWords(item.durationSeconds)
    if (words) return words
  }
  return null
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

function goUserActivity(navigate, author) {
  if (!author) return
  if (author.username) navigate(`/user/${encodeURIComponent(author.username)}/activity`)
  else if (author.id) navigate(`/user/id/${encodeURIComponent(author.id)}/activity`)
}

function isLocalToday(iso) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function startedRunTitleLine(items) {
  const titles = items.map((it) => it.game?.title).filter(Boolean)
  if (titles.length === 0) return ''
  if (titles.length === 1) return titles[0]
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`
  const more = titles.length - 2
  return `${titles[0]}, ${titles[1]} and ${more} more`
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

function PulseShell({ followsReview, children }) {
  return (
    <article className={`pulse-post${followsReview ? ' pulse-post--after-review' : ''}`}>
      {children}
    </article>
  )
}

function PulseAvatar({ user, onClick }) {
  return (
    <button
      type="button"
      className="pulse-post__avatar"
      onClick={onClick}
      aria-label={user?.displayName ? `View ${user.displayName}'s profile` : 'View profile'}
    >
      <Avatar user={user} size="sm" />
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
  showBacklog = false,
}) {
  const activity = useActivityHeart(item)
  const review = useReviewHeart(item)
  const active = isReviewType ? review.active : activity.active
  const count = isReviewType ? review.count : activity.count

  const onHeart = (e) => {
    if (heartReadOnly) return
    if (isReviewType) review.toggle(e)
    else {
      e.stopPropagation()
      activity.toggle()
    }
  }

  if (!showHeart) return null

  return (
    <ActionRow
      bare
      likeActive={active}
      likeInteractive={!heartReadOnly}
      likeCount={count}
      commentCount={item.commentCount ?? 0}
      onLike={onHeart}
      onComment={onComments}
      backlogGame={showBacklog ? item.game : null}
    />
  )
}

function MomentCard({ game, title, icon: Icon, detail, onClick, coverPriority }) {
  const displayTitle = title || game?.title || ''
  const src = game?.image ? getSizedImageUrl(game.image, 36) : COVER_FALLBACK
  const coverVar = game?.image ? getSizedImageUrl(game.image, 200) : null
  const hasCover = Boolean(game?.image)
  const cardClass = hasCover ? 'pulse-post__mom' : 'pulse-post__mom pulse-post__mom--nocover'

  return (
    <button type="button" className={cardClass} onClick={onClick}>
      {coverVar && (
        <span
          className="pulse-post__mom-bg"
          style={{ '--pulse-mom-cover': `url("${coverVar}")` }}
          aria-hidden="true"
        />
      )}
      {hasCover && <span className="pulse-post__mom-scrim" aria-hidden="true" />}
      {game && (
        <img
          className="pulse-post__mom-cover"
          src={src}
          alt=""
          width={36}
          height={48}
          onError={handleImgError}
          {...(coverPriority || { loading: 'lazy', decoding: 'async' })}
        />
      )}
      <span className="pulse-post__mom-text">
        <span className="pulse-post__mom-title">{displayTitle}</span>
        {detail && (
          <span className="pulse-post__mom-detail">
            {Icon && <Icon size={13} strokeWidth={1.8} aria-hidden="true" />}
            {detail}
          </span>
        )}
      </span>
    </button>
  )
}

function FinishedBand({ item, onGameClick, coverPriority, showFinishedBadge = true }) {
  const src = coverSrc(item, 44)
  const coverVar = item.game?.image ? getSizedImageUrl(item.game.image, 200) : null
  const finClass = item.game?.image ? 'pulse-post__fin' : 'pulse-post__fin pulse-post__fin--nocover'
  return (
    <button type="button" className={finClass} onClick={onGameClick}>
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
        <PulseActions item={item} onComments={onComments} showBacklog />
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
        <PulseActions item={heartItem} onComments={onComments} showBacklog />
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
  const totalSeconds = items.reduce((sum, it) => {
    const s = Number(it.durationSeconds)
    return Number.isFinite(s) && s > 0 ? sum + s : sum
  }, 0)
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const detail = sessionMomentDetail(items, totalSeconds)
  const verb = entry.started ? 'started and played' : 'played'
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
        <p className="pulse-post__head pulse-post__head--oneline">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">{verb}</span>
          <PulseTime when={when} />
        </p>
        <MomentCard
          game={item.game}
          icon={Gamepad2}
          detail={detail}
          coverPriority={coverPriority}
          onClick={(e) => goGame(navigate, item.game, e)}
        />
        <PulseActions item={item} onComments={onComments} showBacklog />
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

function listBandSubline(gameCount, previewGames) {
  if (gameCount == null || gameCount < 1) return null
  const titles = (previewGames || []).map((g) => g?.title).filter(Boolean)
  const countPart = `${gameCount} game${gameCount === 1 ? '' : 's'}`
  if (titles.length === 0) return countPart
  if (gameCount === 1 || titles.length === 1) {
    return `${countPart} · ${titles[0]}`
  }
  if (gameCount === 2 && titles.length >= 2) {
    return `${countPart} · ${titles[0]} and ${titles[1]}`
  }
  if (titles.length >= 2) {
    const more = gameCount - 2
    if (more > 0) {
      return `${countPart} · ${titles[0]}, ${titles[1]} and ${more} more`
    }
    return `${countPart} · ${titles[0]} and ${titles[1]}`
  }
  const more = gameCount - 1
  return `${countPart} · ${titles[0]} and ${more} more`
}

function ListPost({ item, preview, gameCount, coverPriority, followsReview, navigate }) {
  const listName = item.listName || preview?.name || null
  const games = preview?.previewGames || []
  const coverImageUrl = preview?.coverImageUrl || null
  const previewLoaded = preview != null
  const hasBackdropArt =
    previewLoaded &&
    (coverImageUrl || games.some((g) => g?.image))
  const lbClass = hasBackdropArt ? 'pulse-post__lb' : 'pulse-post__lb pulse-post__lb--noart'

  const backdropCoverUrl = coverImageUrl
    ? getSizedImageUrl(coverImageUrl, 200)
    : null
  const gridCovers = !coverImageUrl
    ? games
        .map((g) => (g?.image ? getSizedImageUrl(g.image, 200) : null))
        .filter(Boolean)
        .slice(0, 4)
    : []

  const subline =
    previewLoaded && gameCount != null
      ? listBandSubline(gameCount, games)
      : null

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
          className={lbClass}
          onClick={(e) => {
            e.stopPropagation()
            if (item.listId) navigate(`/list/${item.listId}`)
          }}
        >
          {hasBackdropArt && (
            <>
              {backdropCoverUrl ? (
                <span
                  className="pulse-post__lb-bg pulse-post__lb-bg--single"
                  style={{ '--pulse-lb-cover': `url("${backdropCoverUrl}")` }}
                  aria-hidden="true"
                />
              ) : (
                <span className="pulse-post__lb-bg pulse-post__lb-bg--grid" aria-hidden="true">
                  {gridCovers.map((url, i) => (
                    <span
                      key={url || i}
                      className="pulse-post__lb-bg-cell"
                      style={{ '--pulse-lb-cover': `url("${url}")` }}
                    />
                  ))}
                </span>
              )}
              <span className="pulse-post__lb-tint" aria-hidden="true" />
            </>
          )}
          <span className="pulse-post__lb-fan">
            <ListCoverCluster
              variant="poster"
              games={games}
              coverImageUrl={coverImageUrl}
              name={listName || ''}
            />
          </span>
          <span className="pulse-post__fin-text">
            <span className="pulse-post__fin-badge">
              <Layers size={13} aria-hidden="true" />
              List
            </span>
            <span className="pulse-post__fin-title pulse-post__lb-title">
              {listName || 'Untitled list'}
            </span>
            {subline && <span className="pulse-post__lb-sub">{subline}</span>}
          </span>
        </button>
        <PulseActions item={item} onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function StartedRunPost({ entry, coverPriority, followsReview, navigate }) {
  const items = entry.items
  const item = items[0]
  const when = formatActivityDate(item.createdAt, { pulse: true })
  const gameCount = items.length
  const titleLine = startedRunTitleLine(items)
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
        <p className="pulse-post__head pulse-post__head--oneline">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">
            started {gameCount} game{gameCount === 1 ? '' : 's'}
          </span>
          <PulseTime when={when} />
        </p>
        <MomentCard
          game={item.game}
          title={titleLine}
          icon={Play}
          detail="Started playing"
          coverPriority={coverPriority}
          onClick={(e) => {
            e.stopPropagation()
            goUserActivity(navigate, item.author)
          }}
        />
        <PulseActions item={item} onComments={onComments} />
      </div>
    </PulseShell>
  )
}

function StartedPost({ item, coverPriority, followsReview, navigate }) {
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
        <p className="pulse-post__head pulse-post__head--oneline">
          <b>{actorLabel(item)}</b>
          <span className="pulse-post__verb pulse-post__verb--status">started</span>
          <PulseTime when={when} />
        </p>
        <MomentCard
          game={item.game}
          icon={Play}
          detail="Started playing"
          coverPriority={coverPriority}
          onClick={(e) => goGame(navigate, item.game, e)}
        />
        <PulseActions item={item} onComments={onComments} showBacklog />
      </div>
    </PulseShell>
  )
}

function OwnPost({ item, coverPriority, followsReview, navigate }) {
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
        <p className="pulse-post__head pulse-post__head--oneline">
          <b>You</b>
          <span className="pulse-post__verb pulse-post__verb--status">finished</span>
          <PulseTime when={when} />
        </p>
        <MomentCard
          game={item.game}
          icon={HiOutlineFlag}
          detail="Finished"
          coverPriority={coverPriority}
          onClick={(e) => goGame(navigate, item.game, e)}
        />
        <PulseActions item={item} onComments={onComments} heartReadOnly />
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
  const detail = compactMomentDetail(item)
  const cardTitle =
    item.type === 'listed' && item.listKind === 'added'
      ? item.listName || item.game?.title || ''
      : item.game?.title || ''
  const cardGame = item.game
  const cardIcon =
    item.type === 'listed'
      ? Layers
      : item.type === 'played'
        ? Gamepad2
        : item.type === 'backlogged'
          ? Layers
          : null
  const onCardClick = (e) => {
    if (item.type === 'listed' && item.listId) {
      e.stopPropagation()
      navigate(`/list/${item.listId}`)
      return
    }
    goGame(navigate, item.game, e)
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
        <p className="pulse-post__head pulse-post__head--oneline">
          <b>{actorLabel(item)}</b>
          <span
            className={`pulse-post__verb ${
              item.type === 'listed' ? 'pulse-post__verb--journal' : 'pulse-post__verb--status'
            }`}
          >
            {verb}
          </span>
          <PulseTime when={when} />
        </p>
        {(cardGame || cardTitle) && (
          <MomentCard
            game={cardGame}
            title={cardTitle}
            icon={cardIcon}
            detail={detail}
            coverPriority={coverPriority}
            onClick={onCardClick}
          />
        )}
        <PulseActions
          item={item}
          onComments={onComments}
          showBacklog={Boolean(item.game) && item.type !== 'listed'}
        />
      </div>
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
    case 'startedRun':
      return (
        <StartedRunPost
          entry={entry}
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
