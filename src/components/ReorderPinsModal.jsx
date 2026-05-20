import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuChevronUp, LuChevronDown, LuPin } from 'react-icons/lu'
import './ReorderPinsModal.css'

/**
 * Sprint 6 P3 — Reorder pinned reviews on Profile.
 *
 * Mirrors the bottom-sheet pattern used by ActionSheet / SortSheet so
 * the layered z-index, slide-up animation, and reduced-motion handling
 * come "for free" via the shared `.action-sheet-overlay` + `.action-sheet`
 * classes in ActionSheet.css.
 *
 * The drag-handle reorder UX was the original plan, but a simple
 * up/down arrow modal is the documented fallback and ships with far
 * less surface area. The arrow buttons mutate a local copy of the
 * order so the user can rearrange freely before committing — only the
 * "Save order" tap fires `onSave` and calls `reorderPins(...)`.
 *
 * Props:
 *   isOpen   – boolean
 *   onClose  – () => void
 *   pins     – Array<{ review_id, title, coverUrl, gameName }>
 *              in current persisted order (position 0 → N).
 *   onSave   – (orderedReviewIds: string[]) => Promise<void>
 *              Resolves when the new order has been persisted.
 *              Rejecting bubbles up to the caller (Profile) to roll
 *              back the optimistic UI.
 */
function ReorderPinsModal({ isOpen, onClose, pins = [], onSave }) {
  const [order, setOrder] = useState(pins)
  const [saving, setSaving] = useState(false)
  const sheetRef = useRef(null)

  // Reset the local order whenever the sheet (re)opens — otherwise a
  // user who reorders, cancels, and reopens would see the stale draft.
  useEffect(() => {
    if (isOpen) {
      setOrder(pins)
      setSaving(false)
    }
  }, [isOpen, pins])

  // Move focus into the sheet for keyboard / screen-reader users —
  // same pattern as SortSheet.
  useEffect(() => {
    if (!isOpen) return undefined
    const el = sheetRef.current
    if (!el) return undefined
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Escape closes when not mid-save.
  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose, saving])

  if (!isOpen) return null

  const moveUp = (idx) => {
    if (idx <= 0) return
    setOrder((curr) => {
      const next = [...curr]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }
  const moveDown = (idx) => {
    setOrder((curr) => {
      if (idx >= curr.length - 1) return curr
      const next = [...curr]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  const handleSave = async () => {
    const ids = order.map((p) => p.review_id)
    setSaving(true)
    try {
      await onSave(ids)
      onClose()
    } catch {
      // Caller has surfaced an error toast; just stop the spinner so
      // the user can retry.
      setSaving(false)
    }
  }

  // True when the current draft differs from the persisted order. We
  // keep the save button enabled regardless (so the user can confirm
  // their no-op intent) but skip the API call in that case.
  const dirty = order.some((p, i) => pins[i]?.review_id !== p.review_id)

  return createPortal(
    <div
      className="action-sheet-overlay"
      onClick={saving ? undefined : onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Reorder pinned reviews"
    >
      <div
        ref={sheetRef}
        className="action-sheet reorder-pins"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="action-sheet__handle" aria-hidden="true" />
        <p className="action-sheet__title">Reorder Pins</p>

        <ul className="reorder-pins__list" role="list">
          {order.map((p, idx) => (
            <li key={p.review_id} className="reorder-pins__row">
              <div className="reorder-pins__slot" aria-hidden="true">
                {idx + 1}
              </div>
              <div className="reorder-pins__cover">
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className="reorder-pins__cover-fallback">
                    <LuPin size={16} aria-hidden="true" />
                  </span>
                )}
              </div>
              <div className="reorder-pins__meta">
                <span className="reorder-pins__game">
                  {p.gameName || 'Untitled'}
                </span>
                {p.title && (
                  <span className="reorder-pins__title">{p.title}</span>
                )}
              </div>
              <div className="reorder-pins__arrows">
                <button
                  type="button"
                  className="reorder-pins__arrow"
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0 || saving}
                  aria-label={`Move ${p.gameName || 'pin'} up`}
                >
                  <LuChevronUp size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="reorder-pins__arrow"
                  onClick={() => moveDown(idx)}
                  disabled={idx === order.length - 1 || saving}
                  aria-label={`Move ${p.gameName || 'pin'} down`}
                >
                  <LuChevronDown size={18} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="reorder-pins__footer">
          <button
            type="button"
            className="reorder-pins__cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="reorder-pins__save"
            onClick={dirty ? handleSave : onClose}
            disabled={saving}
          >
            {saving ? 'Saving…' : dirty ? 'Save order' : 'Done'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ReorderPinsModal
