import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, EyeOff } from 'lucide-react'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaQuestion } from '../../services/qaService'
import { hapticImpact } from '../../utils/haptics'
import { seedQaQuestionFromRow } from './qaCache'
import {
  formatAnsweredListStats,
  formatRowMeta,
  highlightQuery,
  qaShortAge,
} from './qaFormat'

function Highlighted({ text, query }) {
  const parts = highlightQuery(text, query)
  return parts.map((part, index) =>
    part.match ? (
      <mark key={index} className="qa-hl">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    )
  )
}

function firstLine(body) {
  if (!body) return ''
  return String(body).replace(/\s+/g, ' ').trim().slice(0, 80)
}

function CheckPreview({ text }) {
  if (!text) return null
  return (
    <span className="qa-preview">
      <span className="qa-preview__check" aria-hidden="true">
        <Check size={10} strokeWidth={3.4} />
      </span>
      <span className="qa-preview__text text-caption">{text}</span>
    </span>
  )
}

function SpoilerPreview({ item, onRevealed }) {
  const [text, setText] = useState(null)
  const [busy, setBusy] = useState(false)

  async function reveal(event) {
    event.preventDefault()
    event.stopPropagation()
    if (busy || text) return
    setBusy(true)
    try {
      const data = await qaQuestion(item.id)
      const answers = Array.isArray(data?.answers) ? data.answers : []
      const live = answers.filter((answer) => answer && answer.removed !== true && answer.body)
      const best =
        live.find((answer) => answer.is_best) ||
        live.find((answer) => answer.is_community_pick) ||
        live[0]
      const line = firstLine(best?.body)
      if (line) {
        hapticImpact('Light')
        setText(line)
        onRevealed?.()
      }
    } catch {
      // Leave the chip. A failed reveal is not a fabricated preview.
    } finally {
      setBusy(false)
    }
  }

  if (text) return <CheckPreview text={text} />

  return (
    <button type="button" className="qa-spoil-pv text-caption" onClick={reveal} disabled={busy}>
      <EyeOff size={15} aria-hidden="true" />
      Best answer has spoilers · tap to reveal
    </button>
  )
}

function OpenStatus({ item, showAge }) {
  const waiting = item.unanswered_label === 'waiting'
  const count = Number(item.answer_count) || 0
  const label = waiting
    ? `${count} answer${count === 1 ? '' : 's'} · waiting on asker`
    : 'No answers yet'
  const age = showAge ? qaShortAge(item.created_at) : ''

  return (
    <span className={`qa-status text-caption${waiting ? ' qa-status--wait' : ''}`}>
      <span className="qa-status__dot" aria-hidden="true" />
      <span className="qa-status__label">{label}</span>
      {age ? <span className="qa-status__age">· {age}</span> : null}
    </span>
  )
}

function RowCover({ item }) {
  const src = item.game_cover_image_id
    ? coverUrlFromImageId(item.game_cover_image_id, 'cover_big')
    : null
  if (!src) return <span className="qa-qrow__cover qa-fill" aria-hidden="true" />
  return <img className="qa-qrow__cover" src={src} alt="" />
}

export default function QaQuestionListRow({
  item,
  showStats = true,
  withAsker = false,
  showCover = false,
  showAge = false,
  query = '',
  meta,
}) {
  const [spoilerOpen, setSpoilerOpen] = useState(false)
  if (!item?.id) return null

  const spoiler = item.status !== 'open' && !item.best_preview
  const stats = showStats && item.status !== 'open' ? formatAnsweredListStats(item) : null
  const metaLine = meta ?? formatRowMeta(item, { withAsker })
  const indentStats = (!spoiler && !!item.best_preview) || spoilerOpen

  return (
    <div className={`qa-qrow${showCover ? '' : ' qa-qrow--plain'}`}>
      <Link
        className="qa-qrow__hit"
        to={`/qa/q/${item.id}`}
        aria-label={item.title}
        onClick={() => seedQaQuestionFromRow(item)}
      />
      <div className="qa-qrow__face">
        {showCover ? <RowCover item={item} /> : null}
        <span className="qa-qrow__col">
          <span className="qa-qrow__title text-body">
            <Highlighted text={item.title} query={query} />
          </span>
          {metaLine ? <span className="qa-qrow__meta text-caption">{metaLine}</span> : null}
          {item.status === 'open' ? (
            <OpenStatus item={item} showAge={showAge} />
          ) : spoiler ? (
            <SpoilerPreview item={item} onRevealed={() => setSpoilerOpen(true)} />
          ) : (
            <CheckPreview text={item.best_preview} />
          )}
          {stats ? (
            <span className={`qa-qrow__stats text-caption${indentStats ? ' qa-qrow__stats--in' : ''}`}>
              {stats}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}
