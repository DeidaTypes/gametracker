/**
 * Sized stand-ins for the Q&A rows. Covers are 48×64, the same box the
 * list rows use. Nothing here is a question, a game, or a count.
 */

export function QaMostAsked() {
  return (
    <div className="qa-most">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="qa-most__cover skeleton" />
      ))}
    </div>
  )
}

function Row({ cover }) {
  return (
    <div className={`qa-row${cover ? '' : ' qa-row--plain'}`}>
      {cover ? <span className="qa-row__cover skeleton" /> : null}
      <span className="qa-row__col">
        <span className="skeleton qa-row__line qa-row__line--title" />
        <span className="skeleton qa-row__line qa-row__line--title qa-row__line--mid" />
        <span className="skeleton qa-row__line qa-row__line--meta" />
        <span className="skeleton qa-row__line qa-row__line--preview" />
      </span>
    </div>
  )
}

export function QaCoverRows({ count = 3 }) {
  return (
    <div className="qa-group">
      {Array.from({ length: count }, (_, i) => (
        <Row key={i} cover />
      ))}
    </div>
  )
}

export function QaPlainRows({ count = 4, flat = false }) {
  const rows = Array.from({ length: count }, (_, i) => (
    <Row key={i} cover={false} />
  ))
  if (flat) return rows
  return <div className="qa-group">{rows}</div>
}

export function QaQuestionBlock() {
  return (
    <div className="qa-qblock">
      <span className="skeleton qa-row__line qa-row__line--title" />
      <span className="skeleton qa-row__line qa-row__line--title qa-row__line--mid" />
      <span className="skeleton qa-row__line qa-row__line--body" />
      <span className="skeleton qa-row__line qa-row__line--body qa-row__line--mid" />
      <span className="skeleton qa-row__line qa-row__line--meta" />
    </div>
  )
}
