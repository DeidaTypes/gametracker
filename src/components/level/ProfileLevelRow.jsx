import React from 'react'
import { LuChevronRight } from 'react-icons/lu'
import { rewardAt, tierFor } from '../../data/levels'
import Skeleton from '../Skeleton'
import { Arrive } from '../motion/ContentSwap'
import './ProfileLevelRow.css'

const GAME_SOURCES = new Set(['finished', 'started', 'rate', 'review', 'backlog'])

/**
 * SVG level ring — 12 o'clock start, round cap.
 * @param {{ size: number, stroke: number, level: number, fraction: number, className?: string }} props
 */
export function LevelProgressRing({
  size,
  stroke,
  level,
  fraction,
  className = '',
}) {
  const tier = tierFor(level)
  const gradId = `cp-ring-${tier.key}`
  const cx = size / 2
  const cy = size / 2
  const r = size === 54 ? 23 : (23 * size) / 54
  const circ = 2 * Math.PI * r
  const pct = Math.min(1, Math.max(0, Number(fraction) || 0))
  const dash = circ * pct
  const gap = circ - dash

  return (
    <div
      className={`level-ring ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          style={{ strokeOpacity: 'var(--ring-track-opacity)' }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <span className="level-ring__num">{level}</span>
    </div>
  )
}

function ProfileLevelRowSkeleton() {
  return (
    <div className="profile-level-row profile-level-row--loading" aria-busy="true">
      <Skeleton variant="circle" width={54} height={54} />
      <div className="profile-level-row__text">
        <Skeleton variant="text" width="72%" height={18} />
        <Skeleton variant="text" width="100%" height={6} style={{ marginTop: 10 }} />
        <Skeleton variant="text" width="55%" height={13} style={{ marginTop: 8 }} />
      </div>
    </div>
  )
}

/**
 * Tappable level summary at the top of the Challenge + Badges card.
 */
export default function ProfileLevelRow({
  loading = false,
  level = 1,
  progress,
  tier,
  xpTotal = 0,
  onOpen,
}) {
  const ready = !loading && progress != null
  const isMax = progress?.isMax
  const nextLevel = isMax ? null : (progress?.level ?? level) + 1
  const nextReward = nextLevel != null ? rewardAt(nextLevel) : null

  let subline = ''
  if (isMax) {
    subline = `Max level \u00b7 ${xpTotal.toLocaleString()} XP`
  } else if (progress) {
    subline = `${progress.toNext.toLocaleString()} XP to Level ${nextLevel}`
    if (nextReward?.short) subline += ` \u00b7 ${nextReward.short}`
  }

  const body = ready ? (
    <button
      type="button"
      className="profile-level-row"
      onClick={onOpen}
      aria-label={`Level ${level}, ${tier?.name || ''}. Open level details.`}
    >
      <LevelProgressRing size={54} stroke={5} level={level} fraction={progress.fraction} />
      <span className="profile-level-row__text">
        <span className="profile-level-row__line1">
          <span className="profile-level-row__title">Level {level}</span>
          <span className="profile-level-row__tier">{tier?.name}</span>
        </span>
        <span className="profile-level-row__bar" aria-hidden="true">
          <span
            className="profile-level-row__bar-fill"
            style={{
              width: `${Math.round((progress.fraction || 0) * 100)}%`,
              background: tier?.key
                ? `linear-gradient(90deg, var(--ring-${tier.key}-2), var(--ring-${tier.key}-3))`
                : undefined,
            }}
          />
        </span>
        <span className="profile-level-row__sub">{subline}</span>
      </span>
      <LuChevronRight size={18} className="profile-level-row__chevron" aria-hidden="true" />
    </button>
  ) : null

  return (
    <Arrive ready={ready} placeholder={<ProfileLevelRowSkeleton />}>
      {body}
    </Arrive>
  )
}

export { GAME_SOURCES }
