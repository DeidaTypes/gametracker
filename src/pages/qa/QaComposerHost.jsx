import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { showToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { BLOCK_CHANGED_EVENT } from '../../services/blockService'
import { askQuestion, editAnswer, editQuestion, postAnswer, qaQuestion, qaQuestionKey } from '../../services/qaService'
import { markSWRStale, markSWRStaleByPrefix, mutateSWR, peekSWR } from '../../services/swrCache'
import { applyAnswerEdit, applyQuestionEdit, dropBlockedUserFromQa, markJustAsked, seedAskedQuestion } from './qaCache'
import { getKeyboardInset, hideKeyboard, isKeyboardOpen } from '../../services/keyboardInset'
import { getSettings } from '../../services/userSettingsService'
import { hapticSuccess } from '../../utils/haptics'
import { CONTENT_BLOCKED_MESSAGE, accountSuspendedMessage } from '../../services/moderationService'
import { discardConfirm, useConfirmSheet } from '../../components/ConfirmSheet'
import QaAnswerForm from './QaAnswerForm'
import QaAskForm from './QaAskForm'
import QaComposerSheet from './QaComposerSheet'
import QaPublicNotice from './QaPublicNotice'
import {
  QA_TITLE_MAX,
  QA_TITLE_MIN,
  answerIsDirty,
  askIsDirty,
  closeQaComposer,
  draftUnchanged,
  getQaComposerSession,
  hasAnyQaPost,
  hideQaComposerFor,
  limitBanner,
  limitRule,
  qaPublicNoticeSeen,
  qaUsageToday,
  rememberQaPublicNotice,
  revealQaComposer,
  setQaComposerLimit,
  subscribeQaComposer,
} from './qaComposer'
import { useOnline } from './useOnline'

const TOASTS = {
  blocked: "You can't post this.",
  flag_off: "Q&A isn't available right now.",
  offline: "You're offline.",
  removed: 'This question was removed.',
  unknown: "Couldn't post. Try again.",
}

// "Question posted" / "Answer posted" land on the question screen, whose push
// bar (qa-pushbar) fills the same band as the default toast: 16px below the
// safe area, with 44px buttons. The toast starts at that same 16px, so
// 44px (the bar) + 8px (a gap) puts it just under the bar's bottom edge.
const TOAST_BELOW_PUSHBAR = 'calc(var(--space-48) + var(--space-4))'
const POSTED_TOAST = { offsetTop: TOAST_BELOW_PUSHBAR }

// Safety net only. keyboardDidHide normally lands well inside this.
const KEYBOARD_WAIT_CAP_MS = 700

function keyboardIsQuiet() {
  return !isKeyboardOpen() &&
    getKeyboardInset() === 0 &&
    !document.body.classList.contains('keyboard-animating')
}

/**
 * Hide the keyboard and resolve once it has finished going down, so the push
 * that follows never runs while --keyboard-inset / body.keyboard-open are
 * still changing. When the keyboard is not up this does not wait.
 */
async function quietKeyboard() {
  if (!isKeyboardOpen() && getKeyboardInset() === 0) {
    void hideKeyboard()
    return
  }
  await hideKeyboard()
  await new Promise((resolve) => {
    const startedAt = Date.now()
    const check = () => {
      if (keyboardIsQuiet() || Date.now() - startedAt >= KEYBOARD_WAIT_CAP_MS) {
        resolve()
        return
      }
      setTimeout(check, 16)
    }
    check()
  })
}

function useQaSession() {
  const [session, setSession] = useState(getQaComposerSession)
  useEffect(() => subscribeQaComposer(setSession), [])
  return session
}

function authorFrom(user, profile) {
  if (!user) return null
  return {
    id: user.id,
    username: profile?.username || null,
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
  }
}

function seedQuestion(row, draft, user, profile) {
  const id = row.id
  const game = draft.game
  mutateSWR(qaQuestionKey(id), () => ({
    state: 'ok',
    status: 'open',
    pick_answer_id: null,
    viewer_is_asker: true,
    stuck: { count: 0, viewer_stuck: false },
    answers: [],
    question: {
      id,
      title: draft.title.trim(),
      body: draft.body.trim(),
      location: draft.location.trim() || null,
      topic: draft.topic,
      platform: draft.platform.trim() || null,
      igdb_game_id: game.igdbId,
      game_title: game.title,
      game_cover_image_id: game.coverImageId,
      is_spoiler: draft.topic === 'story' ? true : !!draft.isSpoiler,
      best_answer_id: null,
      best_picked_at: null,
      is_own: true,
      // The insert's own created_at, so the cached row matches the server's.
      created_at: row.created_at,
      edited_at: null,
      asker_deleted: false,
      asker: authorFrom(user, profile),
      asker_credibility: null,
    },
  }))
  markSWRStale(qaQuestionKey(id))
}

/**
 * The viewer's credibility on this question, only when the cached payload
 * already carries it (they asked it, or they already answered it). Otherwise
 * null: the chip is a flex sibling that is never taller than the person row,
 * so it arriving with the real value does not move anything.
 */
function viewerCredibility(questionId) {
  const payload = peekSWR(qaQuestionKey(questionId))
  if (!payload || payload.state !== 'ok') return null
  if (payload.viewer_is_asker && payload.question?.asker_credibility) {
    return payload.question.asker_credibility
  }
  const own = (payload.answers || []).find((row) => row?.is_own && row.credibility)
  return own?.credibility || null
}

function appendAnswer(questionId, answer) {
  const key = qaQuestionKey(questionId)
  mutateSWR(key, (current) => {
    if (!current || current.state !== 'ok') return current
    const answers = Array.isArray(current.answers) ? current.answers : []
    const live = answers.filter((row) => !row.removed)
    const removed = answers.filter((row) => row.removed)
    return { ...current, answers: [...live, answer, ...removed] }
  })
  markSWRStale(key)
}

export default function QaComposerHost() {
  const session = useQaSession()
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const { user, profile } = useAuth()
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [closedKey, setClosedKey] = useState(null)
  const [blockedText, setBlockedText] = useState(false)
  const [confirm, confirmSheet] = useConfirmSheet()
  const seenQuestion = useRef(null)
  const noticeOk = useRef(false)
  const posting = useRef(false)
  const pendingRef = useRef(null)

  const closingRef = useRef(null)

  const closeWith = useCallback((action) => {
    const current = getQaComposerSession()
    if (!current || closingRef.current === current.openedAt) return
    closingRef.current = current.openedAt
    pendingRef.current = action ?? null
    setClosedKey(current.openedAt)
  }, [])

  const handleExited = useCallback(() => {
    const action = pendingRef.current
    pendingRef.current = null
    if (action) action()
  }, [])

  useEffect(() => {
    if (!session?.hiddenFor) return
    const target = `/qa/q/${session.hiddenFor}`
    if (location.pathname === target) {
      seenQuestion.current = session.hiddenFor
      return
    }
    if (seenQuestion.current === session.hiddenFor) {
      seenQuestion.current = null
      revealQaComposer()
    }
  }, [location.pathname, session?.hiddenFor])

  useEffect(() => {
    const onBlock = (event) => {
      const id = event.detail?.targetUserId
      if (!id) return
      if (event.detail.blocked) dropBlockedUserFromQa(id)
      else markSWRStaleByPrefix('qa:')
    }
    window.addEventListener(BLOCK_CHANGED_EVENT, onBlock)
    return () => window.removeEventListener(BLOCK_CHANGED_EVENT, onBlock)
  }, [])

  useEffect(() => {
    if (!session || !user?.id) return undefined
    if (session.mode === 'edit-question' || session.mode === 'edit-answer') return undefined
    let cancelled = false
    const kind = session.mode === 'answer' ? 'answer' : 'question'
    const rule = limitRule(profile?.created_at, kind)
    qaUsageToday(user.id, kind).then((count) => {
      if (cancelled || !getQaComposerSession()) return
      if (count != null && count >= rule.cap) {
        setQaComposerLimit({ ...rule, message: limitBanner(rule) })
      }
    })
    return () => {
      cancelled = true
    }
  }, [session?.openedAt, session?.mode, user?.id, profile?.created_at])

  const openKey = session?.openedAt || 0

  useEffect(() => {
    noticeOk.current = false
    setNoticeOpen(false)
    setBusy(false)
    setBlockedText(false)
    posting.current = false
  }, [openKey])

  const reportError = async (code, mode, questionId) => {
    if (code === 'content_blocked') {
      setBlockedText(true)
      return
    }
    if (code === 'account_suspended') {
      setQaComposerLimit({ message: accountSuspendedMessage() })
      return
    }
    if (code === 'limit_reached') {
      const rule = limitRule(profile?.created_at, mode === 'answer' ? 'answer' : 'question')
      setQaComposerLimit({ ...rule, message: limitBanner(rule) })
      return
    }
    if (code === 'blocked' && mode === 'answer' && questionId) {
      try {
        const payload = await qaQuestion(questionId)
        if (payload?.state === 'removed') {
          showToast(TOASTS.removed, 'error')
          return
        }
      } catch {
        // The blocked toast still tells them the post did not go through.
      }
      showToast(TOASTS.blocked, 'error')
      return
    }
    showToast(TOASTS[code] || TOASTS.unknown, 'error')
  }

  const mustWarn = async () => {
    if (noticeOk.current) return false
    if (getSettings().activityPrivacy !== 'me') return false
    if (!user?.id) return false
    if (await qaPublicNoticeSeen(user.id)) {
      noticeOk.current = true
      return false
    }
    if (await hasAnyQaPost(user.id)) return false
    return true
  }

  const sendAsk = async () => {
    const current = getQaComposerSession()
    const draft = current?.draft
    if (!current || current.mode !== 'ask' || !draft?.game) return
    const result = await askQuestion({
      game: {
        id: draft.game.igdbId,
        igdb_game_id: draft.game.igdbId,
        title: draft.game.title,
        game_title: draft.game.title,
        coverImageId: draft.game.coverImageId,
        game_cover_image_id: draft.game.coverImageId,
      },
      topic: draft.topic,
      title: draft.title.trim(),
      body: draft.body,
      platform: draft.platform,
      location: draft.location,
      isSpoiler: draft.isSpoiler,
    })
    if (result?.error) {
      await reportError(result.error.code, 'ask')
      return
    }
    const id = result?.data?.id
    if (!id) {
      showToast(TOASTS.unknown, 'error')
      return
    }
    // Order matters: keyboard down, then the popup closes, then (in onExited)
    // seed, toast and push. Nothing pushes while the keyboard is animating.
    await quietKeyboard()
    closeWith(() => {
      seedAskedQuestion({ userId: user?.id, row: result.data, askerUsername: profile?.username })
      seedQuestion(result.data, draft, user, profile)
      markJustAsked()
      closeQaComposer()
      hapticSuccess()
      showToast('Question posted', 'success', undefined, null, null, POSTED_TOAST)
      navigate(`/qa/q/${id}`)
    })
  }

  const sendAnswer = async () => {
    const current = getQaComposerSession()
    if (!current || current.mode !== 'answer') return
    const replyOn = current.draft.replyOn && current.replyToUserId
    const result = await postAnswer({
      questionId: current.questionId,
      body: current.draft.body,
      isSpoiler: current.draft.isSpoiler,
      replyToUserId: replyOn ? current.replyToUserId : null,
      igdbGameId: current.igdbGameId,
    })
    if (result?.error) {
      await reportError(result.error.code, 'answer', current.questionId)
      return
    }
    const id = result?.data?.id
    if (!id) {
      showToast(TOASTS.unknown, 'error')
      return
    }
    const now = new Date().toISOString()
    const answer = {
      id,
      removed: false,
      body: current.draft.body.trim(),
      is_spoiler: !!current.draft.isSpoiler,
      created_at: now,
      edited_at: null,
      is_best: false,
      is_community_pick: false,
      is_own: true,
      author_deleted: false,
      author: authorFrom(user, profile),
      credibility: viewerCredibility(current.questionId),
      reply_to_user_id: replyOn ? current.replyToUserId : null,
      reply_to_username: replyOn ? current.replyToUsername : null,
      helpful_count: 0,
      viewer_helpful: false,
    }
    await quietKeyboard()
    closeWith(() => {
      appendAnswer(current.questionId, answer)
      closeQaComposer()
      hapticSuccess()
      showToast('Answer posted', 'success', undefined, null, null, POSTED_TOAST)
    })
  }

  const sendEditQuestion = async () => {
    const current = getQaComposerSession()
    const draft = current?.draft
    if (!current || current.mode !== 'edit-question' || !draft) return
    const fields = {
      title: draft.title.trim(),
      body: draft.body,
      location: draft.location,
      topic: draft.topic,
      platform: draft.platform,
      isSpoiler: draft.topic === 'story' ? true : !!draft.isSpoiler,
    }
    const result = await editQuestion(current.questionId, fields, { igdbGameId: current.igdbGameId })
    if (result?.error) {
      await reportError(result.error.code, 'ask')
      return
    }
    const edited = !draftUnchanged(draft, current.baseline, ['title', 'body', 'location', 'topic', 'platform'])
    closeWith(() => {
      applyQuestionEdit(current.questionId, {
        title: fields.title,
        body: fields.body.trim(),
        location: fields.location.trim() || null,
        topic: fields.topic,
        platform: fields.platform.trim() || null,
        is_spoiler: fields.isSpoiler,
      }, { edited })
      closeQaComposer()
    })
  }

  const sendEditAnswer = async () => {
    const current = getQaComposerSession()
    if (!current || current.mode !== 'edit-answer') return
    const body = current.draft.body.trim()
    const isSpoiler = !!current.draft.isSpoiler
    const result = await editAnswer(
      current.answerId,
      { body, isSpoiler },
      { questionId: current.questionId, igdbGameId: current.igdbGameId },
    )
    if (result?.error) {
      await reportError(result.error.code, 'answer', current.questionId)
      return
    }
    const edited = !draftUnchanged(current.draft, current.baseline, ['body'])
    closeWith(() => {
      applyAnswerEdit(
        current.questionId,
        current.answerId,
        { body, is_spoiler: isSpoiler },
        { edited, isBest: current.wasBest },
      )
      closeQaComposer()
    })
  }

  const submit = async () => {
    if (posting.current || !online) return
    const current = getQaComposerSession()
    if (!current || current.limit || closingRef.current === current.openedAt) return
    const editing = current.mode === 'edit-question' || current.mode === 'edit-answer'
    if (!editing && await mustWarn()) {
      setNoticeOpen(true)
      return
    }
    posting.current = true
    setBusy(true)
    setBlockedText(false)
    try {
      if (current.mode === 'ask') await sendAsk()
      else if (current.mode === 'edit-question') await sendEditQuestion()
      else if (current.mode === 'edit-answer') await sendEditAnswer()
      else await sendAnswer()
    } finally {
      posting.current = false
      setBusy(false)
    }
  }

  const acceptNotice = async () => {
    setNoticeOpen(false)
    noticeOk.current = true
    if (user?.id) await rememberQaPublicNotice(user.id)
    submit()
  }

  const openMatch = (item) => {
    if (!item?.id) return
    hideQaComposerFor(item.id)
    navigate(`/qa/q/${item.id}`)
  }

  const draft = session?.draft
  const editingQuestion = session?.mode === 'edit-question'
  const editingAnswer = session?.mode === 'edit-answer'
  const asking = session?.mode === 'ask' || editingQuestion
  const questionReady = draft?.step === 'compose' &&
    online &&
    !session?.limit &&
    !!draft?.game &&
    !!draft?.topic &&
    draft.title.trim().length >= QA_TITLE_MIN &&
    draft.title.trim().length <= QA_TITLE_MAX
  const canSubmit = asking
    ? questionReady
    : !!session &&
      online &&
      !session.limit &&
      draft.body.trim().length >= 1
  const dirty = editingQuestion
    ? !draftUnchanged(draft, session.baseline, ['title', 'body', 'location', 'topic', 'platform', 'isSpoiler'])
    : editingAnswer
      ? !draftUnchanged(draft, session.baseline, ['body', 'isSpoiler'])
      : asking
        ? askIsDirty(draft)
        : answerIsDirty(session)

  let sheetTitle = 'Answer'
  if (editingQuestion) sheetTitle = 'Edit question'
  else if (session?.mode === 'ask') sheetTitle = 'Ask a question'
  else if (editingAnswer) sheetTitle = 'Edit answer'

  let discardCopy = discardConfirm('answer')
  if (editingQuestion || editingAnswer) discardCopy = discardConfirm('', { editing: true })
  else if (asking) discardCopy = discardConfirm('question')

  const handleCancel = async () => {
    if (noticeOpen) return
    if (dirty && !(await confirm(discardCopy))) return
    closeWith(closeQaComposer)
  }

  const open = !!session && closedKey !== session.openedAt && !session.hiddenFor

  return (
    <>
      {session ? (
        <QaComposerSheet
          open={open}
          picking={asking && draft.step === 'pick'}
          fill={asking}
          title={sheetTitle}
          submitLabel={editingQuestion || editingAnswer ? 'Save' : 'Post'}
          canSubmit={canSubmit}
          busy={busy}
          onSubmit={submit}
          onCancel={handleCancel}
          onExited={handleExited}
        >
          {blockedText && !(asking && draft.step === 'pick') ? (
            <div className="qa-cmp-notice" role="alert">
              <span>{CONTENT_BLOCKED_MESSAGE}</span>
            </div>
          ) : null}
          {asking ? (
            <QaAskForm
              draft={draft}
              online={online}
              limit={session.limit}
              onOpenMatch={openMatch}
              onCancel={handleCancel}
              editing={editingQuestion}
            />
          ) : (
            <QaAnswerForm session={session} online={online} limit={session.limit} />
          )}
        </QaComposerSheet>
      ) : null}
      <QaPublicNotice
        open={noticeOpen}
        onAccept={acceptNotice}
        onCancel={() => setNoticeOpen(false)}
      />
      {confirmSheet}
    </>
  )
}
