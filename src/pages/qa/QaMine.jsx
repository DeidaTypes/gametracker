import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, EyeOff } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import QaPushBar from './QaPushBar'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaMarkInboxSeen, qaMine, qaMineKey } from '../../services/qaService'
import { hapticImpact } from '../../utils/haptics'
import { seedQaQuestionFromRow, useWarmTopQuestions, warmQaQuestion } from './qaCache'
import { useQaHides } from './qaHides'
import { QaCoverRows } from './QaPlaceholders'
import { formatGamePlatform, qaShortAge } from './qaFormat'
import './qa.css'

/** Asked | Your answers is screen state, same as the Q&A tab switch. */
let rememberedTab = 'asked'

function asList(value) {
  return Array.isArray(value) ? value : []
}

function firstLine(body) {
  if (!body) return ''
  return String(body).replace(/\s+/g, ' ').trim().slice(0, 80)
}

function RowCover({ item }) {
  const src = item?.game_cover_image_id
    ? coverUrlFromImageId(item.game_cover_image_id, 'cover_big')
    : null
  if (!src) return <span className="qa-qrow__cover qa-fill" aria-hidden="true" />
  return <img className="qa-qrow__cover" src={src} alt="" />
}

function askedStatus(item) {
  if (item?.status === 'best') {
    return { kind: 'answered', label: 'Answered', detail: 'Best answer picked' }
  }
  if (item?.status === 'community_pick') {
    return { kind: 'answered', label: 'Answered', detail: 'Community pick' }
  }
  if (item?.unanswered_label === 'waiting' || (item?.status === 'open' && Number(item?.answer_count) > 0)) {
    return { kind: 'waiting', label: 'Waiting on you' }
  }
  return { kind: 'open', label: 'No answers yet' }
}

function StatusLine({ status, age }) {
  if (status.kind === 'answered') {
    return (
      <span className="qa-status qa-status--answered text-caption">
        <span className="qa-status__check" aria-hidden="true">
          <Check size={10} strokeWidth={3.4} />
        </span>
        <span className="qa-status__label">{status.label}</span>
        {status.detail ? <span className="qa-status__detail">· {status.detail}</span> : null}
      </span>
    )
  }
  const waiting = status.kind === 'waiting'
  return (
    <span className={`qa-status text-caption${waiting ? ' qa-status--wait' : ''}`}>
      <span className="qa-status__dot" aria-hidden="true" />
      <span className="qa-status__label">{status.label}</span>
      {age ? <span className="qa-status__age">· {age}</span> : null}
    </span>
  )
}

function AskedRow({ item }) {
  const status = askedStatus(item)
  const age = status.kind === 'answered' ? '' : qaShortAge(item.created_at)
  const fresh = Number(item.new_answer_count) || 0
  return (
    <div className="qa-qrow">
      <Link
        className="qa-qrow__hit"
        to={`/qa/q/${item.id}`}
        aria-label={item.title}
        onPointerDown={() => warmQaQuestion(item)}
        onClick={() => seedQaQuestionFromRow(item)}
      />
      <div className="qa-qrow__face">
        <RowCover item={item} />
        <span className="qa-qrow__col">
          <span className="qa-qrow__title text-body">{item.title}</span>
          {formatGamePlatform(item) ? (
            <span className="qa-qrow__meta text-caption">{formatGamePlatform(item)}</span>
          ) : null}
          <span className="qa-mine-status">
            <StatusLine status={status} age={age} />
            {fresh > 0 ? (
              <span className="qa-chip qa-chip--soc">
                {fresh} new answer{fresh === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
        </span>
      </div>
    </div>
  )
}

function AnsweredRow({ row }) {
  const question = row.question
  const answer = row.answer
  if (!question?.id || !answer?.id) return null
  const preview = answer.is_spoiler ? '' : firstLine(answer.body)
  const helpful = Number(answer.helpful_count) || 0
  return (
    <div className="qa-qrow">
      <Link
        className="qa-qrow__hit"
        to={`/qa/q/${question.id}`}
        aria-label={question.title}
        onPointerDown={() => warmQaQuestion(question)}
        onClick={() => seedQaQuestionFromRow(question)}
      />
      <div className="qa-qrow__face">
        <RowCover item={question} />
        <span className="qa-qrow__col">
          <span className="qa-qrow__title text-body">{question.title}</span>
          {formatGamePlatform(question) ? (
            <span className="qa-qrow__meta text-caption">{formatGamePlatform(question)}</span>
          ) : null}
          {answer.is_spoiler ? (
            <span className="qa-spoil-pv text-caption">
              <EyeOff size={15} aria-hidden="true" />
              Your answer has spoilers
            </span>
          ) : preview ? (
            <span className="qa-preview">
              <span className="qa-preview__text text-caption">{preview}</span>
            </span>
          ) : null}
          {answer.is_best ? (
            <span className="qa-status qa-status--answered text-caption">
              <span className="qa-status__check" aria-hidden="true">
                <Check size={10} strokeWidth={3.4} />
              </span>
              <span className="qa-status__label">Best answer</span>
            </span>
          ) : null}
          {helpful > 0 ? (
            <span className="qa-qrow__stats text-caption">
              {helpful} helpful
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}

function MineGroup({ rows }) {
  if (!rows.length) return null
  return (
    <div className="qa-group">
      {rows.map((row, index) => (
        <div key={row.key}>
          {index > 0 ? <div className="qa-hair" /> : null}
          {row.node}
        </div>
      ))}
    </div>
  )
}

export default function QaMine() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const hides = useQaHides()
  const key = qaMineKey(user?.id)
  const { data, error, refresh } = useCachedResource(key, qaMine, { enabled: !!user?.id })
  const pending = data === undefined && !error
  const marked = useRef(false)
  const [tab, setTab] = useState(rememberedTab)

  useEffect(() => {
    if (data == null || marked.current) return undefined
    marked.current = true
    qaMarkInboxSeen()
    return undefined
  }, [data])

  const select = (next) => {
    if (next === tab) return
    hapticImpact('Light')
    rememberedTab = next
    setTab(next)
  }

  const asked = asList(data?.asked).filter((item) => item?.id && !hides.hasQuestion(item.id))
  const answered = asList(data?.answered).filter((row) => {
    if (!row?.question?.id || hides.hasQuestion(row.question.id)) return false
    if (row.answer?.id && hides.hasAnswer(row.answer.id)) return false
    return true
  })
  useWarmTopQuestions(
    tab === 'asked' ? asked.map((item) => item.id) : answered.map((row) => row.question.id),
  )
  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <QaPushBar onBack={() => navigate(-1)} />
      <div className="qa-push-body">
        <h1 className="text-display-l qa-mine-title">Your questions</h1>
        <div className="qa-seg" role="tablist" aria-label="Your questions">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'asked'}
            className={`qa-seg__btn text-body${tab === 'asked' ? ' qa-seg__btn--on' : ''}`}
            onClick={() => select('asked')}
          >
            Asked
            {data ? <span className="qa-seg__count">{asked.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'answered'}
            className={`qa-seg__btn text-body${tab === 'answered' ? ' qa-seg__btn--on' : ''}`}
            onClick={() => select('answered')}
          >
            Your answers
            {data ? <span className="qa-seg__count">{answered.length}</span> : null}
          </button>
        </div>

        {pending ? (
          <div aria-hidden="true">
            <QaCoverRows count={3} />
          </div>
        ) : null}

        {error && data == null ? (
          <EmptyState
            size="compact"
            title="Couldn't load your questions"
            body="Check your connection and try again."
            cta="Try again"
            onCta={() => refresh().catch(() => {})}
            ctaVariant="secondary"
          />
        ) : null}

        {data && tab === 'asked' && asked.length === 0 ? (
          <div className="qa-mine-empty">
            <EmptyState
              size="compact"
              title="You haven't asked anything yet"
              body="Stuck on a boss, a puzzle or a build? Ask players who've played it."
            />
          </div>
        ) : null}

        {data && tab === 'answered' && answered.length === 0 ? (
          <div className="qa-mine-empty">
            <EmptyState
              size="compact"
              title="You haven't answered anything yet"
            />
          </div>
        ) : null}

        {data && tab === 'asked' && asked.length > 0 ? (
          <MineGroup
            rows={asked.map((item) => ({ key: item.id, node: <AskedRow item={item} /> }))}
          />
        ) : null}

        {data && tab === 'answered' && answered.length > 0 ? (
          <MineGroup
            rows={answered.map((row) => ({
              key: row.answer?.id || row.question?.id,
              node: <AnsweredRow row={row} />,
            }))}
          />
        ) : null}
      </div>
    </div>
  )
}
