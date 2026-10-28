import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Award,
  Check,
  ChevronRight,
  EyeOff,
  MapPin,
  MessageCircleQuestion,
  Share,
  Trash2,
  Users,
} from 'lucide-react'
import {
  LuArrowUp,
  LuAward,
  LuBan,
  LuFlag,
  LuLink,
  LuPencil,
  LuShare2,
  LuTrash2,
} from 'react-icons/lu'
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
import { peekSWR, subscribeSWR } from '../../services/swrCache'
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
import { hapticImpact, hapticSuccess } from '../../utils/haptics'
import {
  applyBest,
  removeAnswerLocal,
  removeQaQuestionFromLists,
  setAnswerHelpful,
  setStuck,
} from './qaCache'
import { openQaAnswer, openQaEditAnswer, openQaEditQuestion } from './qaComposer'
import { hideQaAnswer, hideQaQuestion, showQaAnswer, showQaQuestion, useQaHides } from './qaHides'
import { copyQaLink, shareQaQuestion, QA_LINKS_AVAILABLE } from './qaShare'
import {
  QaAnswerRow,
  QaAskerRow,
  QaBestAnswerCard,
} from './QaAnswerBlock'
import QaPushBar from './QaPushBar'
import QaSpoilerBlock from './QaSpoilerBlock'
import { useOnline } from './useOnline'
import {
  QaAnswersPlaceholder,
  QaContextPlaceholder,
  QaHeadPlaceholder,
  QaPersonPlaceholder,
  QaQuestionTailPlaceholder,
} from './QaPlaceholders'
import { bestAnswerHeadline, displayNameFor, topicLabel } from './qaFormat'
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

/**
 * `answerCount` is null when it isn't known yet (a seed without a count), so
 * an open question shows no pill rather than a guessed one.
 */
function statusPill({ status, viewerIsAsker, answerCount }) {
  if (status === 'best') return { kind: 'answered', label: 'Answered' }
  if (status === 'community_pick') return { kind: 'community', label: 'Community pick' }
  if (status !== 'open' || answerCount == null) return null
  if (answerCount === 0) return { kind: 'open', label: 'No answers yet' }
  if (viewerIsAsker) {
    return { kind: 'waiting', label: `${answerCount} answer${answerCount === 1 ? '' : 's'}` }
  }
  return null
}

const PILL_CLASS = {
  answered: ' qa-pill--review',
  community: ' qa-pill--review',
  waiting: ' qa-pill--primary',
  open: ' qa-pill--journal',
}

function StatusPill({ pill, spoiler }) {
  if (!pill && !spoiler) return null
  return (
    <span className="qa-ctx__pills">
      {spoiler ? (
        <span className="qa-pill">
          <EyeOff size={13} aria-hidden="true" />
          Spoiler
        </span>
      ) : null}
      {pill ? (
        <span className={`qa-pill${PILL_CLASS[pill.kind] || ''}`}>
          {pill.kind === 'answered' ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : null}
          {pill.label}
        </span>
      ) : null}
    </span>
  )
}

function QuestionTags({ question }) {
  const topic = topicLabel(question.topic)
  if (!topic && !question.platform) return null
  return (
    <div className="qa-tags">
      {topic ? <span className="qa-tag qa-tag--topic">{topic}</span> : null}
      {question.platform ? <span className="qa-tag">{question.platform}</span> : null}
    </div>
  )
}

/**
 * Where in the game. List rows don't carry it, so the seed can never have it:
 * it is the first line of the body block (which arrives with the full
 * question), not a tag. The tag row stays exactly what the seed painted.
 */
function QuestionLocation({ location }) {
  if (!location) return null
  return (
    <p className="qa-qloc text-caption">
      <MapPin size={14} aria-hidden="true" />
      <span>{location}</span>
    </p>
  )
}

/**
 * A block that arrives after the first paint fades in once (180ms). One that
 * is already there on the first frame (cache hit, or the seed) never animates.
 * `armed` is read once, when the block mounts.
 */
function SwapIn({ armed, className = '', children }) {
  const [fade] = useState(armed)
  const classes = `${className}${fade ? ' qa-swap-in' : ''}`.trim()
  return <div className={classes || undefined}>{children}</div>
}

function ContextRow({ question, pill }) {
  const coverUrl = question.game_cover_image_id
    ? coverUrlFromImageId(question.game_cover_image_id, 'cover_small')
    : null
  const inner = (
    <>
      {coverUrl ? (
        <img src={coverUrl} alt="" className="qa-ctx__cover" />
      ) : (
        <span className="qa-ctx__cover qa-fill" aria-hidden="true" />
      )}
      <span className="qa-ctx__title">{question.game_title}</span>
      <ChevronRight size={14} aria-hidden="true" />
    </>
  )
  return (
    <div className="qa-ctx">
      {question.igdb_game_id != null ? (
        <Link to={`/qa/game/${question.igdb_game_id}`} className="qa-ctx__game">
          {inner}
        </Link>
      ) : (
        <span className="qa-ctx__game">{inner}</span>
      )}
      <StatusPill pill={pill} spoiler={question.is_spoiler === true} />
    </div>
  )
}

function NoAnswersCard({ question }) {
  return (
    <div className="qa-noans">
      <span className="qa-noans__icon" aria-hidden="true">
        <MessageCircleQuestion size={18} />
      </span>
      <div className="qa-noans__col">
        <h3 className="qa-noans__title">No answers yet</h3>
        {question.game_title ? (
          <p className="qa-noans__body text-caption">
            {`Players who've played ${question.game_title} see it at the top of their Unanswered list.`}
          </p>
        ) : null}
        <button type="button" className="qa-act-btn" onClick={() => shareQaQuestion(question)}>
          <Share size={15} aria-hidden="true" />
          Share question
        </button>
      </div>
    </div>
  )
}

function MovingAnswer({ id, reduced, children }) {
  if (reduced) return <div data-qa-answer-id={id}>{children}</div>
  return (
    <motion.div
      data-qa-answer-id={id}
      layout
      layoutId={`qa-answer-${id}`}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function playersCount(count) {
  const n = Number(count) || 0
  return n === 1 ? '1 player' : `${n} players`
}

export default function QaQuestion() {
  const { questionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const focusAnswerId = location.state?.focusAnswerId || null
  const { profile } = useAuth()
  const { reduced } = useMotionPreference()
  const hides = useQaHides()
  useHideNav()

  const key = qaQuestionKey(questionId)
  const { error, refresh } = useCachedResource(key, () => qaQuestion(questionId), {
    enabled: !!questionId,
  })
  // The payload is applied the moment it lands in the cache, including mid-slide.
  // useCachedResource holds replacements until the slide ends; this doesn't.
  const data = useSyncExternalStore(
    useCallback((onChange) => subscribeSWR(key, onChange), [key]),
    () => peekSWR(key),
  )
  // False only for the first render. Blocks that mount later fade in.
  const firstPaint = useRef(true)
  useEffect(() => {
    firstPaint.current = false
  }, [])
  const armed = !firstPaint.current

  // Opened offline: the seed holds the screen. Coming back online loads the rest.
  const online = useOnline()
  const wasOnline = useRef(online)

  const [showAllAnswers, setShowAllAnswers] = useState(false)
  const [menu, setMenu] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [report, setReport] = useState(null)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockTick, setBlockTick] = useState(0)
  const [forcedLeave, setForcedLeave] = useState(false)
  const opToken = useRef(new Map())
  const writeChain = useRef(Promise.resolve())

  const state = data?.state
  const payload = state === 'ok' ? data : null
  const seed = state === 'seed' ? data : null
  const loaded = !!payload

  useEffect(() => {
    if (online && !wasOnline.current && !loaded) refresh().catch(() => {})
    wasOnline.current = online
  }, [online, loaded, refresh])
  const pending = !loaded && (data === undefined || !!seed) && !error
  const question = payload?.question ?? seed?.question ?? null
  const answers = payload?.answers ?? []
  const status = payload ? payload.status : seed?.status
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

  // Opened from a notification: reveal the answer if it sits under "Show more",
  // then scroll to it once, after it has rendered.
  const focusedRef = useRef(null)
  const focusIndex = focusAnswerId ? otherAnswers.findIndex((a) => a.id === focusAnswerId) : -1
  useEffect(() => {
    if (focusIndex >= INITIAL_ANSWERS) setShowAllAnswers(true)
  }, [focusIndex])
  useEffect(() => {
    if (!loaded || !focusAnswerId || focusedRef.current === focusAnswerId) return undefined
    const frame = window.requestAnimationFrame(() => {
      const el = document.querySelector(`[data-qa-answer-id="${CSS.escape(focusAnswerId)}"]`)
      if (!el) return
      focusedRef.current = focusAnswerId
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loaded, focusAnswerId, reduced, showAllAnswers, bestAnswer])

  const flatOthers = showAllAnswers ? otherAnswers : otherAnswers.slice(0, INITIAL_ANSWERS)
  const hiddenOthers = Math.max(0, otherAnswers.length - INITIAL_ANSWERS)
  const liveCount = visibleAnswers.filter((answer) => !answer.removed).length
  const hasAnyAnswers = answers.some((answer) => answer && answer.id)
  const canMark = viewerIsAsker && status === 'open' && liveCount > 0

  const seedCount = seed?.answer_count != null && Number.isFinite(Number(seed.answer_count))
    ? Number(seed.answer_count)
    : null
  const answerCount = loaded ? liveCount : seedCount

  const pill = question
    ? statusPill({ status, viewerIsAsker, answerCount })
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
    : 'Answer this question…'

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
    hapticImpact('Light')
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
    hapticSuccess()
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
        hapticImpact('Light')
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
    if (!question || !question.best_answer_id) return
    const token = bump('best')
    const beforeId = question.best_answer_id
    const beforeAnswer = answers.find((row) => row.id === beforeId) || null
    applyBest(question.id, null, { liveCount })
    hapticImpact('Light')
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
    hapticImpact('Medium')
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
    hapticImpact('Medium')
    showToast('Answer deleted', 'success')
  }

  const onBlock = async (target) => {
    if (!target?.id || blockBusy) return
    setBlockBusy(true)
    try {
      await blockUser(target.id)
      hapticImpact('Medium')
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
            icon: <LuPencil size={18} />,
            onClick: () => openQaEditQuestion(question),
          },
          {
            label: 'Share',
            icon: <LuShare2 size={18} />,
            onClick: () => shareQaQuestion(question),
          },
          ...(QA_LINKS_AVAILABLE
            ? [{
                label: 'Copy link',
                icon: <LuLink size={18} />,
                onClick: () => copyQaLink(question.id, question.title),
              }]
            : []),
          { divider: true },
          {
            label: 'Delete question',
            detail: hasAnyAnswers
              ? "Can't delete once it has answers. You can still edit it."
              : null,
            icon: <LuTrash2 size={18} />,
            destructive: !hasAnyAnswers,
            disabled: hasAnyAnswers,
            onClick: () => setConfirm({ kind: 'delete-question' }),
          },
        ]
      : [
          ...(QA_LINKS_AVAILABLE
            ? [{
                label: 'Copy link',
                icon: <LuLink size={18} />,
                onClick: () => copyQaLink(question.id, question.title),
              }]
            : []),
          {
            label: 'Report question',
            icon: <LuFlag size={18} />,
            destructive: true,
            onClick: () => setReport({ type: 'question', id: question.id }),
          },
          ...(question.asker?.id && !question.asker_deleted
            ? [{
                label: `Block ${displayNameFor(question.asker) || 'player'}`,
                icon: <LuBan size={18} />,
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

  // Share card for a best answer. Lazy: html-to-image only loads on tap.
  const shareBestAnswer = async (answer) => {
    if (!question || !answer) return
    try {
      const { shareQaBestAnswer } = await import('./QaShareCard')
      const result = await shareQaBestAnswer(question, answer)
      if (result?.method === 'download') showToast('Card saved', 'success')
    } catch (err) {
      console.error('[qa] share best answer failed:', err)
      showToast("Couldn't share that.", 'error')
    }
  }

  const answerItems = menuAnswer
    ? [
        ...(viewerIsAsker && answerIsBest
          ? [{
              label: 'Unmark best answer',
              detail: 'The question goes back to Unanswered',
              icon: <LuAward size={18} />,
              onClick: () => onUnmark(),
            }]
          : []),
        ...(answerIsOwn
          ? [{
              label: 'Edit',
              icon: <LuPencil size={18} />,
              onClick: () => openQaEditAnswer({
                questionId: question.id,
                questionTitle: question.title,
                igdbGameId: question.igdb_game_id,
                answer: menuAnswer,
              }),
            }]
          : []),
        ...(answerIsBest
          ? [{
              label: 'Share',
              icon: <LuShare2 size={18} />,
              onClick: () => shareBestAnswer(menuAnswer),
            }]
          : []),
        ...(QA_LINKS_AVAILABLE
          ? [{
              label: 'Copy link',
              icon: <LuLink size={18} />,
              onClick: () => copyQaLink(question.id, question.title),
            }]
          : []),
        ...(answerIsOwn
          ? [
              { divider: true },
              {
                label: 'Delete',
                icon: <LuTrash2 size={18} />,
                destructive: true,
                onClick: () => setConfirm({ kind: 'delete-answer', answer: menuAnswer }),
              },
            ]
          : [
              { divider: true },
              {
                label: 'Report answer',
                icon: <LuFlag size={18} />,
                destructive: true,
                onClick: () => setReport({ type: 'answer', id: menuAnswer.id }),
              },
              ...(menuAnswer.author?.id && !menuAnswer.author_deleted
                ? [{
                    label: `Block ${menuName || 'player'}`,
                    icon: <LuBan size={18} />,
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

  const showSeedEmpty = !loaded && seedCount === 0 && status === 'open'
  const noAnswers = loaded ? liveCount === 0 : showSeedEmpty
  const showAnswers = loaded || showSeedEmpty
  const showWaiting = loaded && pill?.kind === 'waiting'

  return (
    <div className="qa-screen qa-screen--push qa-screen--question" aria-busy={pending || undefined}>
      <QaPushBar
        onBack={() => navigate(-1)}
        onMore={() => { if (loaded) setMenu({ kind: 'question' }) }}
      />

      <div className="qa-q-scroll">
        {question || pending ? (
          <div className="qa-push-body">
            {question ? (
              <SwapIn armed={armed}>
                <ContextRow question={question} pill={pill} />
              </SwapIn>
            ) : (
              <QaContextPlaceholder />
            )}

            <article className="qa-qcard">
              {loaded ? (
                <SwapIn armed={armed}>
                  <QaAskerRow question={question} viewerIsAsker={viewerIsAsker} />
                </SwapIn>
              ) : (
                <QaPersonPlaceholder large />
              )}

              {question?.title ? (
                <SwapIn armed={armed} className="qa-qcard__head">
                  <h1 className="text-heading qa-qcard__title">{question.title}</h1>
                  <QuestionTags question={question} />
                </SwapIn>
              ) : (
                <QaHeadPlaceholder />
              )}

              {loaded ? (
                <SwapIn armed={armed} className="qa-qcard__tail">
                  <QuestionLocation location={question.location} />
                  {question.body ? (
                    question.is_spoiler && !viewerIsAsker ? (
                      <QaSpoilerBlock>
                        <p className="qa-prose text-body">{question.body}</p>
                      </QaSpoilerBlock>
                    ) : (
                      <p className="qa-prose text-body">{question.body}</p>
                    )
                  ) : null}

                  <div className="qa-qfoot">
                    {viewerIsAsker ? (
                      <p className="qa-qfoot__meta">
                        {stuckCount > 0 ? (
                          <>
                            <strong>{playersCount(stuckCount)}</strong>
                            {' stuck with you'}
                          </>
                        ) : (
                          'Only you so far'
                        )}
                      </p>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`qa-act-btn${viewerStuck ? ' qa-act-btn--on' : ''}`}
                          aria-pressed={viewerStuck}
                          onClick={onStuck}
                        >
                          <Users size={15} aria-hidden="true" />
                          Stuck here too
                        </button>
                        {stuckCount > 0 ? (
                          <p className="qa-qfoot__meta">
                            <strong>{playersCount(stuckCount)}</strong>
                            {' stuck'}
                          </p>
                        ) : null}
                      </>
                    )}
                    <button
                      type="button"
                      className="qa-qfoot__share"
                      aria-label="Share question"
                      onClick={() => shareQaQuestion(question)}
                    >
                      <Share size={18} aria-hidden="true" />
                    </button>
                  </div>
                </SwapIn>
              ) : (
                <QaQuestionTailPlaceholder />
              )}
            </article>

            <div className="qa-adiv">
              <span className="qa-adiv__label">
                Answers
                {answerCount > 0 ? (
                  <>
                    {' · '}
                    <strong>{answerCount}</strong>
                  </>
                ) : null}
              </span>
              <span className="qa-adiv__line" aria-hidden="true" />
            </div>

            {showAnswers ? (
              <SwapIn armed={armed} className="qa-answers">
                {noAnswers && question ? <NoAnswersCard question={question} /> : null}

                {showWaiting ? (
                  <div className="qa-wait" role="note">
                    <Award size={18} aria-hidden="true" />
                    <span>Got your answer? Mark it as best so the next player finds it fast.</span>
                  </div>
                ) : null}

                {loaded && bestAnswer ? (
                  <MovingAnswer id={bestAnswer.id} reduced={reduced}>
                    <QaBestAnswerCard
                      answer={bestAnswer}
                      headline={bestHeadline}
                      {...answerActions}
                    />
                  </MovingAnswer>
                ) : null}

                {loaded && flatOthers.length > 0 ? (
                  <div className="qa-agroup">
                    {flatOthers.map((answer) => (
                      <MovingAnswer key={answer.id} id={answer.id} reduced={reduced}>
                        <QaAnswerRow answer={answer} {...answerActions} />
                      </MovingAnswer>
                    ))}
                  </div>
                ) : null}

                {loaded && !showAllAnswers && hiddenOthers > 0 ? (
                  <button
                    type="button"
                    className="qa-show-more text-caption"
                    onClick={() => setShowAllAnswers(true)}
                  >
                    Show {hiddenOthers} more answer{hiddenOthers === 1 ? '' : 's'}
                  </button>
                ) : null}
              </SwapIn>
            ) : (
              <QaAnswersPlaceholder />
            )}
          </div>
        ) : null}
      </div>

      <div className="kb-composer-bar kb-composer-bar--seamless composer-bar qa-composer-dock">
        <div className="composer__row">
          <Avatar user={profile} size="sm" className="qa-composer-dock__av" />
          <button
            type="button"
            className="composer__shell qa-dock-shell"
            onClick={() => openAnswer(null)}
          >
            <span className="qa-dock-shell__text">{composerText}</span>
            <span className="composer__send" aria-hidden="true">
              <LuArrowUp size={16} />
            </span>
          </button>
        </div>
      </div>

      <ActionSheet
        isOpen={menu?.kind === 'question'}
        onClose={() => setMenu(null)}
        title={viewerIsAsker ? 'Your question' : `${displayNameFor(question?.asker) || 'Player'}'s question`}
        subtitle={question?.title}
        items={questionItems}
      />
      <ActionSheet
        isOpen={!!menuAnswer}
        onClose={() => setMenu(null)}
        title={answerIsOwn ? 'Your answer' : menuName ? `${menuName}'s answer` : 'Answer'}
        subtitle={viewerIsAsker && answerIsBest ? 'Marked as your best answer' : null}
        items={answerItems}
      />
      <ActionSheet
        isOpen={confirm?.kind === 'delete-question'}
        onClose={() => setConfirm(null)}
        title="Delete this question?"
        items={[{
          icon: <LuTrash2 size={18} />,
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
          icon: <LuTrash2 size={18} />,
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
          icon: <LuBan size={18} />,
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
