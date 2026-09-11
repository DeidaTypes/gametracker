import { formatActivityDate } from './formatActivityDate'

function playedOnToDate(playedOn) {
  if (!playedOn) return null
  const [y, mo, d] = playedOn.split('-').map(Number)
  return new Date(y, mo - 1, d, 12, 0, 0)
}

function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatSessionHours(hours) {
  const n = Number(hours) || 0
  const rounded = Math.round(n * 100) / 100
  const label = rounded % 1 === 0 ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${label}h`
}

export function formatHeroHours(hours) {
  const n = Number(hours) || 0
  const rounded = Math.round(n * 100) / 100
  if (rounded % 1 === 0) return `${rounded}`
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatSessionClockTime(session) {
  const iso = session.createdAt || session.startedAt
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDayGroupLabel(playedOn) {
  const date = playedOnToDate(playedOn)
  if (!date) return ''

  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (localDateKey(date) === localDateKey(today)) return 'TODAY'
  if (localDateKey(date) === localDateKey(yesterday)) return 'YESTERDAY'

  const daysDiff = Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))
  if (daysDiff > 0 && daysDiff < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()
  }

  return date
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

export function groupSessionsByDay(sessions) {
  const groups = new Map()

  for (const session of sessions) {
    const key = session.playedOn || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(session)
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([playedOn, daySessions]) => ({
      playedOn,
      label: formatDayGroupLabel(playedOn),
      sessions: [...daySessions].sort((a, b) => {
        const aTs = new Date(a.createdAt || a.startedAt || 0).getTime()
        const bTs = new Date(b.createdAt || b.startedAt || 0).getTime()
        return bTs - aTs
      }),
      totalHours: daySessions.reduce((sum, s) => sum + (Number(s.hours) || 0), 0),
    }))
}

export function buildSevenDaySparkline(sessions) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push({ key: localDateKey(d), hours: 0 })
  }

  for (const session of sessions) {
    const key = session.playedOn
    const bucket = days.find((d) => d.key === key)
    if (bucket) bucket.hours += Number(session.hours) || 0
  }

  const maxHours = Math.max(...days.map((d) => d.hours), 0)

  return days.map((d) => ({
    ...d,
    fraction: maxHours > 0 ? d.hours / maxHours : 0,
  }))
}

export function getSessionStats(sessions) {
  const count = sessions.length
  const longest = count
    ? Math.max(...sessions.map((s) => Number(s.hours) || 0))
    : 0
  const latest = sessions[0] || null
  const lastPlayed = latest
    ? formatActivityDate(playedOnToDate(latest.playedOn))
    : ''

  return { count, longest, lastPlayed }
}
