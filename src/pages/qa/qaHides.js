import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Questions and answers this viewer reported. One report does not
 * hide a row in the RPCs (that takes three), so the hide lives here
 * until they undo it. Survives leaving the screen.
 */

const STORAGE_KEY = 'gt:qa-hides:v1'

let userId = null
let questions = new Set()
let answers = new Set()
const listeners = new Set()

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function load() {
  const bucket = userId ? readAll()[userId] : null
  questions = new Set(Array.isArray(bucket?.questions) ? bucket.questions : [])
  answers = new Set(Array.isArray(bucket?.answers) ? bucket.answers : [])
}

function persist() {
  if (!userId) return
  try {
    const all = readAll()
    all[userId] = {
      questions: [...questions],
      answers: [...answers],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // A blocked store still hides the item until the next full reload.
  }
}

function emit() {
  for (const fn of listeners) fn()
}

export function bindQaHideUser(nextUserId) {
  const id = nextUserId || null
  if (id === userId) return
  userId = id
  load()
  emit()
}

export function isQaQuestionHidden(id) {
  return !!id && questions.has(id)
}

export function isQaAnswerHidden(id) {
  return !!id && answers.has(id)
}

export function hideQaQuestion(id) {
  if (!id || questions.has(id)) return
  questions.add(id)
  persist()
  emit()
}

export function hideQaAnswer(id) {
  if (!id || answers.has(id)) return
  answers.add(id)
  persist()
  emit()
}

export function showQaQuestion(id) {
  if (!id || !questions.has(id)) return
  questions.delete(id)
  persist()
  emit()
}

export function showQaAnswer(id) {
  if (!id || !answers.has(id)) return
  answers.delete(id)
  persist()
  emit()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useQaHides() {
  const { user } = useAuth()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    bindQaHideUser(user?.id || null)
    return subscribe(() => setTick((n) => n + 1))
  }, [user?.id])

  return {
    tick,
    hasQuestion: isQaQuestionHidden,
    hasAnswer: isQaAnswerHidden,
  }
}
