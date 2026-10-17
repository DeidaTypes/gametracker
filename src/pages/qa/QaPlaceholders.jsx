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
