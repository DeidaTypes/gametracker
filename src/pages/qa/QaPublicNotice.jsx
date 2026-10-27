import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { Lock } from 'lucide-react'
import KeyboardAwareView from '../../components/KeyboardAwareView'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { sheetDim, sheetDragEnd, sheetPanel } from '../../motion/xMotion'

/**
 * Shown once, before a private account's first question or answer.
 * Got it continues the post. Cancel keeps the draft.
 */
export default function QaPublicNotice({ open, onAccept, onCancel }) {
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="qa-notice-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) onCancel()
          }}
          {...sheetDim(reduced)}
        >
          <KeyboardAwareView mode="sheet" className="qa-notice-anchor">
            <motion.div
              className="qa-notice"
              onClick={(event) => event.stopPropagation()}
              {...sheetPanel(reduced)}
              drag={reduced ? false : 'y'}
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={sheetDragEnd(onCancel)}
            >
              <div
                className="qa-ps__drag"
                onPointerDown={(event) => {
                  if (!reduced) dragControls.start(event)
                }}
              >
                <div className="qa-ps__handle" aria-hidden="true" />
              </div>
              <div className="qa-notice__body">
                <span className="qa-notice__icon" aria-hidden="true">
                  <Lock size={28} strokeWidth={1.8} />
                </span>
                <h2 id={titleId} className="text-title">
                  Questions and answers are public
                </h2>
                <p className="text-body qa-notice__copy">
                  Your account is private, but anything you post in Q&amp;A can be seen by everyone.
                  Your library and activity stay private.
                </p>
                <button type="button" className="qa-notice__go text-body" onClick={onAccept}>
                  Got it
                </button>
                <button type="button" className="qa-notice__stop text-body" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </motion.div>
          </KeyboardAwareView>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}
