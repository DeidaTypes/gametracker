import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { HiArrowLeft } from 'react-icons/hi'
import { useAuth } from '../contexts/AuthContext'
import { getProfile, initializeProfile } from '../services/profileService'
import {
  getStatsLocalSync,
  getCachedActivityCalendar,
  invalidateActivityCache,
  computeStreaks,
  buildHeatmapGrid,
  activityIntensity,
  parseLocalDateKey,
} from '../services/statsService'
import SharedCover, { SharedCoverScope } from '../components/SharedCover'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Stats.css'

/**
 * Genre → color map. Aligned with profile.jsx's `getGenreColor` so the
 * same genre paints with the same hue everywhere it surfaces (Profile
 * tags, donut wedges, future genre tiles). Low-saturation tints play
 * nicely against the deep navy background without competing with cover
 * art for attention.
 */
function genreToColor(genre) {
  if (!genre) return '#3F4A5A'
  const s = genre.toLowerCase()
  if (s.includes('role-playing') || s.includes('rpg')) return '#7B6B9A'
  if (s.includes('adventure')) return '#5F8F7F'
  if (s.includes('strategy') || s.includes('tactical')) return '#5F7386'
  if (s.includes('action')) return '#9B7A6E'
  if (s.includes('shoot')) return '#6A6A7A'
  if (s.includes('sport')) return '#5A8F5F'
  if (s.includes('racing') || s.includes('drive')) return '#8A7048'
  if (s.includes('fight')) return '#8C5A5A'
  if (s.includes('puzzle') || s.includes('logic')) return '#5A6A8C'
  if (s.includes('simulat')) return '#5F7080'
  if (s.includes('horror') || s.includes('survival')) return '#4D4D5A'
  if (s.includes('platform')) return '#5A6A5A'
  if (s.includes('indie')) return '#6A5A7A'
  if (s.includes('arcade')) return '#8A6E48'
  if (s.includes('music') || s.includes('rhythm')) return '#7A5A8A'
  if (s.includes('visual novel') || s.includes('point') || s.includes('click'))
    return '#6E5A8A'
  if (s.includes('card') || s.includes('board')) return '#5F8A7E'
  if (s.includes('pinball')) return '#8A6A4A'
  if (s.includes('quiz') || s.includes('trivia')) return '#5A8AAA'
  if (s.includes('moba') || s.includes('arena')) return '#7A8A5A'
  return '#5A6A7E'
}

const OTHER_COLOR = '#3F4A5A'

function formatMemberSince(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  } catch {
    return null
  }
}

function formatHumanDate(iso) {
  if (!iso) return ''
  try {
    return parseLocalDateKey(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function pluralize(n, one, many) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`
}

/* ─────────────────────────────────────────────────────────────
   Donut chart — "Where your time goes"
   ───────────────────────────────────────────────────────────── */

function HoursByGenreDonut({ hoursByGenre }) {
  const data = useMemo(() => {
    const entries = Object.entries(hoursByGenre || {})
      .map(([genre, hours]) => ({
        name: genre,
        value: Math.round((parseFloat(hours) || 0) * 10) / 10,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)

    if (entries.length <= 7) return entries

    const top = entries.slice(0, 6)
    const otherTotal = entries
      .slice(6)
      .reduce((acc, d) => acc + d.value, 0)
    if (otherTotal > 0) {
      top.push({
        name: 'Other',
        value: Math.round(otherTotal * 10) / 10,
        isOther: true,
      })
    }
    return top
  }, [hoursByGenre])

  const totalHours = useMemo(
    () => data.reduce((acc, d) => acc + d.value, 0),
    [data]
  )

  if (data.length === 0) {
    return (
      <div className="stats-card stats-empty-card">
        <p className="stats-empty-copy">
          Log hours on a Played game to start mapping your time across genres.
        </p>
      </div>
    )
  }

  return (
    <div className="stats-card stats-donut-card">
      <div className="stats-donut-chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={72}
              outerRadius={112}
              paddingAngle={1}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.name}
                  fill={d.isOther ? OTHER_COLOR : genreToColor(d.name)}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="stats-donut-center" aria-hidden="true">
          <div className="stats-donut-center-num">
            {Math.round(totalHours)}
          </div>
          <div className="stats-donut-center-label">total hours</div>
        </div>
      </div>

      <ul className="stats-genre-legend">
        {data.map((d) => {
          const pct = totalHours > 0 ? Math.round((d.value / totalHours) * 100) : 0
          return (
            <li key={d.name} className="stats-genre-legend-item">
              <span
                className="stats-genre-swatch"
                style={{
                  background: d.isOther ? OTHER_COLOR : genreToColor(d.name),
                }}
                aria-hidden="true"
              />
              <span className="stats-genre-name">{d.name}</span>
              <span className="stats-genre-hours">
                {Math.round(d.value)}h
                <span className="stats-genre-pct"> · {pct}%</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Most played — horizontal bar chart
   ───────────────────────────────────────────────────────────── */

function MostPlayedBars({ topByHours, onGameClick }) {
  const top10 = useMemo(() => topByHours.slice(0, 10), [topByHours])
  const max = useMemo(
    () => top10.reduce((m, g) => (g.hours > m ? g.hours : m), 0),
    [top10]
  )

  if (top10.length === 0) {
    return (
      <div className="stats-card stats-empty-card">
        <p className="stats-empty-copy">
          No hours logged yet — open any game and log time played to see your
          top 10 here.
        </p>
      </div>
    )
  }

  return (
    <ol className="stats-top-list">
      {top10.map((g, i) => {
        const pct = max > 0 ? Math.max(4, (g.hours / max) * 100) : 0
        return (
          <li key={g.id} className="stats-top-row">
            <button
              className="stats-top-row-btn"
              onClick={() => onGameClick(g.id, g.image)}
              aria-label={`${g.title} — ${g.hours} hours`}
            >
              <span className="stats-top-rank">{i + 1}</span>
              <div className="stats-top-cover">
                {g.image ? (
                  <SharedCover gameId={g.id} imageSrc={g.image}>
                    <img src={g.image} alt="" loading="lazy" />
                  </SharedCover>
                ) : (
                  <span aria-hidden="true">{g.title.charAt(0)}</span>
                )}
              </div>
              <div className="stats-top-meta">
                <span className="stats-top-title">{g.title}</span>
                <div className="stats-top-bar-track">
                  <div
                    className="stats-top-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="stats-top-hours">{g.hours}h</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/* ─────────────────────────────────────────────────────────────
   Streak callout + heatmap
   ───────────────────────────────────────────────────────────── */

function StreakCard({ current, longest }) {
  return (
    <div className="stats-card stats-streak-card">
      <span className="stats-eyebrow">Current streak</span>
      <div className="stats-streak-num">{current}</div>
      <div className="stats-streak-sub">
        {pluralize(current, 'day', 'days')} ·{' '}
        <span className="stats-streak-longest">
          longest: {pluralize(longest, 'day', 'days')}
        </span>
      </div>
    </div>
  )
}

function YTDHeatmap({ cells }) {
  const [tooltip, setTooltip] = useState(null)

  const weeks = useMemo(() => {
    const out = []
    for (let w = 0; w < 53; w++) {
      out.push(cells.slice(w * 7, (w + 1) * 7))
    }
    return out
  }, [cells])

  // Month labels — render the month name above the first column of
  // each month change. Keeps the timeline readable without crowding.
  const monthLabels = useMemo(() => {
    const out = []
    let lastMonth = null
    for (let w = 0; w < weeks.length; w++) {
      const firstCell = weeks[w][0]
      if (!firstCell) continue
      const month = parseLocalDateKey(firstCell.date).getMonth()
      if (month !== lastMonth) {
        out.push({
          col: w,
          label: parseLocalDateKey(firstCell.date).toLocaleString('en-US', {
            month: 'short',
          }),
        })
        lastMonth = month
      }
    }
    return out
  }, [weeks])

  const handleEnter = (cell, evt) => {
    if (cell.inFuture) return
    setTooltip({
      date: cell.date,
      count: cell.count,
      x: evt.currentTarget.offsetLeft + evt.currentTarget.offsetWidth / 2,
      y: evt.currentTarget.offsetTop,
    })
  }
  const handleLeave = () => setTooltip(null)

  const totalActivities = useMemo(
    () => cells.reduce((acc, c) => acc + (c.inFuture ? 0 : c.count), 0),
    [cells]
  )

  return (
    <div className="stats-card stats-heatmap-card">
      <div className="stats-heatmap-meta">
        <span className="stats-heatmap-total">
          {totalActivities.toLocaleString()}{' '}
          {totalActivities === 1 ? 'activity' : 'activities'} this year
        </span>
        <div className="stats-heatmap-key">
          <span className="stats-heatmap-key-label">Less</span>
          <span
            className="stats-heatmap-cell stats-heatmap-cell--key"
            data-level="0"
          />
          <span
            className="stats-heatmap-cell stats-heatmap-cell--key"
            data-level="1"
          />
          <span
            className="stats-heatmap-cell stats-heatmap-cell--key"
            data-level="2"
          />
          <span
            className="stats-heatmap-cell stats-heatmap-cell--key"
            data-level="3"
          />
          <span className="stats-heatmap-key-label">More</span>
        </div>
      </div>

      <div className="stats-heatmap-scroll">
        <div className="stats-heatmap-grid-wrap">
          <div className="stats-heatmap-months" aria-hidden="true">
            {monthLabels.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                className="stats-heatmap-month-label"
                style={{ gridColumn: `${m.col + 1} / span 1` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="stats-heatmap-grid" role="grid" aria-label="Activity heatmap">
            {weeks.map((week, wi) => (
              <div key={wi} className="stats-heatmap-week" role="row">
                {week.map((cell, di) => {
                  if (cell.inFuture) {
                    return (
                      <span
                        key={cell.date}
                        className="stats-heatmap-cell stats-heatmap-cell--future"
                        aria-hidden="true"
                      />
                    )
                  }
                  const level = activityIntensity(cell.count)
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      className="stats-heatmap-cell"
                      data-level={level}
                      aria-label={`${formatHumanDate(cell.date)} — ${pluralize(cell.count, 'activity', 'activities')}`}
                      onMouseEnter={(e) => handleEnter(cell, e)}
                      onMouseLeave={handleLeave}
                      onFocus={(e) => handleEnter(cell, e)}
                      onBlur={handleLeave}
                    />
                  )
                })}
              </div>
            ))}

            {tooltip && (
              <div
                role="tooltip"
                className="stats-heatmap-tooltip"
                style={{ left: tooltip.x, top: tooltip.y - 8 }}
              >
                <div className="stats-heatmap-tooltip-date">
                  {formatHumanDate(tooltip.date)}
                </div>
                <div className="stats-heatmap-tooltip-count">
                  {pluralize(tooltip.count, 'activity', 'activities')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */

function Stats() {
  const navigate = useNavigate()
  const { user, profile: authProfile } = useAuth()

  const [localProfile, setLocalProfile] = useState(() => getProfile() || initializeProfile())
  const [stats, setStats] = useState(() => getStatsLocalSync())
  const [calendar, setCalendar] = useState(new Map())
  const [calendarLoading, setCalendarLoading] = useState(true)

  // Re-read local stats whenever something downstream fires the
  // shared change events Profile already listens for. Keeps the
  // numbers in sync when the user edits a tracker mid-session.
  useEffect(() => {
    const refresh = () => {
      setLocalProfile(getProfile() || initializeProfile())
      setStats(getStatsLocalSync())
    }
    window.addEventListener('storage', refresh)
    window.addEventListener('reviewAdded', refresh)
    window.addEventListener('profileUpdated', refresh)
    window.addEventListener('libraryUpdated', refresh)
    window.addEventListener('activityUpdated', refresh)
    window.addEventListener(APP_RESUMED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('reviewAdded', refresh)
      window.removeEventListener('profileUpdated', refresh)
      window.removeEventListener('libraryUpdated', refresh)
      window.removeEventListener('activityUpdated', refresh)
      window.removeEventListener(APP_RESUMED_EVENT, refresh)
    }
  }, [])

  // Activity calendar — backed by getCachedActivityCalendar so a
  // visit-after-visit-after-visit dance (Profile tile → /stats → back
  // → another tile → /stats) reuses the same fetch for up to 5 min.
  // Anything that conceptually invalidates the heatmap (status change,
  // new review, list edit) drops the cache and re-fetches so the
  // shimmer-to-fresh transition is visible immediately.
  useEffect(() => {
    if (!user?.id) {
      setCalendar(new Map())
      setCalendarLoading(false)
      return
    }
    let cancelled = false
    const load = async ({ bustCache } = {}) => {
      if (bustCache) invalidateActivityCache()
      setCalendarLoading(true)
      try {
        const map = await getCachedActivityCalendar(user.id, 400)
        if (!cancelled) {
          setCalendar(map)
        }
      } finally {
        if (!cancelled) setCalendarLoading(false)
      }
    }
    load()
    const onActivity = () => load({ bustCache: true })
    window.addEventListener('activityUpdated', onActivity)
    window.addEventListener('reviewAdded', onActivity)
    window.addEventListener('libraryUpdated', onActivity)
    // Resume busts the cache as well: the 5-minute window it exists to serve
    // is about repeat navigation within one session, not across a suspension.
    window.addEventListener(APP_RESUMED_EVENT, onActivity)
    return () => {
      cancelled = true
      window.removeEventListener('activityUpdated', onActivity)
      window.removeEventListener('reviewAdded', onActivity)
      window.removeEventListener('libraryUpdated', onActivity)
      window.removeEventListener(APP_RESUMED_EVENT, onActivity)
    }
  }, [user?.id])

  const streaks = useMemo(() => computeStreaks(calendar), [calendar])
  const heatmapCells = useMemo(() => buildHeatmapGrid(calendar), [calendar])

  const displayName = localProfile?.displayName || 'Your'
  const memberSince =
    formatMemberSince(authProfile?.created_at) ||
    formatMemberSince(localProfile?.createdAt) ||
    'this year'

  const handleGameClick = (id, image) =>
    navigate(`/game/${id}`, image ? { state: { coverImage: image } } : undefined)

  const possessive = displayName.endsWith('s') ? `${displayName}'` : `${displayName}'s`

  // Low-data threshold — per spec, until the user has at least 3
  // Played games we hide the donut, bar chart, streak callout, and
  // heatmap. The headline numerals work fine at low data (zero is
  // a real, useful number) so they stay visible.
  const isLowData = stats.playedCount < 3

  return (
    <SharedCoverScope>
      <div className="stats-page">
        <header className="stats-topbar">
          <button
            type="button"
            className="stats-back-btn"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <HiArrowLeft aria-hidden="true" />
          </button>
        </header>

        <section className="stats-hero">
          <h1 className="stats-hero-title text-display-xl">
            {possessive} year in games
          </h1>
          <p className="stats-hero-sub text-body">
            Tracking since {memberSince}
          </p>
        </section>

        <section className="stats-section">
          <div className="stats-headline-grid">
            <article className="stats-card stats-headline-card">
              <span className="stats-headline-num">{stats.playedCount}</span>
              <span className="stats-headline-label">Games played</span>
            </article>
            <article className="stats-card stats-headline-card">
              <span className="stats-headline-num">{stats.hoursPlayed}</span>
              <span className="stats-headline-label">Hours played</span>
            </article>
            <article className="stats-card stats-headline-card">
              <span className="stats-headline-num">{stats.playingCount}</span>
              <span className="stats-headline-label">In progress</span>
            </article>
            <article className="stats-card stats-headline-card">
              <span className="stats-headline-num">{stats.reviewCount}</span>
              <span className="stats-headline-label">Reviews written</span>
            </article>
          </div>
        </section>

        {isLowData ? (
          <section className="stats-section">
            <div className="stats-card stats-lowdata-card">
              <span className="stats-eyebrow">Coming soon</span>
              <h2 className="text-display-l stats-lowdata-title">
                Stats unlock as you play
              </h2>
              <p className="stats-lowdata-copy">
                Mark a few games as Played to see your patterns — your
                top genres, longest streaks, and where the hours go.
              </p>
              <button
                type="button"
                className="stats-lowdata-cta"
                onClick={() => navigate('/library')}
              >
                Go to Library →
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="stats-section">
              <header className="stats-section-header">
                <span className="stats-eyebrow">Where your time goes</span>
                <h2 className="text-display-l stats-section-title">Hours by genre</h2>
              </header>
              <HoursByGenreDonut hoursByGenre={stats.hoursByGenre} />
            </section>

            <section className="stats-section">
              <header className="stats-section-header">
                <span className="stats-eyebrow">Most played</span>
                <h2 className="text-display-l stats-section-title">Top 10 by hours</h2>
              </header>
              <MostPlayedBars
                topByHours={stats.topByHours}
                onGameClick={handleGameClick}
              />
            </section>

            <section className="stats-section">
              {calendarLoading ? (
                <div className="stats-card stats-streak-card stats-streak-skeleton">
                  <div className="skeleton stats-streak-skel-eyebrow" />
                  <div className="skeleton stats-streak-skel-num" />
                  <div className="skeleton stats-streak-skel-sub" />
                </div>
              ) : (
                <StreakCard current={streaks.current} longest={streaks.longest} />
              )}
            </section>

            <section className="stats-section">
              <header className="stats-section-header">
                <span className="stats-eyebrow">Year to date</span>
                <h2 className="text-display-l stats-section-title">
                  Activity heatmap
                </h2>
              </header>
              {calendarLoading ? (
                <div className="stats-card stats-heatmap-card stats-heatmap-skeleton">
                  <div className="skeleton stats-heatmap-skel-bar" />
                  <div className="skeleton stats-heatmap-skel-grid" />
                </div>
              ) : (
                <YTDHeatmap cells={heatmapCells} />
              )}
            </section>
          </>
        )}
      </div>
    </SharedCoverScope>
  )
}

export default Stats
