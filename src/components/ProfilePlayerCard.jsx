import React, { useSyncExternalStore } from 'react'
import { HiDotsVertical } from 'react-icons/hi'
import { LuChevronLeft, LuMessageCircle } from 'react-icons/lu'
import Skeleton from './Skeleton'
import { Arrive } from './motion/ContentSwap'
import Avatar from './Avatar'
import PlusBadge from './PlusBadge'
import LevelRing from './level/LevelRing'
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
 * four counts beside the photo, full-width display name, and optional live line.
 * Backdrop is a banner image or a soft accent wash behind the header.
 */
export default function ProfilePlayerCard({
  displayName,
  username,
  avatarUrl,
  avatarSeed,
  isOwnProfile,
  plusActive = false,
  liveStatusLabel,
  bannerUrl,
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
  onFollowersClick,
  onFollowingClick,
  onGamesClick,
  level,
  progress,
}) {
  const levelSuffix = levelAriaSuffix(level, progress)
  const compactAvatar = useCompactAvatarLayout()
  const avatarPhotoSize = compactAvatar ? 64 : 72
  const hasBanner = Boolean((bannerUrl || '').trim())
  const handle = (username || '').trim()
  const nameText = displayName || 'You'
  const nameIsLong = Array.from(nameText).length > 24

  const hoursValue =
    hoursPlayed == null ? '—' : formatCompactCount(hoursPlayed)

  return (
    <section
      className={`ppc${hasBanner ? ' ppc--banner' : ''}`}
      aria-label="Profile summary"
    >
      <div className="ppc__backdrop" aria-hidden="true">
        {hasBanner ? (
          <div className="ppc__backdrop-banner">
            <img
              src={bannerUrl}
              alt=""
              className="ppc__banner-img"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="ppc__backdrop-wash" />
        )}
      </div>

      <div className="ppc__foreground">
        <header className="ppc__bar">
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
          <p className="ppc__bar-handle">
            {handle.length > 0 ? `@${handle}` : '\u00a0'}
          </p>
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

        <div className="ppc__identity-row">
          <div className="ppc__avatar-wrap">
            <button
              type="button"
              className={`ppc__avatar${isOwnProfile ? ' ppc__avatar--editable' : ''}`}
              onClick={onAvatarClick}
              aria-label={
                isOwnProfile
                  ? `Edit profile photo${levelSuffix}`
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
          className={`ppc__name${nameIsLong ? ' ppc__name--long' : ''}`}
        >
          {nameText}
          <PlusBadge active={plusActive} inline />
        </h1>

        {liveStatusLabel && (
          <p className="ppc__live" aria-live="polite">
            {liveStatusLabel}
          </p>
        )}
      </div>
    </section>
  )
}
