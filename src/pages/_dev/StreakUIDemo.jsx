import React, { useMemo, useState } from 'react'
import HomeStreakStrip from '../../components/home/HomeStreakStrip'
import StreakDetailSheet from '../../components/streak/StreakDetailSheet'
import UnlockCelebration from '../../components/celebration/UnlockCelebration'
import { buildStreakMilestoneView } from '../../services/streakMilestoneState'
import '../../components/home/HomeStreakStrip.css'
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
    progressToNext,
    weekCells,
    hasRestDayShield,
    hasStreak,
  } = view
  const progressPct = Math.round(progressToNext * 100)

  return (
    <div
      className={['hss', !hasStreak ? 'hss--zero' : ''].filter(Boolean).join(' ')}
    >
      <div className="hss-hero">
        <div className="hss-hero-left">
          <span className="hss-count text-display-l">{currentStreak}</span>
        </div>
        {currentTier && <span className="hss-tier-pill text-label">{currentTier.name}</span>}
      </div>
      {nextTier && hasStreak && (
        <div className="hss-progress-block">
          <div className="hss-progress-track">
            <div className="hss-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="hss-next text-caption">{daysToNextTier} days to {nextTier.name}</p>
        </div>
      )}
      <div className="hss-calendar">
        <div className="hss-pips">
          {weekCells.map((cell) => (
            <span
              key={cell.key}
              className={[
                'hss-pip',
                hasStreak && cell.active ? 'hss-pip--active' : '',
                cell.isToday ? 'hss-pip--today' : '',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>
      </div>
      {hasRestDayShield && (
        <div className="hss-shield text-label">Rest-day shield available</div>
      )}
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
        <h2 className="text-title">Live HomeStreakStrip (needs auth + data)</h2>
        <HomeStreakStrip />
      </section>
    </div>
  )
}
