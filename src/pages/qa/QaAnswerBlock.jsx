import { Check, MoreHorizontal, ThumbsUp } from 'lucide-react'
import Avatar from '../../components/Avatar'
import {
  displayNameFor,
  formatCredibilityPill,
  qaTimeAgo,
} from './qaFormat'
import QaSpoilerBlock from './QaSpoilerBlock'

function PersonRow({ user, userId, deleted, timeLabel, credibility, youTag }) {
  return (
    <div className="qa-person">
      {deleted ? (
        <span className="qa-person__av qa-person__av--ghost" aria-hidden="true">
          <Avatar size="sm" name="?" seed={userId || 'deleted'} />
        </span>
      ) : (
        <Avatar user={user} seed={userId} size="sm" className="qa-person__av" />
      )}
      <span className="qa-person__col">
        <span className={`qa-person__name text-body${deleted ? ' qa-person__name--dim' : ''}`}>
          {deleted ? 'Deleted user' : displayNameFor(user) || 'Player'}
        </span>
        {timeLabel ? <span className="qa-person__time text-caption">{timeLabel}</span> : null}
      </span>
      {youTag ? <span className="qa-chip">You</span> : null}
      {credibility ? <span className="qa-chip">{credibility}</span> : null}
    </div>
  )
}

function HelpfulReplyRow({ count, pressed = false, onReply }) {
  return (
    <div className="qa-acts">
      <button type="button" className={`qa-act-btn${pressed ? ' qa-act-btn--on' : ''}`} aria-pressed={pressed}>
        <ThumbsUp size={15} aria-hidden="true" />
        Helpful
        {count != null ? <span className="qa-act-btn__n">{count}</span> : null}
      </button>
      <button type="button" className="qa-act-btn qa-act-btn--text" onClick={onReply}>
        Reply
      </button>
      <span className="qa-acts__grow" />
      <button type="button" className="qa-act-btn qa-act-btn--text" aria-label="More">
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

export function QaAnswerRemoved() {
  return (
    <p className="qa-gone text-caption">
      This answer was removed for breaking the rules.
    </p>
  )
}

export function QaAnswerRow({ answer, onReply }) {
  if (answer?.removed) {
    return <QaAnswerRemoved />
  }

  const credibility = formatCredibilityPill(answer.credibility)
  return (
    <article className="qa-ans">
      <PersonRow
        user={answer.author}
        userId={answer.author?.id}
        deleted={answer.author_deleted}
        timeLabel={qaTimeAgo(answer.created_at)}
        credibility={credibility}
      />
      <AnswerBody answer={answer} />
      <HelpfulReplyRow
        count={answer.helpful_count}
        pressed={answer.viewer_helpful}
        onReply={onReply ? () => onReply(answer) : undefined}
      />
    </article>
  )
}

function AnswerBody({ answer }) {
  if (!answer.body) return null
  if (answer.is_spoiler) {
    return (
      <QaSpoilerBlock>
        <p className="qa-prose text-body">{answer.body}</p>
      </QaSpoilerBlock>
    )
  }
  return <p className="qa-prose text-body">{answer.body}</p>
}

export function QaBestAnswerCard({ answer, headline, onReply }) {
  if (!answer || answer.removed) return null
  const credibility = formatCredibilityPill(answer.credibility)

  return (
    <article className="qa-best">
      <div className="qa-best__head text-caption">
        <span className="qa-best__icon" aria-hidden="true">
          <Check size={12} strokeWidth={3.2} />
        </span>
        <span className="qa-best__title">{headline}</span>
      </div>
      <PersonRow
        user={answer.author}
        userId={answer.author?.id}
        deleted={answer.author_deleted}
        timeLabel={qaTimeAgo(answer.created_at)}
        credibility={credibility}
      />
      <AnswerBody answer={answer} />
      <HelpfulReplyRow
        count={answer.helpful_count}
        pressed={answer.viewer_helpful}
        onReply={onReply ? () => onReply(answer) : undefined}
      />
    </article>
  )
}

export function QaAskerRow({ question, viewerIsAsker }) {
  const credibility = formatCredibilityPill(question.asker_credibility)
  const timeParts = [`Asked ${qaTimeAgo(question.created_at)}`]
  if (question.edited_at) timeParts.push('· Edited')

  return (
    <PersonRow
      user={question.asker}
      userId={question.asker?.id}
      deleted={question.asker_deleted}
      timeLabel={timeParts.join(' ')}
      credibility={!question.asker_deleted ? credibility : null}
      youTag={viewerIsAsker && !question.asker_deleted}
    />
  )
}
