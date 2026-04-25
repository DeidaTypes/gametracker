const STORAGE_KEY = 'userActivity'
const MAX_EVENTS = 50
const DEDUP_WINDOW_MS = 60_000

const STATUS_LABELS = {
  want: 'Want to Play',
  currently: 'Currently Playing',
  played: 'Played',
}

function readEvents() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function writeEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Append an activity event. Deduplicates same-type + same-game events
 * within DEDUP_WINDOW_MS by replacing the older entry instead of adding a new one.
 */
export function logActivity(type, gameId, title, metadata = {}) {
  const events = readEvents()
  const now = Date.now()

  const dupeIdx = events.findIndex(
    (e) =>
      e.type === type &&
      String(e.gameId) === String(gameId) &&
      now - new Date(e.timestamp).getTime() < DEDUP_WINDOW_MS,
  )

  const event = {
    id: dupeIdx !== -1 ? events[dupeIdx].id : makeId(),
    type,
    gameId: String(gameId),
    title,
    timestamp: new Date().toISOString(),
    metadata,
  }

  if (dupeIdx !== -1) {
    events[dupeIdx] = event
  } else {
    events.unshift(event)
  }

  writeEvents(events.slice(0, MAX_EVENTS))
  window.dispatchEvent(new Event('activityUpdated'))
}

export function getRecentActivity(limit = 10) {
  return readEvents().slice(0, limit)
}

export function clearActivity() {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('activityUpdated'))
}

export function formatActivityMessage(event) {
  switch (event.type) {
    case 'review': {
      const stars = '★'.repeat(Math.round(event.metadata.rating || 0))
      return `Rated ${event.title} ${stars}`
    }
    case 'hours_logged':
      return `Logged ${event.metadata.hours}h in ${event.title}`
    case 'status_change':
      return `Moved ${event.title} to ${STATUS_LABELS[event.metadata.newStatus] || event.metadata.newStatus}`
    default:
      return `Updated ${event.title}`
  }
}
