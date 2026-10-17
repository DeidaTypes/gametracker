import { WifiOff, X } from 'lucide-react'
import IOSSwitch from '../../components/IOSSwitch'
import { QA_ANSWER_MAX, patchQaDraft } from './qaComposer'
import { QaCounter, QaGrowField } from './QaComposerSheet'

export default function QaAnswerForm({ session, online, limit }) {
  const draft = session.draft
  const username = session.replyToUsername

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
      {!online ? (
        <div className="qa-banner qa-ps-banner" role="status">
          <WifiOff size={18} aria-hidden="true" />
          <span>You&apos;re offline</span>
        </div>
      ) : null}

      {limit ? (
        <div className="qa-banner qa-ps-banner" role="status">
          <span>{limit.message}</span>
        </div>
      ) : null}

      {draft.replyOn && username ? (
        <span className="qa-reply-chip text-caption">
          Replying to @{username}
          <button type="button" className="qa-reply-chip__x" aria-label="Remove reply" onClick={removeReply}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ) : null}

      <label className="qa-ps-field">
        <span className="qa-ps-label-row">
          <span className="qa-ps-label text-caption">Your answer</span>
          <QaCounter value={draft.body} max={QA_ANSWER_MAX} />
        </span>
        <QaGrowField
          className="qa-ps-input--area"
          value={draft.body}
          maxLength={QA_ANSWER_MAX}
          autoFocus
          aria-label="Your answer"
          onChange={(value) => patchQaDraft({ body: value })}
        />
      </label>

      <div className="qa-ps-switch">
        <span className="text-body">Spoiler</span>
        <IOSSwitch
          checked={draft.isSpoiler}
          label="Spoiler"
          onChange={(next) => patchQaDraft({ isSpoiler: next })}
        />
      </div>
    </>
  )
}
