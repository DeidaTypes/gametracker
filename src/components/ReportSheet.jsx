import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { submitReport } from '../services/reportService'
import { showToast } from './Toast'
import './ReportSheet.css'

const REASONS = [
  { value: 'spam',            label: 'Spam' },
  { value: 'harassment',      label: 'Harassment or bullying' },
  { value: 'hate_speech',     label: 'Hate speech' },
  { value: 'sexual_content',  label: 'Sexual content' },
  { value: 'violence',        label: 'Violence or threats' },
  { value: 'self_harm',       label: 'Self-harm or suicide' },
  { value: 'misinformation',  label: 'Misinformation' },
  { value: 'other',           label: 'Something else' },
]

const DETAILS_MAX = 280

/**
 * Shared report bottom sheet.
 *
 * Props:
 *   isOpen      – boolean
 *   onClose     – () => void
 *   contentType – 'review' | 'comment' | 'message' | 'profile' | 'list'
 *   contentId   – uuid string of the content being reported
 */
function ReportSheet({ isOpen, onClose, contentType, contentId }) {
  const { reduced } = useMotionPreference()
  const [selectedReason, setSelectedReason] = useState('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const sheetRef = useRef(null)

  // Reset form state each time the sheet opens so stale reason/details
  // from a previous report don't bleed into the next one.
  useEffect(() => {
    if (isOpen) {
      setSelectedReason('')
      setDetails('')
      setSubmitting(false)
    }
  }, [isOpen])

  // Trap focus and handle Escape key.
  useEffect(() => {
    if (!isOpen) return undefined
    const el = sheetRef.current
    if (el) {
      const id = setTimeout(() => el.focus(), 50)
      return () => clearTimeout(id)
    }
    return undefined
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const handleSubmit = async () => {
    if (!selectedReason || submitting) return
    setSubmitting(true)
    try {
      const result = await submitReport({
        contentType,
        contentId,
        reason: selectedReason,
        details,
      })
      if (result.alreadyReported) {
        showToast("You've already reported this. We're reviewing it.", 'info')
      } else {
        showToast("Report submitted. We'll review it within 24 hours.", 'success')
      }
      onClose()
    } catch (err) {
      console.error('[ReportSheet] submit failed:', err)
      showToast("Couldn't submit your report. Please try again.", 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const displayType = contentType
    ? contentType.charAt(0).toUpperCase() + contentType.slice(1)
    : 'Content'

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="report-sheet-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label={`Report ${displayType}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="report-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="report-sheet__handle" aria-hidden="true" />

            <div className="report-sheet__header">
              <h2 className="report-sheet__title">Report {displayType.toLowerCase()}</h2>
              <p className="report-sheet__subtitle">
                Help us keep GameTracker safe. Reports are private.
              </p>
            </div>

            <div className="report-sheet__reasons" role="radiogroup" aria-label="Reason for report">
              {REASONS.map(({ value, label }) => (
                <label key={value} className="report-sheet__reason-row">
                  <input
                    type="radio"
                    name="report-reason"
                    value={value}
                    checked={selectedReason === value}
                    onChange={() => setSelectedReason(value)}
                    className="report-sheet__radio"
                  />
                  <span className="report-sheet__reason-label">{label}</span>
                </label>
              ))}
            </div>

            <div className="report-sheet__details-wrap">
              <label className="report-sheet__details-label" htmlFor="report-details">
                Tell us more <span className="report-sheet__details-optional">(optional)</span>
              </label>
              <textarea
                id="report-details"
                className="report-sheet__details-input"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, DETAILS_MAX))}
                placeholder="Add any additional context…"
                rows={3}
                maxLength={DETAILS_MAX}
              />
              <span className="report-sheet__char-count" aria-live="polite">
                {details.length}/{DETAILS_MAX}
              </span>
            </div>

            <div className="report-sheet__actions">
              <button
                type="button"
                className="report-sheet__btn report-sheet__btn--cancel"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="report-sheet__btn report-sheet__btn--submit"
                onClick={handleSubmit}
                disabled={!selectedReason || submitting}
              >
                {submitting ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ReportSheet
