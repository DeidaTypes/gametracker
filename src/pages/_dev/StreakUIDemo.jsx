import React, { useMemo, useState } from 'react'
import ProgressStrip from '../../components/home/ProgressStrip'
import StreakDetailSheet from '../../components/streak/StreakDetailSheet'
import UnlockCelebration from '../../components/celebration/UnlockCelebration'
import { buildStreakMilestoneView } from '../../services/streakMilestoneState'
import '../../components/home/ProgressStrip.css'
import './StreakUIDemo.css'

const MOCK_WEEK = [
  { key: '2026-09-08', dayLabel: 'M', active: true, isToday: false },
  { key: '2026-09-09', dayLabel: 'T', active: true, isToday: false },
  { key: '2026-09-10', dayLabel: 'W', active: true, isToday: false },
  { key: '2026-09-11', dayLabel: 'T', active: true, isToday: false },
  { key: '2026-09-12', dayLabel: 'F', active: false, isToday: false },
  { key: '2026-09-13', dayLabel: 'S', active: true, isToday: false },
  { key: '2026-09-14', dayLabel: 'S', active: true, isToday: true },
]

function MockHomeStrip({ view }) {
  const {
    currentStreak,
    currentTier,
    nextTier,
    daysToNextTier,
    weekCells,
    hasStreak,
  } = view

  const line2Parts = []
  if (!hasStreak) {
    line2Parts.push('Start a streak')
  } else if (nextTier && daysToNextTier != null) {
    line2Parts.push(`${daysToNextTier} days to ${nextTier.name}`)
  }
  const line2 = line2Parts.join(' · ')

  return (
    <div className="ps ps--single">
      <div className={['ps-streak', !hasStreak ? 'ps-streak--zero' : ''].filter(Boolean).join(' ')}>
        <div className="ps-streak__head">
          <span className="ps-streak__count">{currentStreak}</span>
          {hasStreak && currentTier && (
            <span className="ps-streak__tier text-label">{currentTier.name}</span>
          )}
        </div>
        <div className="ps-streak__pips">
          {weekCells.map((cell) => (
            <span
              key={cell.key}
              className={[
                'ps-streak__pip',
                hasStreak && cell.active ? 'ps-streak__pip--active' : '',
                cell.isToday ? 'ps-streak__pip--today' : '',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>
        {line2 && <p className="ps-streak__line2 text-caption">{line2}</p>}
      </div>
    </div>
  )
}

export default function StreakUIDemo() {
  const [detailOpen, setDetailOpen] = useState(false)
  const [atRiskOpen, setAtRiskOpen] = useState(false)
  const [celebration, setCelebration] = useState(null)

  const day11View = useMemo(
    () =>
      buildStreakMilestoneView({
        streakData: {
          current_streak: 11,
          longest_streak: 18,
          last_active_date: '2026-09-14',
          freezes_remaining: 1,
        },
        weekCells: MOCK_WEEK,
      }),
    []
  )

  const atRiskView = useMemo(
    () =>
      buildStreakMilestoneView({
        streakData: {
          current_streak: 9,
          longest_streak: 12,
          last_active_date: '2026-09-13',
          freezes_remaining: 0,
        },
        weekCells: MOCK_WEEK,
      }),
    []
  )

  return (
    <div className="streak-ui-demo">
      <h1 className="text-heading">S16-1 streak UI demo</h1>

      <section>
        <h2 className="text-title">Home strip — day 11 (Ember → Kindled)</h2>
        <MockHomeStrip view={day11View} />
      </section>

      <section>
        <h2 className="text-title">Detail ladder</h2>
        <button type="button" onClick={() => setDetailOpen(true)}>Open sheet</button>
        <StreakDetailSheet isOpen={detailOpen} onClose={() => setDetailOpen(false)} view={day11View} />
      </section>

      <section>
        <h2 className="text-title">At-risk (streak 9, unlogged today)</h2>
        <button type="button" onClick={() => setAtRiskOpen(true)}>Open at-risk sheet</button>
        <p className="text-caption">isAtRisk: {String(atRiskView.isAtRisk)}</p>
        <StreakDetailSheet isOpen={atRiskOpen} onClose={() => setAtRiskOpen(false)} view={atRiskView} />
      </section>

      <section>
        <h2 className="text-title">Celebrations</h2>
        <button type="button" onClick={() => setCelebration('streak')}>5-dot streak</button>
        <button type="button" onClick={() => setCelebration('badge')}>3-dot badge</button>
      </section>

      <UnlockCelebration
        open={celebration === 'streak'}
        onDismiss={() => setCelebration(null)}
        icon="flame"
        ringColor="var(--streak-tier-kindled)"
        tierLabel="Kindled"
        eyebrow="Streak milestone"
        title="15-day streak"
        category="Kindled"
        description="Fifteen days strong. Fully kindled."
        progressDots={{ total: 5, filled: 3 }}
        primaryCta="Share it"
        dismissCta="Not now"
      />

      <UnlockCelebration
        open={celebration === 'badge'}
        onDismiss={() => setCelebration(null)}
        ringColor="var(--tier-gold)"
        tierLabel="Gold"
        eyebrow="Badge unlocked"
        title="Century Club"
        category="Collection"
        description="Log 100 games to your library."
        progressDots={{ total: 3, filled: 3 }}
        primaryCta="Share it"
        dismissCta="Not now"
      />

      <section>
        <h2 className="text-title">Live ProgressStrip (needs auth + data)</h2>
        <ProgressStrip />
      </section>
    </div>
  )
}
