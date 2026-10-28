import { useId } from 'react'
import { Lock } from 'lucide-react'
import CenteredModal from '../../components/CenteredModal'
import './QaPublicNotice.css'

/**
 * Shown once, before a private account's first question or answer.
 * Got it continues the post. Cancel keeps the draft.
 * Stacks over the Ask composer (nested CenteredModal dim).
 */
export default function QaPublicNotice({ open, onAccept, onCancel }) {
  const titleId = useId()

  return (
    <CenteredModal
      isOpen={open}
      onClose={onCancel}
      ariaLabel="Questions and answers are public"
      maxWidth={400}
      className="qpn-card"
    >
      <div className="qpn-body">
        <span className="qpn-icon" aria-hidden="true">
          <Lock size={28} strokeWidth={1.8} />
        </span>
        <h2 id={titleId} className="text-title">
          Questions and answers are public
        </h2>
        <p className="text-body qpn-copy">
          Your account is private, but anything you post in Q&amp;A can be seen by everyone.
          Your library and activity stay private.
        </p>
        <button type="button" className="qpn-go text-body" onClick={onAccept}>
          Got it
        </button>
        <button type="button" className="qpn-stop text-body" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </CenteredModal>
  )
}
