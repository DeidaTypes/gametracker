import { ChevronLeft, MoreHorizontal, Plus } from 'lucide-react'

export default function QaPushBar({ onBack, ask, onAsk, onMore, moreLabel = 'More' }) {
  return (
    <div className="qa-pushbar">
      <button type="button" className="qa-icon-btn qa-icon-btn--solid" onClick={onBack} aria-label="Go back">
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <div className="qa-pushbar__end">
        {ask ? (
          <button type="button" className="qa-ask text-body" onClick={onAsk}>
            <Plus size={16} aria-hidden="true" />
            Ask
          </button>
        ) : null}
        {onMore ? (
          <button type="button" className="qa-icon-btn qa-icon-btn--solid" onClick={onMore} aria-label={moreLabel}>
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
