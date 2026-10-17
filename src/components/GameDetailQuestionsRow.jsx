import { ChevronRight, MessageCircleQuestion } from 'lucide-react'

function buildSubline(header) {
  if (!header || typeof header !== 'object') return null
  const total = Number(header.question_count) || 0
  if (total === 0) {
    return { empty: true, answered: 0, open: 0 }
  }
  return {
    empty: false,
    answered: Number(header.answered_count) || 0,
    open: Number(header.unanswered_count) || 0,
  }
}

function sublineAria(sub) {
  if (!sub) return 'Loading question counts'
  if (sub.empty) return 'Be the first to ask'
  const parts = []
  if (sub.answered > 0) {
    parts.push(`${sub.answered} answered`)
  }
  if (sub.open > 0) {
    parts.push(`${sub.open} need an answer`)
  }
  return parts.join(', ') || 'Questions'
}

/**
 * Game Detail entry point into /qa/game/:igdbId (checkpoint C2b).
 * Caller reserves layout height; subline fades in once `ready`.
 */
export default function GameDetailQuestionsRow({ header, ready, onOpen }) {
  const sub = ready ? buildSubline(header) : null
  const aria = sublineAria(sub)

  return (
    <button
      type="button"
      className="gd-questions-row"
      onClick={onOpen}
      aria-label={`Questions, ${aria}`}
    >
      <span className="gd-questions-row__icon" aria-hidden="true">
        <MessageCircleQuestion size={20} strokeWidth={1.9} />
      </span>
      <span className="gd-questions-row__text">
        <span className="gd-questions-row__title">Questions</span>
        {sub ? (
          <span className="gd-questions-row__subline text-caption gd-questions-row__subline--visible">
            {sub.empty ? (
              'Be the first to ask'
            ) : (
              <>
                {sub.answered > 0 ? (
                  <>
                    {sub.answered} answered
                    {sub.open > 0 ? ' · ' : null}
                  </>
                ) : null}
                {sub.open > 0 ? (
                  <span className="gd-questions-row__open">
                    {sub.open} need an answer
                  </span>
                ) : null}
              </>
            )}
          </span>
        ) : (
          <span
            className="gd-questions-row__subline text-caption"
            aria-hidden="true"
          >
            {'\u00a0'}
          </span>
        )}
      </span>
      <ChevronRight
        className="gd-questions-row__chevron"
        size={16}
        strokeWidth={2.2}
        aria-hidden="true"
      />
    </button>
  )
}
