import { supabase } from './supabase'
import { isFlagEnabled } from './flagService'
import {
  markSWRStale,
  markSWRStaleByPrefix,
  mutateSWRByPrefix,
  peekSWR,
} from './swrCache'

/**
 * Community Q&A. Reads go through the RPCs (report auto-hide lives
 * there). Writes hit the tables directly and copy game_title /
 * game_cover_image_id from the game object the caller already has.
 *
 * Cache keys (useCachedResource):
 *   qa:home:{uid}
 *   qa:game:{igdbId}:{filter}:{sort}
 *   qa:question:{id}
 *   qa:mine:{uid}
 *   qa:search:{gameId|all}:{query}
 *
 * Sign-out drops every key via clearSWRCache() inside
 * clearAllLocalUserData(). A library write marks qa:* stale too
 * (isLibraryDependent), which is what the credibility pill needs.
 */

export function qaHomeKey(uid) {
  return uid ? `qa:home:${uid}` : null
}

export function qaGameKey(igdbId, filter = 'answered', sort = 'helpful') {
  return `qa:game:${igdbId}:${filter}:${sort}`
}

export function qaQuestionKey(id) {
  return id ? `qa:question:${id}` : null
}

export function qaMineKey(uid) {
  return uid ? `qa:mine:${uid}` : null
}

export function qaSearchKey(gameId, query) {
  const scope = gameId == null || gameId === '' ? 'all' : String(gameId)
  return `qa:search:${scope}:${query}`
}

function fail(code) {
  return { error: { code } }
}

function isOffline(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = `${error?.message || ''} ${error?.details || ''}`
  return /failed to fetch|network|load failed|offline|timeout/i.test(msg)
}

function toReadError(error) {
  const err = new Error(error?.message || 'Could not load questions')
  if (isOffline(error)) err.code = 'offline'
  else if (error?.code) err.code = error.code
  else err.code = 'unknown'
  return err
}

async function callRpc(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw toReadError(error)
    return data
  } catch (err) {
    if (err?.code) throw err
    throw toReadError(err)
  }
}

function snapshotGame(game) {
  if (!game || typeof game !== 'object') return null
  const igdbGameId = Number(game.igdb_game_id ?? game.igdbId ?? game.id)
  const gameTitle = String(game.game_title ?? game.title ?? game.name ?? '').trim()
  const rawCover = game.game_cover_image_id ?? game.coverImageId ?? game.cover?.image_id ?? null
  const gameCoverImageId = rawCover ? String(rawCover) : null
  if (!Number.isInteger(igdbGameId) || igdbGameId <= 0 || !gameTitle) return null
  return { igdbGameId, gameTitle, gameCoverImageId }
}

function blankToNull(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function cachedIgdb(questionId) {
  if (!questionId) return null
  const row = peekSWR(qaQuestionKey(questionId))
  return row?.question?.igdb_game_id ?? null
}

function staleAfterWrite({ questionId, igdbGameId } = {}) {
  if (questionId) markSWRStale(qaQuestionKey(questionId))
  markSWRStaleByPrefix('qa:home:')
  markSWRStaleByPrefix('qa:mine:')
  const gameId = igdbGameId ?? (questionId ? cachedIgdb(questionId) : null)
  if (gameId != null && gameId !== '') markSWRStaleByPrefix(`qa:game:${gameId}:`)
  else markSWRStaleByPrefix('qa:game:')
  markSWRStaleByPrefix('qa:search:')
}

async function requireUser() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('offline')
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) return isOffline(error) ? fail('offline') : fail('not_allowed')
    if (!data?.user?.id) return fail('not_allowed')
    return { userId: data.user.id }
  } catch (err) {
    return isOffline(err) ? fail('offline') : fail('unknown')
  }
}

async function assertQaFlag() {
  const enabled = await isFlagEnabled('qa')
  if (enabled) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('offline')
  return fail('flag_off')
}

async function questionVisible(questionId) {
  try {
    const { data, error } = await supabase
      .from('qa_questions')
      .select('id')
      .eq('id', questionId)
      .maybeSingle()
    if (error) return isOffline(error) ? 'offline' : false
    return !!data
  } catch (err) {
    return isOffline(err) ? 'offline' : false
  }
}

async function classifyWriteError(error, { kind, questionId } = {}) {
  if (!error) return null
  if (isOffline(error)) return fail('offline')
  const msg = error.message || ''
  if (error.code === '23503' || /cannot be deleted|with answers/i.test(msg)) {
    return fail('has_answers')
  }
  if (error.code === '23505') return fail('duplicate')
  if (error.code === '23514') return fail('invalid')
  if (/blocked/i.test(msg)) return fail('blocked')
  if (error.code === '42501') {
    if (kind === 'question' || kind === 'answer') {
      const enabled = await isFlagEnabled('qa')
      if (!enabled) return fail('flag_off')
      if (kind === 'answer' && questionId) {
        const visible = await questionVisible(questionId)
        if (visible === 'offline') return fail('offline')
        if (!visible) return fail('blocked')
      }
      return fail('limit_reached')
    }
    return fail('not_allowed')
  }
  return fail('unknown')
}

/* ============================================================
   Reads — each returns the RPC jsonb, or throws { code }
   ============================================================ */

export function qaHome() {
  return callRpc('qa_home')
}

export function qaGame(igdbGameId, { filter = 'answered', sort = 'helpful', limit = 30, before = null } = {}) {
  return callRpc('qa_game', {
    p_igdb_game_id: Number(igdbGameId),
    p_filter: filter,
    p_sort: sort,
    p_limit: limit,
    p_before: before,
  })
}

export function qaQuestion(id) {
  return callRpc('qa_question', { p_id: id })
}

export function qaSearch(query, igdbGameId = null) {
  const args = { p_query: query ?? '' }
  if (igdbGameId != null && igdbGameId !== '') args.p_igdb_game_id = Number(igdbGameId)
  return callRpc('qa_search', args)
}

export function qaSimilar(title, igdbGameId) {
  return callRpc('qa_similar', {
    p_title: title ?? '',
    p_igdb_game_id: Number(igdbGameId),
  })
}

export function qaMine() {
  return callRpc('qa_mine')
}

/* ============================================================
   Writes — { data } or { error: { code } }. Never throw.
   ============================================================ */

/**
 * @param {{ game: object, topic: string, title: string, body?: string, platform?: string|null, location?: string|null, isSpoiler?: boolean }} input
 * `game` is the object the caller already loaded (id / title / coverImageId).
 */
export async function askQuestion({ game, topic, title, body = '', platform = null, location = null, isSpoiler = false }) {
  const who = await requireUser()
  if (who.error) return who
  const flagged = await assertQaFlag()
  if (flagged) return flagged

  const snap = snapshotGame(game)
  if (!snap || !topic || !title) return fail('invalid')

  const row = {
    user_id: who.userId,
    igdb_game_id: snap.igdbGameId,
    game_title: snap.gameTitle,
    game_cover_image_id: snap.gameCoverImageId,
    platform: blankToNull(platform),
    topic,
    title,
    body: body ?? '',
    location: blankToNull(location),
    is_spoiler: topic === 'story' ? true : !!isSpoiler,
  }

  const { data, error } = await supabase
    .from('qa_questions')
    .insert(row)
    // The extra columns are the server's own post-trigger values (trimmed
    // title/platform, forced spoiler flag, created_at = now()). The post flow
    // seeds the list caches from this row instead of guessing them.
    .select('id, igdb_game_id, game_title, game_cover_image_id, platform, topic, title, is_spoiler, created_at')
    .single()

  const classified = await classifyWriteError(error, { kind: 'question' })
  if (classified) return classified

  staleAfterWrite({ questionId: data?.id, igdbGameId: snap.igdbGameId })
  return { data }
}

const QUESTION_PATCH = {
  title: 'title',
  body: 'body',
  location: 'location',
  topic: 'topic',
  platform: 'platform',
  isSpoiler: 'is_spoiler',
}

export async function editQuestion(id, patch = {}, { igdbGameId } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!id) return fail('invalid')

  const next = {}
  for (const [key, column] of Object.entries(QUESTION_PATCH)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (key === 'isSpoiler') next[column] = !!patch[key]
    else if (key === 'location' || key === 'platform') next[column] = blankToNull(patch[key])
    else next[column] = patch[key]
  }
  if (Object.keys(next).length === 0) return fail('invalid')

  const { data, error } = await supabase
    .from('qa_questions')
    .update(next)
    .eq('id', id)
    .eq('user_id', who.userId)
    .select('id, igdb_game_id')
    .maybeSingle()

  const classified = await classifyWriteError(error, { kind: 'question' })
  if (classified) return classified
  if (!data) return fail('not_allowed')

  staleAfterWrite({ questionId: id, igdbGameId: igdbGameId ?? data.igdb_game_id })
  return { data }
}

export async function deleteQuestion(id, { igdbGameId } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!id) return fail('invalid')

  const { data, error } = await supabase
    .from('qa_questions')
    .delete()
    .eq('id', id)
    .eq('user_id', who.userId)
    .select('id')

  const classified = await classifyWriteError(error, { kind: 'question' })
  if (classified) return classified
  if (!data?.length) return fail('has_answers')

  staleAfterWrite({ questionId: id, igdbGameId })
  return { data: { id } }
}

export async function postAnswer({ questionId, body, isSpoiler = false, replyToUserId = null, igdbGameId = null }) {
  const who = await requireUser()
  if (who.error) return who
  const flagged = await assertQaFlag()
  if (flagged) return flagged
  if (!questionId || !body) return fail('invalid')

  const row = {
    question_id: questionId,
    user_id: who.userId,
    body,
    is_spoiler: !!isSpoiler,
    reply_to_user_id: replyToUserId || null,
  }

  const { data, error } = await supabase
    .from('qa_answers')
    .insert(row)
    .select('id, question_id')
    .single()

  const classified = await classifyWriteError(error, { kind: 'answer', questionId })
  if (classified) return classified

  staleAfterWrite({ questionId, igdbGameId })
  return { data }
}

export async function editAnswer(id, { body, isSpoiler } = {}, { questionId, igdbGameId } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!id) return fail('invalid')

  const next = {}
  if (body != null) next.body = body
  if (isSpoiler != null) next.is_spoiler = !!isSpoiler
  if (Object.keys(next).length === 0) return fail('invalid')

  const { data, error } = await supabase
    .from('qa_answers')
    .update(next)
    .eq('id', id)
    .eq('user_id', who.userId)
    .select('id, question_id')
    .maybeSingle()

  const classified = await classifyWriteError(error)
  if (classified) return classified
  if (!data) return fail('not_allowed')

  staleAfterWrite({ questionId: questionId ?? data.question_id, igdbGameId })
  return { data }
}

export async function deleteAnswer(id, { questionId, igdbGameId } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!id) return fail('invalid')

  const { data, error } = await supabase
    .from('qa_answers')
    .delete()
    .eq('id', id)
    .eq('user_id', who.userId)
    .select('id, question_id')

  const classified = await classifyWriteError(error)
  if (classified) return classified
  if (!data?.length) return fail('not_allowed')

  staleAfterWrite({ questionId: questionId ?? data[0].question_id, igdbGameId })
  return { data: { id } }
}

async function setBest(questionId, answerId, igdbGameId) {
  const who = await requireUser()
  if (who.error) return who
  if (!questionId) return fail('invalid')

  const { data, error } = await supabase
    .from('qa_questions')
    .update({ best_answer_id: answerId })
    .eq('id', questionId)
    .eq('user_id', who.userId)
    .select('id, igdb_game_id')
    .maybeSingle()

  const classified = await classifyWriteError(error)
  if (classified) return classified
  if (!data) return fail('not_allowed')

  staleAfterWrite({ questionId, igdbGameId: igdbGameId ?? data.igdb_game_id })
  return { data }
}

export function markBest(questionId, answerId, options = {}) {
  if (!answerId) return Promise.resolve(fail('invalid'))
  return setBest(questionId, answerId, options.igdbGameId)
}

export function unmarkBest(questionId, options = {}) {
  return setBest(questionId, null, options.igdbGameId)
}

export async function toggleHelpful(answerId, { questionId, igdbGameId, want } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!answerId) return fail('invalid')

  const existing = await supabase
    .from('qa_helpful_votes')
    .select('answer_id')
    .eq('answer_id', answerId)
    .eq('user_id', who.userId)
    .maybeSingle()

  if (existing.error) return classifyWriteError(existing.error)

  const on = typeof want === 'boolean' ? want : !existing.data
  if (on === !!existing.data) return { data: { on } }

  const op = on
    ? supabase.from('qa_helpful_votes').insert({ answer_id: answerId, user_id: who.userId })
    : supabase.from('qa_helpful_votes').delete().eq('answer_id', answerId).eq('user_id', who.userId)

  const { error } = await op
  const classified = await classifyWriteError(error)
  if (classified?.error?.code === 'duplicate' && on) return { data: { on: true } }
  if (classified) return classified

  staleAfterWrite({ questionId, igdbGameId })
  return { data: { on } }
}

export async function toggleStuck(questionId, { igdbGameId, want } = {}) {
  const who = await requireUser()
  if (who.error) return who
  if (!questionId) return fail('invalid')

  const existing = await supabase
    .from('qa_stuck')
    .select('question_id')
    .eq('question_id', questionId)
    .eq('user_id', who.userId)
    .maybeSingle()

  if (existing.error) return classifyWriteError(existing.error)

  const on = typeof want === 'boolean' ? want : !existing.data
  if (on === !!existing.data) return { data: { on } }

  const op = on
    ? supabase.from('qa_stuck').insert({ question_id: questionId, user_id: who.userId })
    : supabase.from('qa_stuck').delete().eq('question_id', questionId).eq('user_id', who.userId)

  const { error } = await op
  const classified = await classifyWriteError(error)
  if (classified?.error?.code === 'duplicate' && on) return { data: { on: true } }
  if (classified) return classified

  staleAfterWrite({ questionId, igdbGameId })
  return { data: { on } }
}

/** Marks the inbox seen and clears qa_home.inbox_has_new in the cache. */
export async function qaMarkInboxSeen() {
  const who = await requireUser()
  if (who.error) return who

  const { data, error } = await supabase.rpc('qa_mark_inbox_seen')
  const classified = await classifyWriteError(error)
  if (classified) return classified

  mutateSWRByPrefix('qa:home:', (current) => {
    if (!current || typeof current !== 'object') return current
    return { ...current, inbox_has_new: false }
  })
  markSWRStaleByPrefix('qa:home:')
  return { data }
}
