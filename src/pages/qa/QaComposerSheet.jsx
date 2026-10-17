import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import ActionSheet from '../../components/ActionSheet'
import KeyboardAwareView from '../../components/KeyboardAwareView'
import { useKeyboardInset } from '../../hooks/useKeyboardInset'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { sheetDragEnd, sheetTransition } from '../../motion/xMotion'

const FieldFocus = createContext(null)

export function useComposerFieldFocus() {
  return useContext(FieldFocus)
}

function revealField(el, scroller) {
  if (!el || !scroller || !scroller.contains(el)) return
  const field = el.closest('.qa-ps-field') || el
  const top = field.offsetTop
  const bottom = top + field.offsetHeight
  const viewTop = scroller.scrollTop
  const viewBottom = viewTop + scroller.clientHeight
  if (top < viewTop) scroller.scrollTop = Math.max(0, top - 8)
  else if (bottom > viewBottom) scroller.scrollTop = bottom - scroller.clientHeight + 8
}

/**
 * Full-height composer. Same slide, swipe-down, and Cancel as ActionSheet.
 * KeyboardAwareView mode "sheet" lifts it; the sheet's own height shrinks by
 * the same inset so the header (and Post) stay on screen and the body scrolls.
 */
export default function QaComposerSheet({
  open,
  covered = false,
  title,
  submitLabel = 'Post',
  canSubmit = false,
  busy = false,
  dirty = false,
  discardTitle = 'Discard question?',
  onSubmit,
  onClose,
  children,
}) {
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()
  const titleId = useId()
  const overlayRef = useRef(null)
  const bodyRef = useRef(null)
  const focusRef = useRef(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const inset = useKeyboardInset()

  const requestClose = () => {
    if (dirty) setDiscardOpen(true)
    else onClose()
  }

  useEffect(() => {
    if (!open) setDiscardOpen(false)
  }, [open])

  useEffect(() => {
    const el = overlayRef.current
    if (!el) return undefined
    if (covered) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
    return undefined
  }, [covered, open])

  useEffect(() => {
    if (!covered) return undefined
    const active = document.activeElement
    if (overlayRef.current?.contains(active)) active.blur()
    return undefined
  }, [covered])

  useEffect(() => {
    if (!open || covered || discardOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!open || covered) return undefined
    revealField(focusRef.current, bodyRef.current)
    return undefined
  }, [inset, open, covered])

  const onFieldFocus = (event) => {
    focusRef.current = event.target
    const scroller = bodyRef.current
    requestAnimationFrame(() => revealField(event.target, scroller))
  }

  const backdrop = sheetTransition(reduced)
  const sheetMove = sheetTransition(reduced)

  return createPortal(
    <>
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={overlayRef}
          className={`qa-ps-overlay${covered ? ' qa-ps-overlay--covered' : ''}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) requestClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={covered || undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdrop}
        >
          <KeyboardAwareView mode="sheet" className="qa-ps-anchor">
            <motion.div
              className="qa-ps"
              onClick={(event) => event.stopPropagation()}
              initial={reduced ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={reduced ? { y: 0 } : { y: '100%' }}
              transition={sheetMove}
              drag={reduced ? false : 'y'}
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={sheetDragEnd(requestClose)}
              aria-busy={busy || undefined}
            >
              <div
                className="qa-ps__drag"
                onPointerDown={(event) => {
                  if (reduced || event.target.closest('button')) return
                  dragControls.start(event)
                }}
              >
                <div className="qa-ps__handle" aria-hidden="true" />
              <header className="qa-ps__head">
                <button type="button" className="qa-ps__cancel text-body" onClick={requestClose}>
                  Cancel
                </button>
                <span id={titleId} className="qa-ps__title text-body" title={title}>
                  {title}
                </span>
                <span className="qa-ps__submit-slot">
                  <button
                    type="button"
                    className="qa-ps__post text-body"
                    disabled={!canSubmit || busy}
                    onClick={onSubmit}
                  >
                    {submitLabel}
                  </button>
                </span>
              </header>
              </div>
              <FieldFocus.Provider value={onFieldFocus}>
                <div className="qa-ps__body" ref={bodyRef}>
                  {children}
                </div>
              </FieldFocus.Provider>
            </motion.div>
          </KeyboardAwareView>
        </motion.div>
      ) : null}
    </AnimatePresence>
    <ActionSheet
      isOpen={discardOpen && open}
      onClose={() => setDiscardOpen(false)}
      title={discardTitle}
      cancelLabel="Keep editing"
      items={[
        {
          label: 'Discard',
          destructive: true,
          onClick: onClose,
        },
      ]}
    />
    </>,
    document.body
  )
}

export function QaGrowField({ value, maxLength, onChange, className = '', onFocus, ...rest }) {
  const ref = useRef(null)
  const sheetFocus = useComposerFieldFocus()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      className={`qa-ps-input text-body ${className}`.trim()}
      value={value}
      maxLength={maxLength}
      rows={1}
      onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
      onFocus={(event) => {
        sheetFocus?.(event)
        onFocus?.(event)
      }}
      {...rest}
    />
  )
}

export function QaCounter({ value, max }) {
  const length = String(value || '').length
  if (length <= max * 0.8) return null
  const atLimit = length >= max
  return (
    <span className={`qa-counter text-caption${atLimit ? ' qa-counter--limit' : ''}`}>
      {length} / {max}
    </span>
  )
}
