/** Shared formatters for Community Q&A read surfaces. */

export const QA_TOPICS = [
  'boss',
  'build',
  'item',
  'location',
  'puzzle',
  'quest',
  'story',
  'strategy',
  'tech',
]

const TOPIC_LABELS = {
  boss: 'Boss',
  build: 'Build',
  item: 'Item',
  location: 'Location',
  puzzle: 'Puzzle',
  quest: 'Quest',
  story: 'Story',
  strategy: 'Strategy',
  tech: 'Tech',
}

export function topicLabel(topic) {
  if (!topic) return ''
  return TOPIC_LABELS[topic] || topic.charAt(0).toUpperCase() + topic.slice(1)
}

export function displayNameFor(user) {
  if (!user) return null
  return user.display_name || user.username || null
}

/** Short age for list rows ("40m", "2h", "2d"). No "ago". */
export function qaShortAge(timestamp) {
  if (!timestamp) return ''
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'now'
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w`
  const months = Math.round(d / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(d / 365)}y`
}

export function qaTimeAgo(timestamp) {
  if (!timestamp) return ''
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w ago`
  const months = Math.round(d / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(d / 365)}y ago`
}

export function formatCredibilityPill(credibility) {
  if (!credibility?.status) return null
  const label = credibility.status === 'playing' ? 'Playing' : 'Played'
  const hours = Number(credibility.hours)
  const h = Number.isFinite(hours) ? Math.round(hours) : 0
  return `${label} · ${h}h`
}

export function formatQuestionTags(question) {
  const parts = [topicLabel(question?.topic)]
  if (question?.platform) parts.push(question.platform)
  if (question?.location) parts.push(question.location)
  return parts.filter(Boolean).join(' · ')
}

export function formatGamePlatform(item) {
  const parts = []
  if (item?.game_title) parts.push(item.game_title)
  if (item?.platform) parts.push(item.platform)
  return parts.join(' · ')
}

/**
 * Split `text` into match / plain runs for a search query.
 * The last word is a prefix, matching qa_search. Words under 2
 * characters are left alone so "a" doesn't paint the whole title.
 */
export function highlightQuery(text, query) {
  const source = text || ''
  const words = String(query || '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2)
  if (!source || words.length === 0) return [{ text: source, match: false }]

  const patterns = words.map((word, index) => {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const last = index === words.length - 1
    const prefix = last && /^[A-Za-z0-9]+$/.test(word)
    return prefix ? `${esc}[A-Za-z0-9]*` : esc
  })
  const re = new RegExp(`(${patterns.join('|')})`, 'gi')
  const parts = []
  let cursor = 0
  for (const match of source.matchAll(re)) {
    const at = match.index ?? 0
    if (at > cursor) parts.push({ text: source.slice(cursor, at), match: false })
    parts.push({ text: match[0], match: true })
    cursor = at + match[0].length
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false })
  return parts.length ? parts : [{ text: source, match: false }]
}

export function formatRowMeta(item, { withAsker = false } = {}) {
  const parts = [topicLabel(item?.topic)]
  if (item?.platform) parts.push(item.platform)
  if (withAsker && item?.asker_username) parts.push(`@${item.asker_username}`)
  return parts.filter(Boolean).join(' · ')
}

export function formatGameStatsLine(header) {
  if (!header || typeof header !== 'object') return null
  const count = Number(header.question_count) || 0
  if (count === 0) return 'No questions yet'
  const pct = header.answered_pct
  const pctPart =
    pct != null && Number.isFinite(Number(pct)) ? ` · ${Number(pct)}% answered` : ''
  return `${count} question${count === 1 ? '' : 's'}${pctPart}`
}

/** "Best answer · N helpful" on duplicate suggestions. Hidden when nothing is picked. */
export function formatSimilarStats(item) {
  if (!item) return ''
  if (item.status !== 'best' && item.status !== 'community_pick') return ''
  const lead = item.status === 'community_pick' ? 'Community pick' : 'Best answer'
  const helpful = item.helpful_on_best
  if (helpful == null) return lead
  return `${lead} · ${helpful} helpful`
}

export function formatAnsweredListStats(item) {
  if (!item) return ''
  const helpful = item.helpful_on_best
  const answers = item.answer_count
  const status = item.status
  let lead = 'Best answer'
  if (status === 'community_pick') lead = 'Community pick'
  const parts = [lead]
  if (helpful != null) parts.push(`${helpful} helpful`)
  if (answers != null) parts.push(`${answers} answer${answers === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export function questionStatusPill({ status, viewerIsAsker, answerCount = 0 }) {
  if (status === 'best') return { kind: 'answered', label: 'Answered' }
  if (status === 'community_pick') return { kind: 'community', label: 'Community pick' }
  if (status === 'open') {
    if (!answerCount) return { kind: 'open', label: 'No answers yet' }
    if (viewerIsAsker) return { kind: 'waiting', label: 'Waiting on you' }
  }
  return null
}

export function bestAnswerHeadline({ status, askerUsername, helpfulCount }) {
  if (status === 'community_pick') {
    const n = helpfulCount != null ? `${helpfulCount} helpful` : ''
    return n
      ? `Community pick · ${n} from players who Played it`
      : 'Community pick'
  }
  if (askerUsername) return `Best answer · picked by ${askerUsername}`
  return 'Best answer'
}
