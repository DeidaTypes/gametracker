import { WifiOff } from 'lucide-react'
import CenteredModal from '../../components/CenteredModal'
import './qaComposerModal.css'

/**
 * Ask / answer popup. The same CenteredModal, top bar and body rhythm as
 * ReviewNew and JournalNew; the game-pick step takes GamePickerSheet's size.
 * The host owns `open` and runs its queued action from `onExited`.
 * `fill` gives the card one fixed height (the Ask flow: pick and compose are
 * the same size); without it the card hugs its content (Answer).
 */
export default function QaComposerSheet({
  open,
  picking = false,
  fill = false,
  title,
  submitLabel = 'Post',
  canSubmit = false,
  busy = false,
  onSubmit,
  onCancel,
  onExited,
  children,
}) {
  const disabled = !canSubmit || busy

  return (
    <CenteredModal
      isOpen={open}
      onClose={onCancel}
      onExited={onExited}
      ariaLabel={picking ? 'Which game is it about?' : title}
      maxWidth={360}
      className={fill ? 'gps-sheet' : ''}
      steady={fill ? 'fill' : true}
    >
      {picking ? (
        children
      ) : (
        <>
          <div className="qa-cmp-topbar">
            <button className="qa-cmp-topbar-cancel" onClick={onCancel} type="button">
              Cancel
            </button>
            <span className="qa-cmp-topbar-title">{title}</span>
            <button
              className={`qa-cmp-topbar-post${disabled ? ' qa-cmp-topbar-post--disabled' : ''}`}
              onClick={onSubmit}
              disabled={disabled}
              type="button"
              aria-disabled={disabled}
            >
              {busy ? (
                <span
                  className="qa-cmp-post-spinner"
                  aria-label={submitLabel === 'Save' ? 'Saving…' : 'Posting…'}
                />
              ) : (
                submitLabel
              )}
            </button>
          </div>
          <div className="qa-cmp-scroll cm-scroll" aria-busy={busy || undefined}>
            {children}
          </div>
        </>
      )}
    </CenteredModal>
  )
}

/**
 * Wrapping single-purpose field (the question title). Its height is fixed in
 * CSS (one line plus one wrap line); longer text scrolls inside it, so typing
 * never moves the fields underneath. Nothing here sets a height.
 */
export function QaGrowField({ value, maxLength, onChange, className = '', fieldRef, ...rest }) {
  return (
    <textarea
      ref={(el) => {
        if (fieldRef) fieldRef.current = el
      }}
      className={className}
      value={value}
      maxLength={maxLength}
      rows={1}
      onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
      {...rest}
    />
  )
}

/** Fixed-height textarea. The height lives in CSS; long text scrolls inside it. */
export function QaTextarea({ value, maxLength, onChange, className = '', ...rest }) {
  return (
    <textarea
      className={className}
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
      {...rest}
    />
  )
}

export function QaComposerNotices({ online, limit }) {
  return (
    <>
      {!online ? (
        <div className="qa-cmp-notice" role="status">
          <WifiOff size={16} aria-hidden="true" />
          <span>You&apos;re offline</span>
        </div>
      ) : null}
      {limit ? (
        <div className="qa-cmp-notice" role="status">
          <span>{limit.message}</span>
        </div>
      ) : null}
    </>
  )
}

/** Always rendered, so it never inserts a row. At the limit it takes the danger token. */
export function QaCounter({ value, max }) {
  const length = String(value || '').length
  return (
    <span className={`qa-cmp-count${length >= max ? ' qa-cmp-count--limit' : ''}`} aria-live="polite">
      {length}/{max}
    </span>
  )
}
