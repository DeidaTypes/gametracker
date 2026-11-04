import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { HiDotsVertical } from 'react-icons/hi'
import { LuChevronLeft, LuMessageCircle } from 'react-icons/lu'
import Skeleton from './Skeleton'
import { Arrive } from './motion/ContentSwap'
import Avatar from './Avatar'
import PlusBadge from './PlusBadge'
import LevelRing from './level/LevelRing'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useProfileHeaderScroll } from '../hooks/useProfileHeaderScroll'
import { EASE_CSS, MOTION } from '../motion/xMotion'
import './ProfilePlayerCard.css'

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

/** Compact numeral for profile header counts (Games, Hours, Followers, Following). */
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
  return 'Following'
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

/**
 * ProfilePlayerCard — open profile header: top bar, photo with tier ring,
 * four counts beside the photo, and a full-width display name.
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
  hasUnreadMessages,
  onBack,
  onOverflow,
  onMessages,
  onAvatarClick,
  avatarPending = false,
  onFollowersClick,
  onFollowingClick,
  onGamesClick,
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
  const avatarWasPending = useRef(false)
  const fade = useRef(null)

  // Pending drops from 60% to the saved image. Same curve as the image
  // fade. Reduce Motion swaps, with no fade.
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
  const avatarPhotoSize = compactAvatar ? 72 : 84
  const { solid, named } = useProfileHeaderScroll({
    barRef,
    frostRef,
    nameRef,
  })
  const handle = (username || '').trim()
  const nameText = displayName || 'You'
  const nameIsLong = Array.from(nameText).length > 24

  const hoursValue =
    hoursPlayed == null ? '—' : formatCompactCount(hoursPlayed)

  const barClass = [
    'ppc__bar',
    solid ? 'ppc__bar--solid' : '',
    named ? 'ppc__bar--named' : '',
  ].filter(Boolean).join(' ')

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
          <p className="ppc__bar-handle">
            {handle.length > 0 ? `@${handle}` : '\u00a0'}
          </p>
          <p className="ppc__bar-name" aria-hidden="true">
            {nameText}
          </p>
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
    <section
      ref={rootRef}
      className="ppc"
      aria-label="Profile summary"
    >
      <div className="ppc__foreground">
        <div className="ppc__identity-row">
          <div className="ppc__avatar-wrap">
            <button
              type="button"
              className={`ppc__avatar${isOwnProfile ? ' ppc__avatar--editable' : ''}${avatarPending ? ' ppc__avatar--pending' : ''}`}
              onClick={onAvatarClick}
              aria-label={
                isOwnProfile
                  ? `Change profile photo${levelSuffix}`
                  : `${displayName || 'User'} profile photo${levelSuffix}`
              }
            >
              <Avatar
                avatarUrl={avatarUrl}
                name={displayName || 'User'}
                seed={avatarSeed}
                size="xl"
                alt={`${displayName || 'User'} profile photo`}
                ring={false}
              />
            </button>
            {level != null && progress != null && (
              <LevelRing
                level={level}
                progress={progress.fraction}
                photoSize={avatarPhotoSize}
                glint
              />
            )}
          </div>

          <div className="ppc__counts" role="group" aria-label="Profile stats">
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
        </div>

        <h1
          ref={nameRef}
          className={`ppc__name${nameIsLong ? ' ppc__name--long' : ''}`}
        >
          {nameText}
          <PlusBadge active={plusActive} inline />
        </h1>
      </div>
    </section>
    </>
  )
}
