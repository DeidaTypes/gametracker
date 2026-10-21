import { useEffect, useRef } from 'react'
import { WifiOff } from 'lucide-react'
import CenteredModal from '../../components/CenteredModal'
import './qaComposerModal.css'

/**
 * Ask / answer popup. The same CenteredModal, top bar and body rhythm as
 * ReviewNew and JournalNew; the game-pick step takes GamePickerSheet's size.
 * The host owns `open` and runs its queued action from `onExited`.
 */
export default function QaComposerSheet({
  open,
  picking = false,
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
      maxWidth={picking ? 480 : 360}
      className={picking ? 'gps-sheet kb-modal-fill' : ''}
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

export function QaGrowField({ value, maxLength, onChange, className = '', fieldRef, ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [value])

  return (
    <textarea
      ref={(el) => {
        ref.current = el
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

export function QaCounter({ value, max, always = false }) {
  const length = String(value || '').length
  if (!always && length <= max * 0.8) return null
  return (
    <span className={`qa-cmp-count${length >= max ? ' qa-cmp-count--limit' : ''}`} aria-live="polite">
      {length}/{max}
    </span>
  )
}
