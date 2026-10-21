import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Award,
  Ban,
  Check,
  ChevronRight,
  EyeOff,
  Flag,
  Link2,
  MessageCircleQuestion,
  Pencil,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { LuSend } from 'react-icons/lu'
import { motion } from 'motion/react'
import { useAuth } from '../../contexts/AuthContext'
import ActionSheet from '../../components/ActionSheet'
import Avatar from '../../components/Avatar'
import EmptyState from '../../components/EmptyState'
import ReportSheet from '../../components/ReportSheet'
import { showToast } from '../../components/Toast'
import { useHideNav } from '../../hooks/useHideNav'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useCachedResource } from '../../hooks/useCachedResource'
import { BLOCK_CHANGED_EVENT, blockUser, isMutuallyBlocked } from '../../services/blockService'
import { coverUrlFromImageId } from '../../services/igdb'
import { withdrawReport } from '../../services/reportService'
import {
  deleteAnswer,
  deleteQuestion,
  markBest,
  qaQuestion,
  qaQuestionKey,
  toggleHelpful,
  toggleStuck,
  unmarkBest,
} from '../../services/qaService'
import { hapticImpact } from '../../utils/haptics'
import {
  applyBest,
  removeAnswerLocal,
  removeQaQuestionFromLists,
  setAnswerHelpful,
  setStuck,
} from './qaCache'
import { openQaAnswer, openQaEditAnswer, openQaEditQuestion } from './qaComposer'
import { hideQaAnswer, hideQaQuestion, showQaAnswer, showQaQuestion, useQaHides } from './qaHides'
import { copyQaLink, shareQaQuestion } from './qaShare'
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
  displayNameFor,
  formatQuestionTags,
  questionStatusPill,
} from './qaFormat'
import './qa.css'

const INITIAL_ANSWERS = 5

const WRITE_TOAST = {
  offline: "You're offline.",
  not_allowed: "Couldn't save that.",
  has_answers: "Can't delete once it has answers. You can still edit it.",
  blocked: "You can't do that.",
  unknown: "Couldn't save that. Try again.",
}

function toastWrite(code) {
  showToast(WRITE_TOAST[code] || WRITE_TOAST.unknown, 'error')
}

let lastLeaveAt = 0

function leaveQuestion(navigate) {
  const now = Date.now()
  if (now - lastLeaveAt < 400) return
  lastLeaveAt = now
  if (window.history.length > 1) navigate(-1)
  else navigate('/qa')
}

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

function MovingAnswer({ id, reduced, children }) {
  if (reduced) return children
  return (
    <motion.div
      layout
      layoutId={`qa-answer-${id}`}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function stuckCopy(count) {
  const n = Number(count) || 0
  if (n <= 0) return null
  const people = n === 1 ? '1 player' : `${n} players`
  const verb = n === 1 ? 'is stuck here' : 'are stuck here'
  return { people, verb }
}

export default function QaQuestion() {
  const { questionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { reduced } = useMotionPreference()
  const hides = useQaHides()
  useHideNav()

  const key = qaQuestionKey(questionId)
  const { data, error } = useCachedResource(key, () => qaQuestion(questionId), {
    enabled: !!questionId,
  })

  const [showAllAnswers, setShowAllAnswers] = useState(false)
  const [menu, setMenu] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [report, setReport] = useState(null)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockTick, setBlockTick] = useState(0)
  const [forcedLeave, setForcedLeave] = useState(false)
  const opToken = useRef(new Map())
  const writeChain = useRef(Promise.resolve())

  const pending = data === undefined && !error
  const state = data?.state
  const payload = state === 'ok' ? data : null
  const question = payload?.question
  const answers = payload?.answers ?? []
  const status = payload?.status
  const viewerIsAsker = payload?.viewer_is_asker === true
  const stuck = payload?.stuck
  const stuckCount = stuck?.count ?? 0
  const viewerStuck = stuck?.viewer_stuck === true

  const questionHidden = !!(question && hides.hasQuestion(question.id))
  // blockTick re-renders this screen after a block so the cache read below is current.
  const askerBlocked = !!(question?.asker?.id && blockTick >= 0 && isMutuallyBlocked(question.asker.id))

  useEffect(() => {
    const onBlock = () => setBlockTick((n) => n + 1)
    window.addEventListener(BLOCK_CHANGED_EVENT, onBlock)
    return () => window.removeEventListener(BLOCK_CHANGED_EVENT, onBlock)
  }, [])

  useEffect(() => {
    if (questionHidden || askerBlocked || forcedLeave) leaveQuestion(navigate)
  }, [questionHidden, askerBlocked, forcedLeave, navigate])

  const visibleAnswers = useMemo(
    () => answers.filter((answer) => answer.removed || !hides.hasAnswer(answer.id)),
    // hides.tick refreshes the module set the filter reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, hides.tick],
  )

  const bestAnswer = useMemo(() => {
    if (!payload) return null
    const pickId = payload.pick_answer_id
    if (!pickId) return null
    return visibleAnswers.find((answer) => answer.id === pickId && !answer.removed) || null
  }, [payload, visibleAnswers])

  const otherAnswers = useMemo(() => {
    if (!bestAnswer) return visibleAnswers.filter((answer) => !answer.removed)
    return visibleAnswers.filter((answer) => !answer.removed && answer.id !== bestAnswer.id)
  }, [visibleAnswers, bestAnswer])

  const flatOthers = showAllAnswers ? otherAnswers : otherAnswers.slice(0, INITIAL_ANSWERS)
  const hiddenOthers = Math.max(0, otherAnswers.length - INITIAL_ANSWERS)
  const liveCount = visibleAnswers.filter((answer) => !answer.removed).length
  const hasAnyAnswers = answers.some((answer) => answer && answer.id)
  const canMark = viewerIsAsker && status === 'open' && liveCount > 0

  const pill = question
    ? questionStatusPill({
        status,
        viewerIsAsker,
        answerCount: liveCount,
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

  const bump = (id) => {
    const next = (opToken.current.get(id) || 0) + 1
    opToken.current.set(id, next)
    return next
  }

  const enqueue = (fn) => {
    const job = writeChain.current.catch(() => {}).then(fn)
    writeChain.current = job
    return job
  }

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

  const onHelpful = async (answer) => {
    if (!question || answer.is_own) return
    const tokenKey = `h:${answer.id}`
    const token = bump(tokenKey)
    const before = {
      on: !!answer.viewer_helpful,
      count: Number(answer.helpful_count) || 0,
    }
    const nextOn = !before.on
    const nextCount = Math.max(0, before.count + (nextOn ? 1 : -1))
    const isPick = payload?.pick_answer_id === answer.id
    setAnswerHelpful(question.id, answer.id, { on: nextOn, count: nextCount }, { isPick })
    hapticImpact('Light')
    enqueue(async () => {
      const result = await toggleHelpful(answer.id, {
        questionId: question.id,
        igdbGameId: question.igdb_game_id,
        want: nextOn,
      })
      if (opToken.current.get(tokenKey) !== token) return
      if (result?.error) {
        setAnswerHelpful(question.id, answer.id, before, { isPick })
        toastWrite(result.error.code)
      }
    })
  }

  const onStuck = async () => {
    if (!question || viewerIsAsker) return
    const token = bump('stuck')
    const before = { on: viewerStuck, count: Number(stuckCount) || 0 }
    const nextOn = !before.on
    const nextCount = Math.max(0, before.count + (nextOn ? 1 : -1))
    setStuck(question.id, { on: nextOn, count: nextCount })
    enqueue(async () => {
      const result = await toggleStuck(question.id, {
        igdbGameId: question.igdb_game_id,
        want: nextOn,
      })
      if (opToken.current.get('stuck') !== token) return
      if (result?.error) {
        setStuck(question.id, before)
        toastWrite(result.error.code)
      }
    })
  }

  const onMarkBest = async (answer) => {
    if (!question || !canMark) return
    const token = bump('best')
    const beforeId = question.best_answer_id || null
    const beforeAnswer = answers.find((row) => row.id === beforeId) || null
    applyBest(question.id, answer.id, { answer, liveCount })
    enqueue(async () => {
      const result = await markBest(question.id, answer.id, { igdbGameId: question.igdb_game_id })
      if (opToken.current.get('best') !== token) return
      if (result?.error) {
        applyBest(question.id, beforeId, { answer: beforeAnswer, liveCount })
        toastWrite(result.error.code)
        return
      }
      showToast('Marked as best answer', 'success', 5000, {
      label: 'Undo',
      onClick: () => {
        const undoToken = bump('best')
        applyBest(question.id, beforeId, { answer: beforeAnswer, liveCount })
        enqueue(async () => {
          const undoResult = beforeId
            ? await markBest(question.id, beforeId, { igdbGameId: question.igdb_game_id })
            : await unmarkBest(question.id, { igdbGameId: question.igdb_game_id })
          if (opToken.current.get('best') !== undoToken) return
          if (undoResult?.error) toastWrite(undoResult.error.code)
        })
      },
    })
    })
  }

  const onUnmark = async () => {
    if (!question) return
    const token = bump('best')
    const beforeId = question.best_answer_id || null
    const beforeAnswer = answers.find((row) => row.id === beforeId) || null
    applyBest(question.id, null, { liveCount })
    enqueue(async () => {
      const result = await unmarkBest(question.id, { igdbGameId: question.igdb_game_id })
      if (opToken.current.get('best') !== token) return
      if (result?.error) {
        applyBest(question.id, beforeId, { answer: beforeAnswer, liveCount })
        toastWrite(result.error.code)
      }
    })
  }

  const onDeleteQuestion = async () => {
    if (!question) return
    const result = await deleteQuestion(question.id, { igdbGameId: question.igdb_game_id })
    if (result?.error) {
      toastWrite(result.error.code)
      return
    }
    removeQaQuestionFromLists(question.id)
    showToast('Question deleted', 'success')
    leaveQuestion(navigate)
  }

  const onDeleteAnswer = async (answer) => {
    if (!question || !answer) return
    const result = await deleteAnswer(answer.id, {
      questionId: question.id,
      igdbGameId: question.igdb_game_id,
    })
    if (result?.error) {
      toastWrite(result.error.code)
      return
    }
    removeAnswerLocal(question.id, answer.id)
    showToast('Answer deleted', 'success')
  }

  const onBlock = async (target) => {
    if (!target?.id || blockBusy) return
    setBlockBusy(true)
    try {
      await blockUser(target.id)
      showToast(`Blocked ${target.name || 'them'}`, 'success')
      if (target.isAsker && !isMutuallyBlocked(target.id)) setForcedLeave(true)
    } catch (err) {
      console.error('[qa] block failed:', err)
      showToast("Couldn't block them. Try again.", 'error')
    } finally {
      setBlockBusy(false)
    }
  }

  const finishReport = (target) => {
    if (!target?.id) return
    if (target.type === 'question') hideQaQuestion(target.id)
    else hideQaAnswer(target.id)
    showToast("Reported. It's hidden for you.", 'success', 5000, {
      label: 'Undo',
      onClick: () => {
        if (target.type === 'question') showQaQuestion(target.id)
        else showQaAnswer(target.id)
        withdrawReport({ contentType: target.type, contentId: target.id })
      },
    })
    if (target.type === 'question') leaveQuestion(navigate)
  }

  const answerActions = {
    onReply: openAnswer,
    onHelpful,
    onMore: (answer) => setMenu({ kind: 'answer', answer }),
    canMark,
    onMarkBest,
  }

  const menuAnswer = menu?.kind === 'answer' ? menu.answer : null
  const menuName = menuAnswer
    ? (menuAnswer.author_deleted ? null : displayNameFor(menuAnswer.author))
    : null
  const answerIsBest = !!(menuAnswer && question?.best_answer_id === menuAnswer.id)
  const answerIsOwn = menuAnswer?.is_own === true

  const questionItems = question
    ? viewerIsAsker
      ? [
          {
            label: 'Edit question',
            detail: 'Shows "Edited" to everyone',
            icon: <Pencil size={20} />,
            onClick: () => openQaEditQuestion(question),
          },
          {
            label: 'Share',
            icon: <Upload size={20} />,
            onClick: () => shareQaQuestion(question),
          },
          {
            label: 'Copy link',
            icon: <Link2 size={20} />,
            onClick: () => copyQaLink(question.id),
          },
          { divider: true },
          {
            label: 'Delete question',
            detail: hasAnyAnswers
              ? "Can't delete once it has answers. You can still edit it."
              : null,
            icon: <Trash2 size={20} />,
            destructive: !hasAnyAnswers,
            disabled: hasAnyAnswers,
            onClick: () => setConfirm({ kind: 'delete-question' }),
          },
        ]
      : [
          {
            label: 'Copy link',
            icon: <Link2 size={20} />,
            onClick: () => copyQaLink(question.id),
          },
          {
            label: 'Report question',
            icon: <Flag size={20} />,
            destructive: true,
            onClick: () => setReport({ type: 'question', id: question.id }),
          },
          ...(question.asker?.id && !question.asker_deleted
            ? [{
                label: `Block ${displayNameFor(question.asker) || 'player'}`,
                icon: <Ban size={20} />,
                destructive: true,
                onClick: () => setConfirm({
                  kind: 'block',
                  id: question.asker.id,
                  name: displayNameFor(question.asker) || 'player',
                  isAsker: true,
                }),
              }]
            : []),
        ]
    : []

  const answerItems = menuAnswer
    ? [
        ...(viewerIsAsker && answerIsBest
          ? [{
              label: 'Unmark best answer',
              detail: 'The question goes back to Unanswered',
              icon: <Award size={20} />,
              onClick: () => onUnmark(),
            }]
          : []),
        ...(answerIsOwn
          ? [{
              label: 'Edit',
              icon: <Pencil size={20} />,
              onClick: () => openQaEditAnswer({
                questionId: question.id,
                questionTitle: question.title,
                igdbGameId: question.igdb_game_id,
                answer: menuAnswer,
              }),
            }]
          : []),
        {
          label: 'Copy link',
          icon: <Link2 size={20} />,
          onClick: () => copyQaLink(question.id),
        },
        ...(answerIsOwn
          ? [
              { divider: true },
              {
                label: 'Delete',
                icon: <Trash2 size={20} />,
                destructive: true,
                onClick: () => setConfirm({ kind: 'delete-answer', answer: menuAnswer }),
              },
            ]
          : [
              { divider: true },
              {
                label: 'Report answer',
                icon: <Flag size={20} />,
                destructive: true,
                onClick: () => setReport({ type: 'answer', id: menuAnswer.id }),
              },
              ...(menuAnswer.author?.id && !menuAnswer.author_deleted
                ? [{
                    label: `Block ${menuName || 'player'}`,
                    icon: <Ban size={20} />,
                    destructive: true,
                    onClick: () => setConfirm({
                      kind: 'block',
                      id: menuAnswer.author.id,
                      name: menuName || 'player',
                      isAsker: false,
                    }),
                  }]
                : []),
            ]),
      ]
    : []

  if ((questionHidden || askerBlocked || forcedLeave) && question) {
    return <div className="qa-screen qa-screen--push qa-screen--question" />
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

  const noAnswers = liveCount === 0 && !pending
  const stuckLine = stuckCopy(stuckCount)
  const showStuck = !!question && !viewerIsAsker

  return (
    <div className="qa-screen qa-screen--push qa-screen--question" aria-busy={pending || undefined}>
      <QaPushBar onBack={() => navigate(-1)} onMore={question ? () => setMenu({ kind: 'question' }) : undefined} />

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
                {question.is_spoiler && !viewerIsAsker ? (
                  <QaSpoilerBlock>
                    <p className="qa-prose text-body">{question.body}</p>
                  </QaSpoilerBlock>
                ) : (
                  <p className="qa-prose text-body">{question.body}</p>
                )}
              </div>
            ) : null}

            {pill?.kind === 'waiting' ? (
              <div className="qa-banner" role="note">
                <Award size={18} aria-hidden="true" />
                <span>Got your answer? Mark it as best so the next player finds it fast.</span>
              </div>
            ) : null}

            {showStuck ? (
              <div className="qa-stuck-row">
                <button
                  type="button"
                  className={`qa-act-btn${viewerStuck ? ' qa-act-btn--on' : ''}`}
                  aria-pressed={viewerStuck}
                  onClick={onStuck}
                >
                  <Users size={16} aria-hidden="true" />
                  Stuck here too
                </button>
                {stuckLine ? (
                  <p className="text-caption qa-stuck-row__meta">
                    <strong>{stuckLine.people}</strong>
                    {` ${stuckLine.verb}`}
                  </p>
                ) : null}
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
                onCta={() => shareQaQuestion(question)}
                ctaVariant="secondary"
              />
            ) : (
              <>
                {bestAnswer ? (
                  <MovingAnswer id={bestAnswer.id} reduced={reduced}>
                    <QaBestAnswerCard
                      answer={bestAnswer}
                      headline={bestHeadline}
                      {...answerActions}
                    />
                  </MovingAnswer>
                ) : null}

                {otherAnswers.length > 0 ? (
                  <div className="qa-answers-head">
                    <h2 className="text-title">
                      {bestAnswer
                        ? `${otherAnswers.length} more answer${otherAnswers.length === 1 ? '' : 's'}`
                        : `${otherAnswers.length} answer${otherAnswers.length === 1 ? '' : 's'}`}
                    </h2>
                    <span className="qa-link-btn text-caption">Most helpful</span>
                  </div>
                ) : null}

                {flatOthers.map((answer, i) => (
                  <div key={answer.id}>
                    {i > 0 || bestAnswer ? <div className="qa-divider" /> : null}
                    <MovingAnswer id={answer.id} reduced={reduced}>
                      <QaAnswerRow answer={answer} {...answerActions} />
                    </MovingAnswer>
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

      <ActionSheet
        isOpen={menu?.kind === 'question'}
        onClose={() => setMenu(null)}
        plain
        title={viewerIsAsker ? 'Your question' : `${displayNameFor(question?.asker) || 'Player'}'s question`}
        subtitle={question?.title}
        items={questionItems}
      />
      <ActionSheet
        isOpen={!!menuAnswer}
        onClose={() => setMenu(null)}
        plain
        title={answerIsOwn ? 'Your answer' : menuName ? `${menuName}'s answer` : 'Answer'}
        subtitle={viewerIsAsker && answerIsBest ? 'Marked as your best answer' : null}
        items={answerItems}
      />
      <ActionSheet
        isOpen={confirm?.kind === 'delete-question'}
        onClose={() => setConfirm(null)}
        title="Delete this question?"
        items={[{
          label: 'Delete question',
          destructive: true,
          onClick: () => onDeleteQuestion(),
        }]}
      />
      <ActionSheet
        isOpen={confirm?.kind === 'delete-answer'}
        onClose={() => setConfirm(null)}
        title="Delete this answer?"
        items={[{
          label: 'Delete answer',
          destructive: true,
          onClick: () => onDeleteAnswer(confirm?.answer),
        }]}
      />
      <ActionSheet
        isOpen={confirm?.kind === 'block'}
        onClose={() => { if (!blockBusy) setConfirm(null) }}
        title={`Block ${confirm?.name || 'player'}? They won't be able to see your questions or answers, and you won't see theirs.`}
        items={[{
          label: blockBusy ? 'Blocking…' : `Block ${confirm?.name || 'player'}`,
          destructive: true,
          disabled: blockBusy,
          onClick: () => onBlock(confirm),
        }]}
      />
      <ReportSheet
        isOpen={!!report}
        onClose={() => setReport(null)}
        contentType={report?.type}
        contentId={report?.id}
        onSubmitted={() => finishReport(report)}
      />
    </div>
  )
}
