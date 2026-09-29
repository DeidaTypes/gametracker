import { STATUS_META } from '../StatusChip'

// The four status cells of the My Games dashboard, in render order.
// `listId` is the localStorage tracker bucket (see libraryService.DEFAULT_LISTS)
// and `key` is the status tag carried on each combined game as `_status`.
// Own-Library data assembly still owns those buckets; the other-user
// screen only uses `key` / `label`.
export const STATUS_CELLS = [
  { key: 'want', label: STATUS_META.want.label, listId: 'want-to-play' },
  { key: 'currently', label: 'Playing', listId: 'currently-playing' },
  { key: 'played', label: STATUS_META.played.label, listId: 'played' },
  { key: 'dropped', label: STATUS_META.dropped.label, listId: 'dropped' },
]

// Sort options — only sorts backed by a real field on every game.
export const LIBRARY_SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title A–Z' },
]

// View options — independent of sort. Stored in localStorage so the
// choice survives navigation and a full restart (same pattern as
// Profile's gt:profile-sort:v1 preference).
export const LIBRARY_VIEWS = [
  { key: 'grid', label: 'Grid' },
  { key: 'list', label: 'List' },
]

export const LIBRARY_VIEW_LS_KEY = 'gt:library-view:v1'

export function readLibraryView() {
  try {
    const raw = localStorage.getItem(LIBRARY_VIEW_LS_KEY)
    if (raw === 'list' || raw === 'grid') return raw
  } catch {
    // localStorage unavailable (private browsing, quota, etc.)
  }
  return 'grid'
}

export function writeLibraryView(view) {
  if (view !== 'list' && view !== 'grid') return
  try {
    localStorage.setItem(LIBRARY_VIEW_LS_KEY, view)
  } catch {
    // localStorage unavailable — in-memory state still applies this session
  }
}

// Session UI for Library's own screen: which segment (My Games / Lists)
// and which status filter (Backlog / Playing / Played / Dropped, or none)
// were on screen. Session, not local: this is "where I was just now",
// not a preference that should outlive the tab. View (grid/list) stays
// in localStorage above; sort does not persist at all.
export const LIBRARY_UI_SESSION_KEY = 'gt:library-ui:v1'

const LIBRARY_UI_TABS = new Set(['games', 'lists'])
const LIBRARY_UI_STATUSES = new Set(['want', 'currently', 'played', 'dropped'])

const DEFAULT_LIBRARY_UI = { tab: 'games', status: null }

export function readLibraryUi() {
  try {
    const raw = sessionStorage.getItem(LIBRARY_UI_SESSION_KEY)
    if (!raw) return { ...DEFAULT_LIBRARY_UI }
    const parsed = JSON.parse(raw)
    return {
      tab: LIBRARY_UI_TABS.has(parsed?.tab) ? parsed.tab : 'games',
      status: LIBRARY_UI_STATUSES.has(parsed?.status) ? parsed.status : null,
    }
  } catch {
    return { ...DEFAULT_LIBRARY_UI }
  }
}

export function writeLibraryUi(patch) {
  const current = readLibraryUi()
  const next = { ...current }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'tab')) {
    if (LIBRARY_UI_TABS.has(patch.tab)) next.tab = patch.tab
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) {
    next.status = LIBRARY_UI_STATUSES.has(patch.status) ? patch.status : null
  }
  try {
    sessionStorage.setItem(LIBRARY_UI_SESSION_KEY, JSON.stringify(next))
  } catch {
    // sessionStorage unavailable — in-memory state still applies until unmount
  }
  return next
}

// Per history entry, so a back navigation can tell "this is the Library I
// left" from "the tab bar just pushed a new /library". Stored with
// replaceState — never navigate() — so location.key does not change.
// useNavigationType() cannot make this distinction: AnimatedRoutes renders
// <Routes location={layer.location}>, and React Router forces that scoped
// location context's navigationType to POP for every page.
const LIBRARY_HISTORY_FIELD = 'gtLibrary'

function sanitizeLibraryUi(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!LIBRARY_UI_TABS.has(raw.tab)) return null
  return {
    tab: raw.tab,
    status: LIBRARY_UI_STATUSES.has(raw.status) ? raw.status : null,
  }
}

export function readLibraryHistoryUi() {
  try {
    return sanitizeLibraryUi(window.history.state?.[LIBRARY_HISTORY_FIELD])
  } catch {
    return null
  }
}

export function writeLibraryHistoryUi(ui) {
  const safe = sanitizeLibraryUi(ui)
  if (!safe) return
  try {
    const prev = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {}
    window.history.replaceState({ ...prev, [LIBRARY_HISTORY_FIELD]: safe }, '')
  } catch {
    // history unavailable — sessionStorage still holds the latest choice
  }
}

// Called from Library's useState initializer. A stamped entry is the one
// the user left (back, including swipe-back): restore it on the first
// frame. An unstamped entry is a fresh visit — bottom nav, deep link —
// which keeps the remembered tab and starts the status filter on All.
export function resolveLibraryUiForMount() {
  const stamped = readLibraryHistoryUi()
  if (stamped) {
    writeLibraryUi(stamped)
    return stamped
  }
  const next = { tab: readLibraryUi().tab, status: null }
  writeLibraryUi(next)
  writeLibraryHistoryUi(next)
  return next
}

export const LIBRARY_PAGE_SIZE = 30
