import React from 'react'
import { HiDotsVertical } from 'react-icons/hi'
import { LuChevronLeft, LuMessageCircle } from 'react-icons/lu'
import Skeleton from './Skeleton'
import Avatar from './Avatar'
import './ProfilePlayerCard.css'

/**
 * Formats the hours numeral for the Played stat. Whole hours below 1000,
 * then compacted so a four-digit total can't push the four-column stat
 * grid into a wrap.
 */
function formatHours(hours) {
  const n = Number(hours) || 0
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
  }
  return String(Math.round(n))
}

/**
 * One stat cell in the four-column block. Renders a fixed-height skeleton
 * in place of the numeral while its value is still resolving so the card
 * never changes height as data lands — the profile's long-standing "stats
 * flash empty on reload" symptom was this block rendering 0 and then
 * jumping.
 */
function Stat({ value, label, suffix, loading }) {
  return (
    <div className="ppc__stat">
      <span className="ppc__stat-value">
        {loading ? (
          <Skeleton variant="text" width={28} height={22} className="ppc__stat-skeleton" />
        ) : (
          <>
            {value}
            {suffix && <span className="ppc__stat-suffix">{suffix}</span>}
          </>
        )}
      </span>
      <span className="ppc__stat-label">{label}</span>
    </div>
  )
}

/**
 * ProfilePlayerCard — the contained header card at the top of every
 * profile: avatar, display name, @handle, a clickable
 * "N Followers · N Following" line, and a four-stat block
 * (Games / Played hours / Reviews / Avg ★). The ⋯ button opens the
 * profile's existing overflow sheet; visitor profiles get a back chevron.
 *
 * On your own profile, a message-bubble icon sits just left of the ⋯
 * button — this is the app's inbox entry point (there's no dedicated
 * Messages nav tab; see BottomNav.jsx). It carries the same unread-DM
 * dot as the Profile bottom-nav tab (one signal, one meaning) rather
 * than a numeric badge.
 *
 * Every numeral here is real. A stat whose source hasn't resolved shows a
 * skeleton; a stat with no data to show at all (e.g. avg rating with zero
 * ratings) shows an em dash rather than a fabricated 0.0.
 */
export default function ProfilePlayerCard({
  displayName,
  username,
  avatarUrl,
  avatarSeed,
  isOwnProfile,
  liveStatusLabel,
  followersCount,
  followingCount,
  followLoading,
  gamesCount,
  hoursPlayed,
  reviewsCount,
  avgRating,
  statsLoading,
  hasUnreadMessages,
  onBack,
  onOverflow,
  onMessages,
  onAvatarClick,
  onFollowersClick,
  onFollowingClick,
}) {
  const hasRatings = avgRating != null && avgRating > 0

  return (
    <section className="ppc" aria-label="Profile summary">
      <div className="ppc__top">
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

        <button
          type="button"
          className={`ppc__avatar${isOwnProfile ? ' ppc__avatar--editable' : ''}`}
          onClick={onAvatarClick}
          aria-label={
            isOwnProfile
              ? 'Edit profile photo'
              : `${displayName || 'User'} profile photo`
          }
        >
          <Avatar
            avatarUrl={avatarUrl}
            name={displayName || 'User'}
            seed={avatarSeed}
            size="xl"
            alt={`${displayName || 'User'} profile photo`}
          />
        </button>

        <div className="ppc__identity">
          <h1 className="ppc__name">{displayName || 'You'}</h1>
          {(username || '').trim().length > 0 && (
            <p className="ppc__handle">@{username.trim()}</p>
          )}

          <p className="ppc__follows">
            <button
              type="button"
              className="ppc__follow-link"
              onClick={onFollowersClick}
              aria-label={
                followLoading
                  ? 'Followers, loading'
                  : `${followersCount} followers, view list`
              }
            >
              {followLoading ? (
                <Skeleton variant="text" width={12} height={13} className="ppc__follow-skeleton" />
              ) : (
                <span className="ppc__follow-count">{followersCount}</span>
              )}{' '}
              Followers
            </button>
            <span className="ppc__follow-dot" aria-hidden="true">·</span>
            <button
              type="button"
              className="ppc__follow-link"
              onClick={onFollowingClick}
              aria-label={
                followLoading
                  ? 'Following, loading'
                  : `${followingCount} following, view list`
              }
            >
              {followLoading ? (
                <Skeleton variant="text" width={12} height={13} className="ppc__follow-skeleton" />
              ) : (
                <span className="ppc__follow-count">{followingCount}</span>
              )}{' '}
              Following
            </button>
          </p>

          {liveStatusLabel && (
            <p className="ppc__live" aria-live="polite">
              <span className="ppc__live-dot" aria-hidden="true" />
              {liveStatusLabel}
            </p>
          )}
        </div>

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

      <div className="ppc__stats" role="group" aria-label="Profile stats">
        <Stat
          value={gamesCount ?? 0}
          label="Games"
          loading={statsLoading || gamesCount == null}
        />
        {/* An unresolved hours total is an em dash, not an endless
            skeleton: getTotalHoursForUser returns 0 for a user with no
            tracker rows, so null here means the query failed or timed
            out, and the old `hoursPlayed == null` skeleton had nothing
            left to wait for. */}
        <Stat
          value={hoursPlayed == null ? '—' : formatHours(hoursPlayed)}
          suffix={hoursPlayed == null ? undefined : 'h'}
          label="Played"
          loading={statsLoading}
        />
        <Stat value={reviewsCount ?? 0} label="Reviews" loading={statsLoading} />
        <Stat
          value={hasRatings ? avgRating.toFixed(1) : '—'}
          label="Avg ★"
          loading={statsLoading}
        />
      </div>
    </section>
  )
}
