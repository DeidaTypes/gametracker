import {
  markSWRStale,
  markSWRStaleByPrefix,
  mutateSWR,
  mutateSWRByPrefix,
  peekSWR,
} from '../../services/swrCache'
import { qaGameKey, qaHomeKey, qaMineKey, qaQuestionKey } from '../../services/qaService'

/* ------------------------------------------------------------------ */
/* Just asked                                                          */
/* ------------------------------------------------------------------ */

// Set when the viewer posts a question, read once by the Q&A tab so it opens
// on Unanswered (a zero-answer question only ever appears there). Module
// state, not the URL.
let justAsked = false
const justAskedListeners = new Set()

export function markJustAsked() {
  justAsked = true
  for (const fn of [...justAskedListeners]) {
    try {
      fn()
    } catch (err) {
      console.error('[qaCache] justAsked listener failed:', err)
    }
  }
}

/** True at most once per post: reads the flag and clears it. */
export function consumeJustAsked() {
  const was = justAsked
  justAsked = false
  return was
}

/** A mounted Q&A tab hears about a post while it is still on screen. */
export function subscribeJustAsked(fn) {
  justAskedListeners.add(fn)
  return () => justAskedListeners.delete(fn)
}

/* ------------------------------------------------------------------ */
/* Seed the list caches with a question the viewer just posted         */
/* ------------------------------------------------------------------ */

const HOME_NEWEST_LIMIT = 20 // qa_home: limit 20
const MINE_ASKED_LIMIT = 100 // qa_mine: limit 100
const GAME_FILTERS = ['answered', 'unanswered']
const GAME_SORTS = ['helpful', 'newest']

function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * private.qa_item() for a question nobody has touched yet. Every value is
 * either the server's own row (the insert's RETURNING) or fixed by the
 * database for a new question: qa_status() is 'open' (not best, under 7
 * days), the answer count is 0, and unanswered_label is 'no_answers'.
 * Returns null unless the row has every column, so nothing is invented.
 */
function listItemFrom(row) {
  if (!row || typeof row !== 'object') return null
  const required = ['id', 'title', 'igdb_game_id', 'game_title', 'topic', 'created_at']
  if (required.some((field) => !row[field])) return null
  if (!('platform' in row) || !('game_cover_image_id' in row)) return null
  if (typeof row.is_spoiler !== 'boolean') return null
  return {
    id: row.id,
    title: row.title,
    igdb_game_id: row.igdb_game_id,
    game_title: row.game_title,
    game_cover_image_id: row.game_cover_image_id,
    platform: row.platform,
    topic: row.topic,
    is_spoiler: row.is_spoiler,
    created_at: row.created_at,
    status: 'open',
    answer_count: 0,
    helpful_on_best: null,
    best_preview: null,
    unanswered_label: 'no_answers',
  }
}

function bumpMostAsked(list, gameId) {
  if (!Array.isArray(list)) return list
  return list.map((game) => (
    game?.igdb_game_id === gameId && Number.isFinite(Number(game.question_count))
      ? { ...game, question_count: Number(game.question_count) + 1 }
      : game
  ))
}

/** qa_game header after one more open question (same arithmetic as the RPC). */
function bumpGameHeader(header) {
  if (!header || typeof header !== 'object') return header
  const total = Number(header.question_count)
  const open = Number(header.unanswered_count)
  const done = Number(header.answered_count)
  if (![total, open, done].every(Number.isFinite)) return header
  const nextTotal = total + 1
  return {
    ...header,
    question_count: nextTotal,
    unanswered_count: open + 1,
    answered_pct: Math.round((100 * done) / nextTotal),
  }
}

/**
 * Put a just-posted question into the list caches that already exist for
 * this viewer: qa:home, qa:mine, and the game's qa:game keys. A key that has
 * never loaded is left alone (never created). Every key is marked stale
 * again afterwards so the next read replaces the seed with the real rows.
 *
 * `row` is the insert's RETURNING row. A key whose row shape we cannot be
 * certain of is not seeded:
 *   - no complete row  -> nothing is seeded
 *   - no asker username -> qa:game keys are skipped (their rows carry it)
 *
 * qa:game 'helpful' sort ranks open questions by their top answer's helpful
 * count, which a list row does not carry. The new row goes in front of the
 * first zero-answer row (after rows that have answers); the revalidation that
 * follows settles any tie. 'newest' is exact: it is the first row.
 */
export function seedAskedQuestion({ userId, row, askerUsername }) {
  const item = listItemFrom(row)
  const homeKey = qaHomeKey(userId)
  const mineKey = qaMineKey(userId)
  const gameId = item?.igdb_game_id
  const gameKeys = gameId
    ? GAME_FILTERS.flatMap((filter) => GAME_SORTS.map((sort) => ({
        key: qaGameKey(gameId, filter, sort),
        filter,
        sort,
      })))
    : []

  if (item) {
    mutateSWR(homeKey, (current) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current
      if (!Array.isArray(current.newest_open)) return current
      const rest = current.newest_open.filter((existing) => existing?.id !== item.id)
      return {
        ...current,
        newest_open: [item, ...rest].slice(0, HOME_NEWEST_LIMIT),
        most_asked: bumpMostAsked(current.most_asked, item.igdb_game_id),
      }
    })

    mutateSWR(mineKey, (current) => {
      if (!current || typeof current !== 'object' || !Array.isArray(current.asked)) return current
      const rest = current.asked.filter((existing) => existing?.id !== item.id)
      return {
        ...current,
        asked: [{ ...item, new_answer_count: 0 }, ...rest].slice(0, MINE_ASKED_LIMIT),
      }
    })

    if (typeof askerUsername === 'string' && askerUsername) {
      const gameItem = { ...item, asker_username: askerUsername }
      for (const { key, filter, sort } of gameKeys) {
        mutateSWR(key, (current) => {
          if (!current || typeof current !== 'object' || !Array.isArray(current.items)) return current
          const header = bumpGameHeader(current.header)
          if (filter !== 'unanswered') return { ...current, header }
          const rest = current.items.filter((existing) => existing?.id !== item.id)
          let at = 0
          if (sort === 'helpful') {
            const firstEmpty = rest.findIndex((existing) => Number(existing?.answer_count) === 0)
            at = firstEmpty === -1 ? rest.length : firstEmpty
          }
          return {
            ...current,
            header,
            items: [...rest.slice(0, at), gameItem, ...rest.slice(at)],
          }
        })
      }
    }
  }

  // mutateSWR stamps the entry fresh. Undo that so the next read refetches.
  markSWRStale(homeKey)
  markSWRStale(mineKey)
  for (const { key } of gameKeys) markSWRStale(key)
}

/* ------------------------------------------------------------------ */
/* Seed the question screen from the row that opens it                 */
/* ------------------------------------------------------------------ */

const ROW_QUESTION_FIELDS = [
  'title',
  'game_title',
  'game_cover_image_id',
  'igdb_game_id',
  'topic',
  'platform',
  'is_spoiler',
  'created_at',
]

/**
 * Give qa:question:{id} the list row's fields before the push, so the slide's
 * first frame already has the title, game and tags. `state: 'seed'` keeps
 * every writer that expects the full qa_question payload (state 'ok') off it.
 * A key that already holds anything is left alone. Fields the row doesn't
 * carry stay absent. The entry is marked stale so the screen fetches the
 * real payload.
 */
export function seedQaQuestionFromRow(item) {
  if (!item?.id) return
  const key = qaQuestionKey(item.id)
  if (peekSWR(key) !== undefined) return
  const question = { id: item.id }
  for (const field of ROW_QUESTION_FIELDS) {
    if (item[field] !== undefined) question[field] = item[field]
  }
  const seed = { state: 'seed', question }
  if (item.status !== undefined) seed.status = item.status
  if (item.answer_count !== undefined) seed.answer_count = item.answer_count
  mutateSWR(key, seed)
  markSWRStale(key)
}

/** Patch the open question. No-ops when that screen has never loaded. */
export function writeQaQuestion(id, updater) {
  if (!id) return undefined
  return mutateSWR(qaQuestionKey(id), (current) => {
    if (!current || current.state !== 'ok') return current
    return updater(current)
  })
}

function mapList(list, id, patch) {
  if (!Array.isArray(list)) return list
  return list.map((item) => (item?.id === id ? { ...item, ...patch } : item))
}

function dropId(list, id) {
  if (!Array.isArray(list)) return list
  return list.filter((item) => item?.id !== id)
}

/** List rows that point at this question. Home, a game, search, Your questions. */
export function patchQaLists(questionId, patch) {
  if (!questionId || !patch) return
  mutateSWRByPrefix('qa:home:', (current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current
    return {
      ...current,
      answered_week: mapList(current.answered_week, questionId, patch),
      can_help: mapList(current.can_help, questionId, patch),
      newest_open: mapList(current.newest_open, questionId, patch),
    }
  })
  mutateSWRByPrefix('qa:game:', (current) => {
    if (!current?.items) return current
    return { ...current, items: mapList(current.items, questionId, patch) }
  })
  mutateSWRByPrefix('qa:search:', (current) => (
    Array.isArray(current) ? mapList(current, questionId, patch) : current
  ))
  mutateSWRByPrefix('qa:mine:', (current) => {
    if (!current || typeof current !== 'object') return current
    return {
      ...current,
      asked: mapList(current.asked, questionId, patch),
      answered: Array.isArray(current.answered)
        ? current.answered.map((row) => (
          row?.question?.id === questionId
            ? { ...row, question: { ...row.question, ...patch } }
            : row
        ))
        : current.answered,
    }
  })
}

export function removeQaQuestionFromLists(questionId) {
  if (!questionId) return
  mutateSWRByPrefix('qa:home:', (current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current
    return {
      ...current,
      answered_week: dropId(current.answered_week, questionId),
      can_help: dropId(current.can_help, questionId),
      newest_open: dropId(current.newest_open, questionId),
    }
  })
  mutateSWRByPrefix('qa:game:', (current) => (
    current?.items ? { ...current, items: dropId(current.items, questionId) } : current
  ))
  mutateSWRByPrefix('qa:search:', (current) => (
    Array.isArray(current) ? dropId(current, questionId) : current
  ))
  mutateSWRByPrefix('qa:mine:', (current) => {
    if (!current || typeof current !== 'object') return current
    return {
      ...current,
      asked: dropId(current.asked, questionId),
      answered: Array.isArray(current.answered)
        ? current.answered.filter((row) => row?.question?.id !== questionId)
        : current.answered,
    }
  })
}

export function previewLine(body) {
  if (!body) return null
  const line = String(body).replace(/\s+/g, ' ').trim().slice(0, 80)
  return line || null
}

export function setAnswerHelpful(questionId, answerId, { on, count }, { isPick = false } = {}) {
  writeQaQuestion(questionId, (current) => ({
    ...current,
    answers: (current.answers || []).map((answer) => (
      answer.id === answerId
        ? { ...answer, viewer_helpful: !!on, helpful_count: count }
        : answer
    )),
  }))
  if (isPick) patchQaLists(questionId, { helpful_on_best: count })
}

export function setStuck(questionId, { on, count }) {
  writeQaQuestion(questionId, (current) => ({
    ...current,
    stuck: { viewer_stuck: !!on, count },
  }))
}

export function applyBest(questionId, answerId, { answer, liveCount = 0 } = {}) {
  writeQaQuestion(questionId, (current) => ({
    ...current,
    status: answerId ? 'best' : 'open',
    pick_answer_id: answerId || null,
    question: {
      ...current.question,
      best_answer_id: answerId || null,
      best_picked_at: answerId ? new Date().toISOString() : null,
    },
    answers: (current.answers || []).map((row) => ({
      ...row,
      is_best: !!answerId && row.id === answerId,
      is_community_pick: answerId ? false : row.is_community_pick,
    })),
  }))
  if (answerId) {
    patchQaLists(questionId, {
      status: 'best',
      unanswered_label: null,
      helpful_on_best: answer?.helpful_count ?? null,
      best_preview: answer?.is_spoiler ? null : previewLine(answer?.body),
    })
    return
  }
  patchQaLists(questionId, {
    status: 'open',
    unanswered_label: liveCount > 0 ? 'waiting' : 'no_answers',
    helpful_on_best: null,
    best_preview: null,
  })
}

export function removeAnswerLocal(questionId, answerId) {
  let liveCount = 0
  let wasBest = false
  writeQaQuestion(questionId, (current) => {
    wasBest = current.pick_answer_id === answerId || current.question?.best_answer_id === answerId
    const answers = (current.answers || []).filter((row) => row.id !== answerId)
    liveCount = answers.filter((row) => !row.removed).length
    return {
      ...current,
      answers,
      status: wasBest ? 'open' : current.status,
      pick_answer_id: wasBest ? null : current.pick_answer_id,
      question: wasBest
        ? { ...current.question, best_answer_id: null, best_picked_at: null }
        : current.question,
    }
  })
  patchQaLists(questionId, {
    answer_count: liveCount,
    ...(wasBest
      ? {
          status: 'open',
          unanswered_label: liveCount > 0 ? 'waiting' : 'no_answers',
          helpful_on_best: null,
          best_preview: null,
        }
      : {}),
  })
}

export function applyQuestionEdit(questionId, fields, { edited }) {
  writeQaQuestion(questionId, (current) => ({
    ...current,
    question: {
      ...current.question,
      ...fields,
      edited_at: edited ? new Date().toISOString() : current.question.edited_at,
    },
  }))
  patchQaLists(questionId, {
    title: fields.title,
    topic: fields.topic,
    platform: fields.platform,
    is_spoiler: fields.is_spoiler,
  })
}

export function applyAnswerEdit(questionId, answerId, fields, { edited, isBest }) {
  writeQaQuestion(questionId, (current) => ({
    ...current,
    answers: (current.answers || []).map((answer) => (
      answer.id === answerId
        ? {
            ...answer,
            body: fields.body,
            is_spoiler: fields.is_spoiler,
            edited_at: edited ? new Date().toISOString() : answer.edited_at,
          }
        : answer
    )),
  }))
  if (isBest) {
    patchQaLists(questionId, {
      best_preview: fields.is_spoiler ? null : previewLine(fields.body),
    })
  }
}

/**
 * Drop a blocked person's questions and answers from every Q&A cache
 * we can identify. Rows we cannot attribute get marked stale; the next
 * open refetches and RLS omits them both ways.
 */
export function dropBlockedUserFromQa(userId) {
  if (!userId) return
  const questionIds = new Set()
  mutateSWRByPrefix('qa:question:', (current) => {
    if (!current || current.state !== 'ok') return current
    if (current.question?.asker?.id === userId) {
      if (current.question.id) questionIds.add(current.question.id)
      return current
    }
    const answers = Array.isArray(current.answers) ? current.answers : []
    const next = answers.filter((answer) => answer.removed || answer.author?.id !== userId)
    if (next.length === answers.length) return current
    const pick = current.pick_answer_id
    const pickGone = !!pick && !next.some((answer) => !answer.removed && answer.id === pick)
    return {
      ...current,
      answers: next.map((answer) => (
        pickGone ? { ...answer, is_best: false, is_community_pick: false } : answer
      )),
      pick_answer_id: pickGone ? null : pick,
      status: pickGone ? 'open' : current.status,
      question: pickGone
        ? { ...current.question, best_answer_id: null, best_picked_at: null }
        : current.question,
    }
  })
  if (questionIds.size) {
    for (const id of questionIds) removeQaQuestionFromLists(id)
  }
  markSWRStaleByPrefix('qa:')
}
