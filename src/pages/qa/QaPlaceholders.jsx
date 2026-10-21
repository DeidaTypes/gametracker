/**
 * Sized stand-ins for the Q&A rows. Covers are 48×64, the same box the
 * list rows use. Nothing here is a question, a game, or a count.
 */

export function QaMostAsked({ fill = false }) {
  const bone = fill ? 'qa-fill' : 'skeleton'
  return (
    <div className="qa-most">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="qa-most__item">
          <span className={`qa-most__cover ${bone}`} />
          <span className={`qa-most__name-bone ${bone}`} />
        </span>
      ))}
    </div>
  )
}

function Row({ cover, fill }) {
  const bone = fill ? 'qa-fill' : 'skeleton'
  return (
    <div className={`qa-row${cover ? '' : ' qa-row--plain'}`}>
      {cover ? <span className={`qa-row__cover ${bone}`} /> : null}
      <span className="qa-row__col">
        <span className={`${bone} qa-row__line qa-row__line--title`} />
        <span className={`${bone} qa-row__line qa-row__line--title qa-row__line--mid`} />
        <span className={`${bone} qa-row__line qa-row__line--meta`} />
        <span className={`${bone} qa-row__line qa-row__line--preview`} />
      </span>
    </div>
  )
}

export function QaCoverRows({ count = 3, fill = false }) {
  return (
    <div className="qa-group">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          {i > 0 ? <div className="qa-hair" /> : null}
          <Row cover fill={fill} />
        </div>
      ))}
    </div>
  )
}

export function QaPlainRows({ count = 4, flat = false, fill = false }) {
  const rows = Array.from({ length: count }, (_, i) => (
    <Row key={i} cover={false} fill={fill} />
  ))
  if (flat) return rows
  return <div className="qa-group">{rows}</div>
}

/*
 * Question screen. Each stand-in uses the real element's box (same classes,
 * fixed line boxes), so swapping it for data moves nothing.
 */

function LineBox({ className, width }) {
  return (
    <span className={`qa-line ${className}`}>
      <span className="skeleton qa-line__bone" style={width ? { width } : undefined} />
    </span>
  )
}

/** Asker / answerer row: avatar, name, time, credibility chip. */
export function QaPersonPlaceholder({ large = false }) {
  return (
    <div className={`qa-person${large ? ' qa-person--q' : ''}`} aria-hidden="true">
      <span className="skeleton qa-person__av qa-person__av--bone" />
      <span className="qa-person__col">
        <LineBox className="qa-person__name" width="40%" />
        <LineBox className="qa-person__time" width="28%" />
      </span>
      <span className="skeleton qa-cred-bone" />
    </div>
  )
}

/** Body text lines at the body line height. */
export function QaBodyPlaceholder({ lines = 2 }) {
  return (
    <div className="qa-prose qa-prose--bones" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <LineBox key={i} className="qa-line--body" width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  )
}

/** Left side of the question footer. The footer row keeps its own height. */
export function QaFootPlaceholder() {
  return <span className="skeleton qa-qfoot__bone" aria-hidden="true" />
}

/** Rows inside the grouped answers card. */
export function QaAnswerRowsPlaceholder({ count = 2 }) {
  return (
    <div className="qa-agroup" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="qa-ans">
          <QaPersonPlaceholder />
          <QaBodyPlaceholder lines={2} />
          <div className="qa-acts">
            <span className="skeleton qa-act-bone" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Context row with nothing known yet (deep link, no list row to seed from). */
export function QaContextPlaceholder() {
  return (
    <div className="qa-ctx" aria-hidden="true">
      <span className="qa-ctx__game">
        <span className="skeleton qa-ctx__cover" />
        <LineBox className="qa-ctx__title" width="60%" />
      </span>
    </div>
  )
}

/** Title + tag row with nothing known yet. */
export function QaHeadPlaceholder() {
  return (
    <>
      <div className="qa-qcard__title qa-qcard__title--bones" aria-hidden="true">
        <LineBox className="qa-line--heading" width="100%" />
        <LineBox className="qa-line--heading" width="70%" />
      </div>
      <div className="qa-tags" aria-hidden="true">
        <span className="skeleton qa-tag-bone" />
      </div>
    </>
  )
}
