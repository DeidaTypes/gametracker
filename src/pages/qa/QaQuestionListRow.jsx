import { Link } from 'react-router-dom'
import { Check, EyeOff } from 'lucide-react'
import { formatAnsweredListStats, formatRowMeta } from './qaFormat'

function Preview({ item }) {
  if (item.is_spoiler && item.best_preview == null) {
    return (
      <span className="qa-spoil-pv text-caption">
        <EyeOff size={15} aria-hidden="true" />
        Best answer has spoilers · tap to reveal
      </span>
    )
  }
  if (item.status !== 'open' && item.best_preview) {
    return (
      <span className="qa-preview">
        <span className="qa-preview__check" aria-hidden="true">
          <Check size={10} strokeWidth={3.4} />
        </span>
        <span className="qa-preview__text text-caption">{item.best_preview}</span>
      </span>
    )
  }
  if (item.status === 'open') {
    const label =
      item.unanswered_label === 'waiting'
        ? `${item.answer_count || 0} answer${item.answer_count === 1 ? '' : 's'} · waiting on asker`
        : 'No answers yet'
    return (
      <span className="qa-status-wait text-caption">
        <span className="qa-status-wait__dot" aria-hidden="true" />
        <span className="qa-status-wait__text">{label}</span>
      </span>
    )
  }
  return null
}

export default function QaQuestionListRow({ item, showStats = true, withAsker = false }) {
  if (!item?.id) return null
  const stats = showStats && item.status !== 'open' ? formatAnsweredListStats(item) : null

  return (
    <Link to={`/qa/q/${item.id}`} className="qa-qrow qa-qrow--plain">
      <span className="qa-qrow__col">
        <span className="qa-qrow__title text-body">{item.title}</span>
        <span className="qa-qrow__meta text-caption">{formatRowMeta(item, { withAsker })}</span>
        <Preview item={item} />
        {stats ? <span className="qa-qrow__stats text-caption">{stats}</span> : null}
      </span>
    </Link>
  )
}
