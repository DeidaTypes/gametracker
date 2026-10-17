import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronRight,
  EyeOff,
  MessageCircleQuestion,
  Trash2,
  Users,
} from 'lucide-react'
import { LuSend } from 'react-icons/lu'
import { useAuth } from '../../contexts/AuthContext'
import Avatar from '../../components/Avatar'
import EmptyState from '../../components/EmptyState'
import { useHideNav } from '../../hooks/useHideNav'
import { useCachedResource } from '../../hooks/useCachedResource'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaQuestion, qaQuestionKey } from '../../services/qaService'
import { openQaAnswer } from './qaComposer'
import {
  QaAnswerRow,
  QaAskerRow,
  QaBestAnswerCard,
} from './QaAnswerBlock'
import QaPushBar from './QaPushBar'
import QaSpoilerBlock from './QaSpoilerBlock'
import { QaPlainRows, QaQuestionBlock } from './QaPlaceholders'
import {
  bestAnswerHeadline,
  formatQuestionTags,
  questionStatusPill,
} from './qaFormat'
import './qa.css'

const INITIAL_ANSWERS = 5

function StatusPill({ pill, spoiler }) {
  return (
    <span className="qa-ctx__pills">
      {spoiler ? (
        <span className="qa-chip">
          <EyeOff size={12} aria-hidden="true" />
          Spoiler
        </span>
      ) : null}
      {pill ? (
        <span
          className={`qa-chip${
            pill.kind === 'answered'
              ? ' qa-chip--acc'
              : pill.kind === 'community' || pill.kind === 'waiting' || pill.kind === 'open'
                ? ' qa-chip--soc'
                : ''
          }`}
        >
          {pill.kind === 'answered' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
          {pill.label}
        </span>
      ) : null}
    </span>
  )
}

export default function QaQuestion() {
  const { questionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  useHideNav()

  const key = qaQuestionKey(questionId)
  const { data, error } = useCachedResource(key, () => qaQuestion(questionId), {
    enabled: !!questionId,
  })

  const [showAllAnswers, setShowAllAnswers] = useState(false)
  const [stuckOn, setStuckOn] = useState(false)

  const pending = data === undefined && !error
  const state = data?.state

  const payload = state === 'ok' ? data : null
  const question = payload?.question
  const answers = payload?.answers ?? []
  const status = payload?.status
  const viewerIsAsker = payload?.viewer_is_asker === true
  const stuckCount = payload?.stuck?.count ?? 0

  const bestAnswer = useMemo(() => {
    if (!payload) return null
    const pickId = payload.pick_answer_id
    if (!pickId) return null
    return answers.find((a) => a.id === pickId && !a.removed) || null
  }, [payload, answers])

  const otherAnswers = useMemo(() => {
    if (!bestAnswer) return answers.filter((a) => !a.removed)
    return answers.filter((a) => !a.removed && a.id !== bestAnswer.id)
  }, [answers, bestAnswer])

  const flatOthers = showAllAnswers ? otherAnswers : otherAnswers.slice(0, INITIAL_ANSWERS)
  const hiddenOthers = Math.max(0, otherAnswers.length - INITIAL_ANSWERS)

  const pill = question
    ? questionStatusPill({
        status,
        viewerIsAsker,
        answerCount: answers.filter((a) => !a.removed).length,
      })
    : null

  const coverUrl = question?.game_cover_image_id
    ? coverUrlFromImageId(question.game_cover_image_id, 'cover_small')
    : null

  const bestHeadline =
    bestAnswer && question
      ? bestAnswerHeadline({
          status,
          askerUsername: question.asker?.username,
          helpfulCount: bestAnswer.helpful_count,
        })
      : ''

  const composerText = viewerIsAsker
    ? 'Figured it out? Answer it yourself'
    : 'Add your answer…'

  const openAnswer = (reply) => {
    if (!question) return
    openQaAnswer({
      questionId: question.id,
      questionTitle: question.title,
      igdbGameId: question.igdb_game_id,
      replyToUserId: reply?.author?.id || null,
      replyToUsername: reply?.author?.username || null,
    })
  }

  if (state === 'not_found' || state === 'removed') {
    const removed = state === 'removed'
    return (
      <div className="qa-screen qa-screen--push qa-screen--question">
        <QaPushBar onBack={() => navigate(-1)} />
        <div className="qa-push-body qa-q-empty-page">
          <EmptyState
            icon={Trash2}
            title={removed ? 'This question was removed for breaking the rules' : 'This question was deleted'}
            body={
              removed
                ? undefined
                : 'The person who asked it removed it before anyone answered.'
            }
            cta="Back to Q&A"
            onCta={() => navigate('/qa')}
            ctaVariant="secondary"
          />
        </div>
      </div>
    )
  }

  const answerCount = answers.filter((a) => !a.removed).length
  const noAnswers = answerCount === 0 && !pending

  return (
    <div className="qa-screen qa-screen--push qa-screen--question" aria-busy={pending || undefined}>
      <QaPushBar onBack={() => navigate(-1)} onMore={() => {}} />

      <div className="qa-q-scroll">
        {pending && !question ? (
          <div className="qa-push-body" aria-hidden="true">
            <QaQuestionBlock />
            <QaPlainRows count={3} />
          </div>
        ) : null}

        {question ? (
          <div className="qa-push-body">
            <div className="qa-ctx">
              <Link to={`/qa/game/${question.igdb_game_id}`} className="qa-ctx__game text-caption">
                {coverUrl ? <img src={coverUrl} alt="" className="qa-ctx__cover" /> : null}
                <span>{question.game_title}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </Link>
              <StatusPill pill={pill} spoiler={question.is_spoiler} />
            </div>

            <h1 className="text-heading qa-q-title">{question.title}</h1>
            <p className="text-caption qa-q-tags">{formatQuestionTags(question)}</p>

            <div className="qa-q-asker">
              <QaAskerRow question={question} viewerIsAsker={viewerIsAsker} />
            </div>

            {question.body ? (
              <div className="qa-q-body">
                {question.is_spoiler ? (
                  <QaSpoilerBlock>
                    <p className="qa-prose text-body">{question.body}</p>
                  </QaSpoilerBlock>
                ) : (
                  <p className="qa-prose text-body">{question.body}</p>
                )}
              </div>
            ) : null}

            {stuckCount > 0 ? (
              <div className="qa-stuck-row">
                <button
                  type="button"
                  className="qa-act-btn"
                  aria-pressed={stuckOn}
                  onClick={() => setStuckOn((v) => !v)}
                >
                  <Users size={16} aria-hidden="true" />
                  Stuck here too
                </button>
                <p className="text-caption qa-stuck-row__meta">
                  <strong>{stuckCount} player{stuckCount === 1 ? '' : 's'}</strong> are stuck here
                </p>
              </div>
            ) : null}

            <div className="qa-divider" />

            {noAnswers ? (
              <EmptyState
                size="compact"
                icon={MessageCircleQuestion}
                title="No answers yet"
                body={
                  question.game_title
                    ? `Players who've played ${question.game_title} see it at the top of their Unanswered list.`
                    : undefined
                }
                cta="Share question"
                onCta={() => {}}
                ctaVariant="secondary"
              />
            ) : (
              <>
                {bestAnswer ? (
                  <QaBestAnswerCard answer={bestAnswer} headline={bestHeadline} onReply={openAnswer} />
                ) : null}

                {otherAnswers.length > 0 ? (
                  <div className="qa-answers-head">
                    <h2 className="text-title">
                      {otherAnswers.length} more answer{otherAnswers.length === 1 ? '' : 's'}
                    </h2>
                    <span className="qa-link-btn text-caption">Most helpful</span>
                  </div>
                ) : null}

                {flatOthers.map((answer, i) => (
                  <div key={answer.id}>
                    {i > 0 || bestAnswer ? <div className="qa-divider" /> : null}
                    <QaAnswerRow answer={answer} onReply={openAnswer} />
                  </div>
                ))}

                {!showAllAnswers && hiddenOthers > 0 ? (
                  <button
                    type="button"
                    className="qa-show-more text-caption"
                    onClick={() => setShowAllAnswers(true)}
                  >
                    Show {hiddenOthers} more answer{hiddenOthers === 1 ? '' : 's'}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="kb-composer-bar composer-bar qa-composer-dock">
        <div className="composer__row">
          <Avatar user={user} size="sm" className="qa-composer-dock__av" />
          <button type="button" className="qa-fake-in text-body" onClick={() => openAnswer(null)}>
            <span>{composerText}</span>
            <span className="qa-fake-in__send" aria-hidden="true">
              <LuSend size={14} />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
