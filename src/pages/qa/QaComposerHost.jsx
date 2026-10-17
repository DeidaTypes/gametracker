import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { showToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { askQuestion, postAnswer, qaQuestion, qaQuestionKey } from '../../services/qaService'
import { markSWRStale, mutateSWR } from '../../services/swrCache'
import { getSettings } from '../../services/userSettingsService'
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

function seedQuestion(id, draft, user, profile) {
  const now = new Date().toISOString()
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
      created_at: now,
      edited_at: null,
      asker_deleted: false,
      asker: authorFrom(user, profile),
      asker_credibility: null,
    },
  }))
  markSWRStale(qaQuestionKey(id))
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
  const seenQuestion = useRef(null)
  const noticeOk = useRef(false)
  const posting = useRef(false)

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
    if (!session || !user?.id) return undefined
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
    posting.current = false
  }, [openKey])

  const reportError = async (code, mode, questionId) => {
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
    seedQuestion(id, draft, user, profile)
    closeQaComposer()
    showToast('Question posted', 'success')
    navigate(`/qa/q/${id}`)
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
    appendAnswer(current.questionId, {
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
      credibility: null,
      reply_to_user_id: replyOn ? current.replyToUserId : null,
      reply_to_username: replyOn ? current.replyToUsername : null,
      helpful_count: 0,
      viewer_helpful: false,
    })
    closeQaComposer()
    showToast('Answer posted', 'success')
  }

  const submit = async () => {
    if (posting.current || !online) return
    const current = getQaComposerSession()
    if (!current || current.limit) return
    if (await mustWarn()) {
      setNoticeOpen(true)
      return
    }
    posting.current = true
    setBusy(true)
    try {
      if (current.mode === 'ask') await sendAsk()
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
  const asking = session?.mode === 'ask'
  const canSubmit = asking
    ? draft?.step === 'compose' &&
      online &&
      !session.limit &&
      !!draft.game &&
      !!draft.topic &&
      draft.title.trim().length >= QA_TITLE_MIN &&
      draft.title.trim().length <= QA_TITLE_MAX
    : !!session &&
      online &&
      !session.limit &&
      draft.body.trim().length >= 1

  return (
    <>
      {session ? (
        <QaComposerSheet
          open
          covered={!!session.hiddenFor}
          title={asking ? 'Ask a question' : `Answering ${session.questionTitle}`}
          submitLabel={asking && draft.step === 'pick' ? 'Next' : 'Post'}
          canSubmit={canSubmit}
          busy={busy}
          dirty={asking ? askIsDirty(draft) : answerIsDirty(session)}
          discardTitle={asking ? 'Discard question?' : 'Discard answer?'}
          onSubmit={submit}
          onClose={closeQaComposer}
        >
          {asking ? (
            <QaAskForm
              draft={draft}
              online={online}
              limit={session.limit}
              onOpenMatch={openMatch}
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
    </>
  )
}
