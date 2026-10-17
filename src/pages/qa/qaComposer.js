import { supabase } from '../../services/supabase'
import { coverUrlFromImageId } from '../../services/igdb'
import { getGameStatus, getGamesFromList } from '../../services/libraryService'

/**
 * Ask / answer composer session.
 * Lives in memory for as long as the sheet is open, including while a
 * pushed question covers it and while the app is backgrounded.
 * Not localStorage — closing or discarding drops it.
 */

export const QA_TITLE_MIN = 10
export const QA_TITLE_MAX = 120
export const QA_BODY_MAX = 2000
export const QA_LOCATION_MAX = 40
export const QA_PLATFORM_MAX = 40
export const QA_ANSWER_MAX = 3000

const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000
const LIMITS = {
  question: { fresh: 3, established: 10 },
  answer: { fresh: 15, established: 50 },
}

const NOTICE_COLUMN = 'qa_public_notice_at'
const NOTICE_LOCAL_KEY = 'gt:qa-public-notice:v1'

let session = null
let parked = null
const listeners = new Set()
let trackerPlatformSupported = true
let noticeColumn = 'unknown'

function emit() {
  const snapshot = session
  for (const fn of listeners) fn(snapshot)
}

export function getQaComposerSession() {
  return session
}

export function subscribeQaComposer(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function coverImageIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/\/t_[^/]+\/([^./?#]+)/)
  return match ? match[1] : null
}

export function qaGamePreset(game) {
  if (!game) return null
  const igdbId = Number(game.igdbId ?? game.igdb_game_id ?? game.id)
  const title = String(game.title ?? game.game_title ?? game.name ?? '').trim()
  if (!Number.isInteger(igdbId) || igdbId <= 0 || !title) return null
  const fromUrl = coverImageIdFromUrl(game.coverUrl || game.image || game.game_image)
  const coverImageId = game.coverImageId || game.game_cover_image_id || fromUrl || null
  const coverUrl =
    game.coverUrl ||
    game.image ||
    (coverImageId ? coverUrlFromImageId(String(coverImageId), 'cover_small') : null)
  let fromLibrary = game.fromLibrary
  if (fromLibrary == null) fromLibrary = getGameStatus(igdbId) != null
  return {
    igdbId,
    title,
    coverImageId: coverImageId ? String(coverImageId) : null,
    coverUrl: coverUrl || null,
    fromLibrary: !!fromLibrary,
  }
}

function blankAskDraft(title, game) {
  return {
    step: game ? 'compose' : 'pick',
    game,
    title: title || '',
    body: '',
    location: '',
    topic: '',
    isSpoiler: false,
    search: '',
    platform: '',
    platformMode: null,
    platformOptions: [],
    platformTouched: false,
  }
}

export function openQaAsk({ title = '', game = null } = {}) {
  parked = null
  const presetGame = game ? qaGamePreset(game) : null
  session = {
    mode: 'ask',
    openedAt: Date.now(),
    hiddenFor: null,
    limit: null,
    presetTitle: String(title || ''),
    draft: blankAskDraft(String(title || ''), presetGame),
  }
  emit()
}

export function openQaAnswer({
  questionId,
  questionTitle = '',
  igdbGameId = null,
  replyToUserId = null,
  replyToUsername = null,
} = {}) {
  if (!questionId) return
  if (session?.mode === 'ask') parked = session
  const username = replyToUsername ? String(replyToUsername) : ''
  session = {
    mode: 'answer',
    openedAt: Date.now(),
    hiddenFor: null,
    limit: null,
    questionId,
    questionTitle: String(questionTitle || ''),
    igdbGameId: igdbGameId == null || igdbGameId === '' ? null : Number(igdbGameId),
    replyToUserId: username ? replyToUserId || null : null,
    replyToUsername: username || null,
    draft: {
      body: username ? `@${username} ` : '',
      isSpoiler: false,
      replyOn: !!username,
    },
  }
  emit()
}

export function patchQaDraft(partial) {
  if (!session) return
  session = { ...session, draft: { ...session.draft, ...partial } }
  emit()
}

export function setQaComposerLimit(limit) {
  if (!session) return
  session = { ...session, limit }
  emit()
}

export function hideQaComposerFor(questionId) {
  if (!session || !questionId) return
  session = { ...session, hiddenFor: questionId }
  emit()
}

export function revealQaComposer() {
  if (!session?.hiddenFor) return
  session = { ...session, hiddenFor: null }
  emit()
}

export function closeQaComposer() {
  if (parked) {
    session = parked
    parked = null
    emit()
    return
  }
  if (!session) return
  session = null
  emit()
}

export function askIsDirty(draft) {
  if (!draft) return false
  if ([draft.title, draft.body, draft.location, draft.search].some((value) => String(value || '').trim())) {
    return true
  }
  if (draft.platformMode === 'text' && String(draft.platform || '').trim()) return true
  if (draft.platformTouched && String(draft.platform || '').trim()) return true
  return false
}

export function answerIsDirty(sessionSnapshot) {
  const draft = sessionSnapshot?.draft
  if (!draft) return false
  let body = String(draft.body || '')
  if (draft.replyOn && sessionSnapshot.replyToUsername) {
    const prefix = `@${sessionSnapshot.replyToUsername} `
    if (body.startsWith(prefix)) body = body.slice(prefix.length)
  }
  return body.trim().length > 0
}

export function libraryPickLists() {
  const playing = getGamesFromList('currently-playing').filter((game) => game?.title)
  const playingIds = new Set(playing.map((game) => String(game.id)))
  const played = getGamesFromList('played')
    .filter((game) => game?.title && !playingIds.has(String(game.id)))
    .slice()
    .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
  return { playing, played: played.slice(0, 20) }
}

export function limitRule(createdAt, kind) {
  const created = createdAt ? new Date(createdAt).getTime() : NaN
  const isNew = Number.isFinite(created) && Date.now() - created < NEW_ACCOUNT_MS
  const caps = LIMITS[kind] || LIMITS.question
  return { kind, isNew, cap: isNew ? caps.fresh : caps.established }
}

export function limitBanner({ kind, cap, isNew }) {
  const noun = kind === 'answer' ? 'answers' : 'questions'
  const verb = kind === 'answer' ? "You've posted" : "You've asked"
  const again = kind === 'answer' ? 'answer' : 'ask'
  const who = isNew ? ' for new accounts' : ''
  return `${verb} ${cap} ${noun} today, the daily limit${who}. You can ${again} again tomorrow.`
}

export async function qaUsageToday(userId, kind) {
  if (!userId) return null
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const table = kind === 'answer' ? 'qa_answers' : 'qa_questions'
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('created_at', since)
  if (error) return null
  return count ?? 0
}

function cleanNames(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const names = []
  for (const entry of value) {
    const name = String(entry || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

async function loadTagPlatforms(igdbId) {
  const { data, error } = await supabase
    .from('game_tags')
    .select('platform_names')
    .eq('igdb_game_id', Number(igdbId))
    .maybeSingle()
  if (error || !data) return []
  return cleanNames(data.platform_names)
}

async function loadTrackerPlatform(igdbId) {
  if (!trackerPlatformSupported) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('game_trackers')
    .select('platform')
    .eq('user_id', user.id)
    .eq('igdb_game_id', String(igdbId))
    .maybeSingle()
  if (error) {
    trackerPlatformSupported = false
    return null
  }
  const value = typeof data?.platform === 'string' ? data.platform.trim() : ''
  return value || null
}

/** Picker from game_tags.platform_names, else the tracker's platform, else plain text. */
export async function loadPlatformChoices(igdbId) {
  const [names, tracked] = await Promise.all([
    loadTagPlatforms(igdbId),
    loadTrackerPlatform(igdbId),
  ])
  if (names.length) {
    const selected = tracked && names.includes(tracked) ? tracked : names[0]
    return { mode: 'list', options: names, selected }
  }
  if (tracked) return { mode: 'list', options: [tracked], selected: tracked }
  return { mode: 'text', options: [], selected: '' }
}

export async function loadPlatformLabels(igdbIds) {
  const ids = [...new Set(igdbIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('game_tags')
    .select('igdb_game_id, platform_names')
    .in('igdb_game_id', ids)
  if (error || !Array.isArray(data)) return new Map()
  const map = new Map()
  for (const row of data) {
    const first = cleanNames(row.platform_names)[0]
    if (first) map.set(String(row.igdb_game_id), first)
  }
  return map
}

function readLocalNotice(userId) {
  try {
    const raw = localStorage.getItem(NOTICE_LOCAL_KEY)
    const map = raw ? JSON.parse(raw) : null
    return !!(map && typeof map === 'object' && map[userId])
  } catch {
    return false
  }
}

function writeLocalNotice(userId) {
  try {
    const raw = localStorage.getItem(NOTICE_LOCAL_KEY)
    const map = raw ? JSON.parse(raw) : {}
    const next = map && typeof map === 'object' ? map : {}
    next[userId] = true
    localStorage.setItem(NOTICE_LOCAL_KEY, JSON.stringify(next))
  } catch {
    // The flag is tiny. A full or blocked store just shows the notice again.
  }
}

export async function qaPublicNoticeSeen(userId) {
  if (!userId) return false
  if (readLocalNotice(userId)) return true
  if (noticeColumn === 'no') return false
  try {
    const { data, error } = await supabase
      .from('users')
      .select(NOTICE_COLUMN)
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      noticeColumn = 'no'
      return false
    }
    noticeColumn = 'yes'
    return !!data?.[NOTICE_COLUMN]
  } catch {
    noticeColumn = 'no'
    return false
  }
}

export async function rememberQaPublicNotice(userId) {
  if (userId) writeLocalNotice(userId)
  if (!userId || noticeColumn === 'no') return
  try {
    const { error } = await supabase
      .from('users')
      .update({ [NOTICE_COLUMN]: new Date().toISOString() })
      .eq('id', userId)
    if (error) noticeColumn = 'no'
    else noticeColumn = 'yes'
  } catch {
    noticeColumn = 'no'
  }
}

/** True when this account already has a question or an answer. A failed read counts as first post. */
export async function hasAnyQaPost(userId) {
  if (!userId) return false
  const [questions, answers] = await Promise.all([
    supabase.from('qa_questions').select('id').eq('user_id', userId).limit(1),
    supabase.from('qa_answers').select('id').eq('user_id', userId).limit(1),
  ])
  if (questions.error || answers.error) return false
  return (questions.data?.length || 0) > 0 || (answers.data?.length || 0) > 0
}
