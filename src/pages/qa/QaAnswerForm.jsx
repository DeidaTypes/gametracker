import { useMemo } from 'react'
import { X } from 'lucide-react'
import IOSSwitch from '../../components/IOSSwitch'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaQuestionKey } from '../../services/qaService'
import { peekSWR } from '../../services/swrCache'
import { hapticImpact } from '../../utils/haptics'
import { QA_ANSWER_MAX, patchQaDraft } from './qaComposer'
import { QaComposerNotices, QaCounter, QaTextarea } from './QaComposerSheet'
import { topicLabel } from './qaFormat'

export default function QaAnswerForm({ session, online, limit }) {
  const draft = session.draft
  const username = session.replyToUsername

  const question = useMemo(
    () => peekSWR(qaQuestionKey(session.questionId))?.question || null,
    [session.questionId],
  )
  const questionTitle = session.questionTitle || question?.title || ''
  const meta = [question?.game_title, topicLabel(question?.topic)].filter(Boolean).join(' · ')
  const coverId = question?.game_cover_image_id
  const coverSrc = coverId ? coverUrlFromImageId(String(coverId), 'cover_small') : null

  const removeReply = () => {
    let body = draft.body
    if (username) {
      const prefix = `@${username} `
      if (body.startsWith(prefix)) body = body.slice(prefix.length)
    }
    patchQaDraft({ body, replyOn: false })
  }

  return (
    <>
      <QaComposerNotices online={online} limit={limit} />

      {questionTitle ? (
        <div className="qa-cmp-game-header">
          {question ? (
            coverSrc ? (
              <img src={coverSrc} alt="" className="qa-cmp-game-cover" />
            ) : (
              <div className="qa-cmp-game-cover qa-cmp-game-cover--placeholder" aria-hidden="true" />
            )
          ) : null}
          <div className="qa-cmp-game-info">
            <p className="qa-cmp-question-title">{questionTitle}</p>
            {meta ? <p className="qa-cmp-game-meta">{meta}</p> : null}
          </div>
        </div>
      ) : null}

      {draft.replyOn && username ? (
        <div className="qa-cmp-chip-row">
          <span className="qa-cmp-chip qa-cmp-chip--reply">
            Replying to @{username}
            <button type="button" className="qa-cmp-chip-x" aria-label="Remove reply" onClick={removeReply}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      <div className="qa-cmp-textarea-wrap">
        <QaTextarea
          className="qa-cmp-textarea qa-cmp-textarea--answer"
          data-qa-autofocus=""
          value={draft.body}
          maxLength={QA_ANSWER_MAX}
          placeholder="Share what worked for you…"
          aria-label="Your answer"
          onChange={(value) => patchQaDraft({ body: value })}
        />
        <QaCounter value={draft.body} max={QA_ANSWER_MAX} />
      </div>

      <div className="qa-cmp-group" role="group" aria-label="Answer options">
        <div className="qa-cmp-group-row">
          <span className="qa-cmp-group-label">Contains spoilers</span>
          <IOSSwitch
            checked={draft.isSpoiler}
            label="Contains spoilers"
            onChange={(next) => {
              hapticImpact('Light')
              patchQaDraft({ isSpoiler: next })
            }}
          />
        </div>
      </div>
    </>
  )
}
