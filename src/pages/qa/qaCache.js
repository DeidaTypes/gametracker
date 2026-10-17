import {
  markSWRStaleByPrefix,
  mutateSWR,
  mutateSWRByPrefix,
} from '../../services/swrCache'
import { qaQuestionKey } from '../../services/qaService'

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
