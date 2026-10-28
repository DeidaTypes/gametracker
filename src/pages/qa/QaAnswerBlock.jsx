import { memo } from 'react'
import { Check, MoreHorizontal, ThumbsUp } from 'lucide-react'
import Avatar from '../../components/Avatar'
import { displayNameFor, qaTimeAgo } from './qaFormat'
import QaSpoilerBlock from './QaSpoilerBlock'

/** "Playing · 12h" / "Played · 41h"; just the status when the hours round to 0. */
function credibilityLabel(credibility) {
  if (!credibility?.status) return null
  const label = credibility.status === 'playing' ? 'Playing' : 'Played'
  const hours = Math.round(Number(credibility.hours))
  return Number.isFinite(hours) && hours > 0 ? `${label} · ${hours}h` : label
}

function PersonRow({ user, userId, deleted, timeLabel, credibility, you = false, large = false }) {
  return (
    <div className={`qa-person${large ? ' qa-person--q' : ''}`}>
      {deleted ? (
        <span className="qa-person__av qa-person__av--ghost" aria-hidden="true">
          <Avatar size="sm" name="?" seed={userId || 'deleted'} />
        </span>
      ) : (
        <Avatar user={user} seed={userId} size="sm" className="qa-person__av" />
      )}
      <span className="qa-person__col">
        <span className={`qa-person__name${deleted ? ' qa-person__name--dim' : ''}`}>
          {deleted ? 'Deleted user' : displayNameFor(user) || 'Player'}
          {you ? <span className="qa-person__you"> · you</span> : null}
        </span>
        <span className="qa-person__time">{timeLabel}</span>
      </span>
      {credibility ? <span className="qa-cred">{credibility}</span> : null}
    </div>
  )
}

function HelpfulReplyRow({
  count,
  pressed = false,
  own = false,
  onHelpful,
  onReply,
  onMore,
  canMark = false,
  onMarkBest,
}) {
  const n = Number(count) || 0
  return (
    <div className="qa-acts">
      {canMark ? (
        <button type="button" className="qa-act-btn qa-act-btn--acc" onClick={onMarkBest}>
          <Check size={15} strokeWidth={2.6} aria-hidden="true" />
          Mark as best
        </button>
      ) : null}
      <button
        type="button"
        className={`qa-act-btn${pressed ? ' qa-act-btn--on' : ''}`}
        aria-pressed={pressed}
        disabled={own}
        onClick={own ? undefined : onHelpful}
      >
        <ThumbsUp size={15} aria-hidden="true" />
        Helpful
        {n > 0 ? <span className="qa-act-btn__n">{n}</span> : null}
      </button>
      <button type="button" className="qa-act-btn qa-act-btn--text" onClick={onReply}>
        Reply
      </button>
      <span className="qa-acts__grow" />
      <button type="button" className="qa-act-btn qa-act-btn--text" aria-label="More" onClick={onMore}>
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

function answerTime(answer) {
  const label = qaTimeAgo(answer.created_at)
  return answer.edited_at && label ? `${label} · Edited` : label
}

// Memoized: opening a menu re-renders QaQuestion, and with stable callbacks
// (see answerActions there) an answer only renders when its own row changes.
export const QaAnswerRow = memo(function QaAnswerRow({ answer, onReply, onHelpful, onMore, canMark, onMarkBest }) {
  if (answer?.removed) {
    return <QaAnswerRemoved />
  }

  return (
    <article className="qa-ans">
      <PersonRow
        user={answer.author}
        userId={answer.author?.id}
        deleted={answer.author_deleted}
        timeLabel={answerTime(answer)}
        credibility={credibilityLabel(answer.credibility)}
      />
      <AnswerBody answer={answer} />
      <HelpfulReplyRow
        count={answer.helpful_count}
        pressed={answer.viewer_helpful}
        own={answer.is_own === true}
        onHelpful={onHelpful ? () => onHelpful(answer) : undefined}
        onReply={onReply ? () => onReply(answer) : undefined}
        onMore={onMore ? () => onMore(answer) : undefined}
        canMark={canMark}
        onMarkBest={onMarkBest ? () => onMarkBest(answer) : undefined}
      />
    </article>
  )
})

function AnswerBody({ answer }) {
  if (!answer.body) return null
  const own = answer.is_own === true
  if (answer.is_spoiler && !own) {
    return (
      <QaSpoilerBlock>
        <p className="qa-prose text-body">{answer.body}</p>
      </QaSpoilerBlock>
    )
  }
  return <p className="qa-prose text-body">{answer.body}</p>
}

export const QaBestAnswerCard = memo(function QaBestAnswerCard({ answer, headline, onReply, onHelpful, onMore, canMark, onMarkBest }) {
  if (!answer || answer.removed) return null

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
        timeLabel={answerTime(answer)}
        credibility={credibilityLabel(answer.credibility)}
      />
      <AnswerBody answer={answer} />
      <HelpfulReplyRow
        count={answer.helpful_count}
        pressed={answer.viewer_helpful}
        own={answer.is_own === true}
        onHelpful={onHelpful ? () => onHelpful(answer) : undefined}
        onReply={onReply ? () => onReply(answer) : undefined}
        onMore={onMore ? () => onMore(answer) : undefined}
        canMark={canMark}
        onMarkBest={onMarkBest ? () => onMarkBest(answer) : undefined}
      />
    </article>
  )
})

export function QaAskerRow({ question, viewerIsAsker }) {
  const timeParts = [`Asked ${qaTimeAgo(question.created_at)}`]
  if (question.edited_at) timeParts.push('· Edited')

  return (
    <PersonRow
      large
      user={question.asker}
      userId={question.asker?.id}
      deleted={question.asker_deleted}
      timeLabel={timeParts.join(' ')}
      credibility={!question.asker_deleted ? credibilityLabel(question.asker_credibility) : null}
      you={viewerIsAsker && !question.asker_deleted}
    />
  )
}
