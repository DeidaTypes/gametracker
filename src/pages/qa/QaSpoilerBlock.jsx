import { useState } from 'react'
import { EyeOff } from 'lucide-react'
import { hapticImpact } from '../../utils/haptics'
import '../../components/SpoilerOverlay.css'

/** Q&A spoiler body — design C7 label with Lucide EyeOff. Per item, per visit. */
export default function QaSpoilerBlock({ children, className = '' }) {
  const [revealed, setRevealed] = useState(false)

  if (revealed) {
    return <div className={className}>{children}</div>
  }

  return (
    <div className={`qa-spoil-block spoiler-wrap ${className}`.trim()}>
      <div className="spoiler-content" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        className="spoiler-overlay qa-spoil-block__overlay"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          hapticImpact('Light')
          setRevealed(true)
        }}
        aria-label="Spoiler · Tap to reveal"
      >
        <span className="qa-spoil-block__label text-caption">
          <EyeOff size={16} aria-hidden="true" />
          Spoiler · Tap to reveal
        </span>
      </button>
    </div>
  )
}
