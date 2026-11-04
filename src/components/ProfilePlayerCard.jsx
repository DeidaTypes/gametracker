import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { HiDotsVertical } from 'react-icons/hi'
import { LuChevronLeft, LuMessageCircle } from 'react-icons/lu'
import Skeleton from './Skeleton'
import { Arrive } from './motion/ContentSwap'
import Avatar from './Avatar'
import PlusBadge from './PlusBadge'
import LevelRing from './level/LevelRing'
import { tierFor } from '../data/levels'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useProfileHeaderScroll } from '../hooks/useProfileHeaderScroll'
import { hapticImpact } from '../utils/haptics'
import { EASE_CSS, MOTION } from '../motion/xMotion'
import './ProfilePlayerCard.css'

const DRAG_THRESHOLD_PX = 6
const sweepPlayedUserIds = new Set()

function levelAriaSuffix(level, progress) {
  if (level == null) return ''
  if (level >= 50) return `, Level ${level}`
  if (!progress || progress.isMax) return `, Level ${level}`
  const next = level + 1
  return `, Level ${level}, ${progress.intoLevel} of ${progress.levelCost} XP to Level ${next}`
}

const COMPACT_AVATAR_QUERY = '(max-width: 359px)'

function subscribeCompactAvatar(onChange) {
  const mq = window.matchMedia(COMPACT_AVATAR_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function useCompactAvatarLayout() {
  return useSyncExternalStore(
    subscribeCompactAvatar,
    () => window.matchMedia(COMPACT_AVATAR_QUERY).matches,
    () => false,
  )
}

function formatCompactCount(n) {
  const num = Number(n) || 0
  if (num >= 10000) return `${Math.round(num / 1000)}k`
  if (num >= 1000) {
    const k = num / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
  }
  return String(Math.round(num))
}

function countLabel(kind, count) {
  if (kind === 'games') return count === 1 ? 'Game' : 'Games'
  if (kind === 'hours') return count === 1 ? 'Hour' : 'Hours'
  if (kind === 'followers') return count === 1 ? 'Follower' : 'Followers'
  if (kind === 'following') return 'Following'
  if (kind === 'reviews') return count === 1 ? 'Review' : 'Reviews'
  if (kind === 'lists') return count === 1 ? 'List' : 'Lists'
  return count === 1 ? 'Best answer' : 'Best answers'
}

function handlesDiffer(displayName, username) {
  const handle = (username || '').trim()
  if (!handle) return false
  const name = (displayName || '').trim()
  return handle.toLowerCase() !== name.toLowerCase()
}

function profileSubline({ displayName, username, joinedYear }) {
  if (handlesDiffer(displayName, username)) {
    return `@${(username || '').trim()}`
  }
  if (joinedYear != null) return `Player since ${joinedYear}`
  return null
}

function isCardInteractiveTarget(node) {
  if (!node || !(node instanceof Element)) return false
  return Boolean(node.closest('button, a, [role="button"]'))
}

function pointerPositionInCard(cardEl, clientX, clientY) {
  const rect = cardEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return { mx: 0.5, my: 0.5 }
  const mx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  const my = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  return { mx, my }
}

function StatCell({ value, label, loading, onClick, ariaLabel, disabled }) {
  const inner = (
    <>
      <span className="ppc__stat-value">
        <Arrive
          as="span"
          center
          ready={!loading}
          placeholder={
            <Skeleton variant="text" width={28} height={16} className="ppc__stat-skeleton" />
          }
        >
          {value}
        </Arrive>
      </span>
      <span className="ppc__stat-label">{label}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className="ppc__stat ppc__stat--tappable"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {inner}
      </button>
    )
  }

  return <div className="ppc__stat">{inner}</div>
}

function AvgRatingCell({ avgRating, loading }) {
  const value =
    avgRating == null ? (
      '—'
    ) : (
      <>
        {avgRating.toFixed(1)}
        <span className="ppc__stat-star" aria-hidden="true">
          ★
        </span>
      </>
    )

  return (
    <div className="ppc__stat">
      <span className="ppc__stat-value ppc__stat-value--rating">
        <Arrive
          as="span"
          center
          ready={!loading}
          placeholder={
            <Skeleton variant="text" width={36} height={16} className="ppc__stat-skeleton" />
          }
        >
          {value}
        </Arrive>
      </span>
      <span className="ppc__stat-label">Avg rating</span>
    </div>
  )
}

function CardFaceLayers({ showSweep }) {
  return (
    <>
      <span className="ppc__layer ppc__layer--grain" aria-hidden="true" />
      <span className="ppc__layer ppc__layer--holo" aria-hidden="true" />
      <span className="ppc__layer ppc__layer--lines" aria-hidden="true" />
      <span className="ppc__layer ppc__layer--glare" aria-hidden="true" />
      {showSweep && <span className="ppc__layer ppc__layer--sweep" aria-hidden="true" />}
    </>
  )
}

/**
 * ProfilePlayerCard — sticky bar + foil player card (flip, tilt, career back).
 */
export default function ProfilePlayerCard({
  displayName,
  username,
  avatarUrl,
  avatarSeed,
  isOwnProfile,
  plusActive = false,
  followersCount,
  followingCount,
  followLoading,
  gamesCount,
  hoursPlayed,
  statsLoading,
  reviewsCount,
  avgRating,
  listsCount,
  bestAnswersCount,
  joinedYear,
  careerLoading,
  hasUnreadMessages,
  onBack,
  onOverflow,
  onMessages,
  onAvatarClick,
  avatarPending = false,
  onFollowersClick,
  onFollowingClick,
  onGamesClick,
  onReviewsClick,
  onListsClick,
  onBestAnswersClick,
  level,
  progress,
}) {
  const levelSuffix = levelAriaSuffix(level, progress)
  const compactAvatar = useCompactAvatarLayout()
  const { reduced } = useMotionPreference()
  const rootRef = useRef(null)
  const barRef = useRef(null)
  const frostRef = useRef(null)
  const nameRef = useRef(null)
  const cardRef = useRef(null)
  const tiltRef = useRef(null)
  const avatarWasPending = useRef(false)
  const fade = useRef(null)
  const pointerState = useRef({
    down: false,
    dragged: false,
    startedOnButton: false,
    startX: 0,
    startY: 0,
  })
  const rafRef = useRef(0)

  const [flipped, setFlipped] = useState(false)
  const profileUserId = avatarSeed || ''

  useEffect(() => {
    setFlipped(false)
  }, [profileUserId])

  const [runSweep, setRunSweep] = useState(false)
  useEffect(() => {
    if (reduced || !profileUserId) {
      setRunSweep(false)
      return
    }
    if (sweepPlayedUserIds.has(profileUserId)) {
      setRunSweep(false)
      return
    }
    sweepPlayedUserIds.add(profileUserId)
    setRunSweep(true)
  }, [profileUserId, reduced])

  useLayoutEffect(() => {
    const img = rootRef.current?.querySelector('.ppc__avatar .avatar--img')
    if (avatarPending) {
      fade.current?.cancel()
      fade.current = null
    } else if (avatarWasPending.current && !reduced && img && img.complete) {
      fade.current?.cancel()
      fade.current = img.animate(
        [{ opacity: 0.6 }, { opacity: 1 }],
        { duration: MOTION.image, easing: EASE_CSS.fade, fill: 'backwards' },
      )
    }
    avatarWasPending.current = avatarPending
  }, [avatarPending, reduced])

  const avatarPhotoSize = compactAvatar ? 56 : 64
  const { solid, named } = useProfileHeaderScroll({
    barRef,
    frostRef,
    nameRef,
  })

  const nameText = displayName || 'You'
  const nameIsLong = Array.from(nameText).length > 24
  const subline = profileSubline({ displayName, username, joinedYear })

  const hoursValue =
    hoursPlayed == null ? '—' : formatCompactCount(hoursPlayed)

  const tierKey = level != null ? tierFor(level).key : null
  const ppcClass = [
    'ppc',
    tierKey ? `ppc--tier-${tierKey}` : '',
  ].filter(Boolean).join(' ')

  const barClass = [
    'ppc__bar',
    solid ? 'ppc__bar--solid' : '',
    named ? 'ppc__bar--named' : '',
  ].filter(Boolean).join(' ')

  const writeTiltVars = useCallback((mx, my) => {
    const tilt = tiltRef.current
    if (!tilt) return
    tilt.style.setProperty('--mx', String(mx))
    tilt.style.setProperty('--my', String(my))
  }, [])

  const writeTiltTransform = useCallback((mx, my) => {
    const tilt = tiltRef.current
    if (!tilt || reduced) return
    const rotX = (0.5 - my) * 16
    const rotY = (mx - 0.5) * 16
    tilt.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`
  }, [reduced])

  const resetTilt = useCallback(() => {
    const tilt = tiltRef.current
    if (!tilt) return
    tilt.classList.remove('ppc__tilt--live')
    tilt.style.transform = ''
    writeTiltVars(0.5, 0.5)
  }, [writeTiltVars])

  const schedulePointerFrame = useCallback((clientX, clientY, applyTilt) => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const card = cardRef.current
      if (!card) return
      const { mx, my } = pointerPositionInCard(card, clientX, clientY)
      writeTiltVars(mx, my)
      if (applyTilt) writeTiltTransform(mx, my)
    })
  }, [writeTiltTransform, writeTiltVars])

  const toggleFlip = useCallback(() => {
    setFlipped((v) => !v)
  }, [])

  const onFlipButtonClick = useCallback(() => {
    hapticImpact('Light')
    toggleFlip()
  }, [toggleFlip])

  const onCardPointerDown = useCallback((e) => {
    pointerState.current = {
      down: true,
      dragged: false,
      startedOnButton: isCardInteractiveTarget(e.target),
      startX: e.clientX,
      startY: e.clientY,
    }
    tiltRef.current?.classList.add('ppc__tilt--live')
    schedulePointerFrame(e.clientX, e.clientY, pointerState.current.down)
  }, [schedulePointerFrame])

  const onCardPointerMove = useCallback((e) => {
    const state = pointerState.current
    if (e.pointerType === 'touch' && !state.down) return

    if (state.down) {
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) state.dragged = true
    }

    const applyTilt = !reduced && (e.pointerType !== 'touch' || state.down)
    schedulePointerFrame(e.clientX, e.clientY, applyTilt)
  }, [reduced, schedulePointerFrame])

  const onCardPointerUp = useCallback(() => {
    const state = pointerState.current
    if (state.down && !state.dragged && !state.startedOnButton) {
      hapticImpact('Light')
      toggleFlip()
    }
    pointerState.current.down = false
    resetTilt()
  }, [resetTilt, toggleFlip])

  const onCardPointerCancel = useCallback(() => {
    pointerState.current.down = false
    resetTilt()
  }, [resetTilt])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const avatarInner = (
    <Avatar
      avatarUrl={avatarUrl}
      name={displayName || 'User'}
      seed={avatarSeed}
      size="xl"
      alt={`${displayName || 'User'} profile photo`}
      ring={false}
    />
  )

  const avatarBlock = isOwnProfile ? (
    <button
      type="button"
      className={`ppc__avatar${avatarPending ? ' ppc__avatar--pending' : ''} ppc__avatar--editable`}
      onClick={onAvatarClick}
      aria-label={`Change profile photo${levelSuffix}`}
    >
      {avatarInner}
    </button>
  ) : (
    <div
      className="ppc__avatar"
      aria-label={`${displayName || 'User'} profile photo${levelSuffix}`}
    >
      {avatarInner}
    </div>
  )

  const frontTray = (
    <div className="ppc__tray" role="group" aria-label="Profile stats">
      <StatCell
        value={formatCompactCount(gamesCount ?? 0)}
        label={countLabel('games', gamesCount ?? 0)}
        loading={statsLoading || gamesCount == null}
        onClick={onGamesClick}
        disabled={statsLoading || gamesCount == null}
        ariaLabel={
          isOwnProfile
            ? `${gamesCount ?? 0} games, open your library`
            : `${gamesCount ?? 0} games, open ${displayName || 'this player'}'s library`
        }
      />
      <StatCell
        value={hoursValue}
        label={countLabel('hours', hoursPlayed ?? 0)}
        loading={statsLoading}
      />
      <StatCell
        value={formatCompactCount(followersCount ?? 0)}
        label={countLabel('followers', followersCount ?? 0)}
        loading={followLoading}
        onClick={onFollowersClick}
        disabled={followLoading}
        ariaLabel={
          followLoading
            ? 'Followers, loading'
            : `${followersCount} ${followersCount === 1 ? 'follower' : 'followers'}, view list`
        }
      />
      <StatCell
        value={formatCompactCount(followingCount ?? 0)}
        label={countLabel('following', followingCount ?? 0)}
        loading={followLoading}
        onClick={onFollowingClick}
        disabled={followLoading}
        ariaLabel={
          followLoading
            ? 'Following, loading'
            : `${followingCount} following, view list`
        }
      />
    </div>
  )

  const backTray = (
    <div className="ppc__tray" role="group" aria-label="Career stats">
      <StatCell
        value={formatCompactCount(reviewsCount ?? 0)}
        label={countLabel('reviews', reviewsCount ?? 0)}
        loading={careerLoading || reviewsCount == null}
        onClick={onReviewsClick}
        disabled={careerLoading || reviewsCount == null}
        ariaLabel={`${reviewsCount ?? 0} ${countLabel('reviews', reviewsCount ?? 0).toLowerCase()}, open Reviews`}
      />
      <AvgRatingCell avgRating={avgRating} loading={careerLoading} />
      <StatCell
        value={formatCompactCount(listsCount ?? 0)}
        label={countLabel('lists', listsCount ?? 0)}
        loading={careerLoading || listsCount == null}
        onClick={onListsClick}
        disabled={careerLoading || listsCount == null}
        ariaLabel={`${listsCount ?? 0} ${countLabel('lists', listsCount ?? 0).toLowerCase()}, open Lists`}
      />
      <StatCell
        value={formatCompactCount(bestAnswersCount ?? 0)}
        label={countLabel('bestAnswers', bestAnswersCount ?? 0)}
        loading={careerLoading || bestAnswersCount == null}
        onClick={onBestAnswersClick}
        disabled={careerLoading || bestAnswersCount == null}
        ariaLabel={`${bestAnswersCount ?? 0} ${countLabel('bestAnswers', bestAnswersCount ?? 0).toLowerCase()}, open list`}
      />
    </div>
  )

  return (
    <>
      <header ref={barRef} className={barClass}>
        <div ref={frostRef} className="ppc__bar-frost" aria-hidden="true" />
        <div className="ppc__bar-side ppc__bar-side--left">
          {!isOwnProfile && (
            <button
              type="button"
              className="ppc__icon-btn ppc__icon-btn--back"
              onClick={onBack}
              aria-label="Go back"
            >
              <LuChevronLeft size={22} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="ppc__bar-titles">
          <p className="ppc__bar-name">{nameText}</p>
        </div>
        <div className="ppc__bar-side ppc__bar-side--right">
          {isOwnProfile && (
            <button
              type="button"
              className="ppc__icon-btn ppc__icon-btn--messages"
              onClick={onMessages}
              aria-label={hasUnreadMessages ? 'Messages, unread' : 'Messages'}
            >
              <LuMessageCircle size={20} aria-hidden="true" />
              {hasUnreadMessages && (
                <span className="ppc__messages-dot" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            className="ppc__icon-btn ppc__icon-btn--overflow"
            onClick={onOverflow}
            aria-label="More options"
          >
            <HiDotsVertical size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section ref={rootRef} className={ppcClass} aria-label="Profile summary">
        <div className="ppc__foreground">
          <div className="ppc__card-wrap">
            <button
              type="button"
              className="ppc__flip-sr"
              onClick={onFlipButtonClick}
              aria-label={flipped ? 'Show profile stats' : 'Show career stats'}
            />
            <div
              ref={cardRef}
              className={`ppc__card${flipped ? ' ppc__card--flipped' : ''}${reduced ? ' ppc__card--reduced-motion' : ''}`}
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={onCardPointerUp}
              onPointerCancel={onCardPointerCancel}
              onPointerLeave={onCardPointerCancel}
            >
              <div ref={tiltRef} className="ppc__tilt">
                <div
                  className={`ppc__face ppc__face--front${runSweep ? ' ppc__face--sweep' : ''}`}
                  inert={flipped ? true : undefined}
                >
                  <CardFaceLayers showSweep={runSweep} />
                  <div className="ppc__face-body">
                    <span className="ppc__mark ppc__mark--issuer" aria-hidden="true">
                      CHECKPOINT
                    </span>
                    <div className="ppc__face-top">
                      <div className="ppc__avatar-wrap">
                        {avatarBlock}
                        {level != null && progress != null && (
                          <LevelRing
                            level={level}
                            progress={progress.fraction}
                            photoSize={avatarPhotoSize}
                            glint
                          />
                        )}
                      </div>
                      <div className="ppc__who">
                        <h1
                          ref={nameRef}
                          className={`ppc__name${nameIsLong ? ' ppc__name--long' : ''}`}
                        >
                          {nameText}
                          <PlusBadge active={plusActive} inline />
                        </h1>
                        {subline && <p className="ppc__sub">{subline}</p>}
                      </div>
                    </div>
                    {frontTray}
                  </div>
                </div>

                <div
                  className="ppc__face ppc__face--back"
                  inert={!flipped ? true : undefined}
                >
                  <CardFaceLayers showSweep={false} />
                  <div className="ppc__face-body ppc__face-body--back">
                    <div className="ppc__back-marks">
                      <span className="ppc__mark">CAREER</span>
                      <span className="ppc__mark ppc__mark--issuer">CHECKPOINT</span>
                    </div>
                    <div className="ppc__back-mid">
                      <p className="ppc__back-name">{nameText}</p>
                      {joinedYear != null && (
                        <p className="ppc__back-since">Player since {joinedYear}</p>
                      )}
                    </div>
                    {backTray}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
