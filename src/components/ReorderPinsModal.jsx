import React, { useEffect, useState } from 'react'
import { LuChevronUp, LuChevronDown, LuPin } from 'react-icons/lu'
import CenteredModal from './CenteredModal'
import './ReorderPinsModal.css'

/**
 * Sprint 6 P3 — Reorder pinned reviews on Profile (centered popup).
 *
 * Up/down arrows mutate a local copy of the order; only Save order calls
 * `onSave` and `reorderPins(...)`.
 *
 * Props:
 *   isOpen   – boolean
 *   onClose  – () => void
 *   pins     – Array<{ review_id, title, coverUrl, gameName }>
 *   onSave   – (orderedReviewIds: string[]) => Promise<void>
 */
function ReorderPinsModal({ isOpen, onClose, pins = [], onSave }) {
  const [order, setOrder] = useState(pins)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setOrder(pins)
      setSaving(false)
    }
  }, [isOpen, pins])

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
      setSaving(false)
    }
  }

  const dirty = order.some((p, i) => pins[i]?.review_id !== p.review_id)
  const actionLabel = saving ? 'Saving…' : dirty ? 'Save order' : 'Done'

  const handleAction = () => {
    if (saving) return
    if (dirty) void handleSave()
    else onClose()
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      dismissOnBackdrop={!saving}
      ariaLabel="Reorder pinned reviews"
      maxWidth={400}
      className="rpm-card"
    >
      <header className="rpm-topbar">
        <button
          type="button"
          className="rpm-topbar-cancel"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <h2 className="rpm-topbar-title text-title">Reorder pins</h2>
        <button
          type="button"
          className={`rpm-topbar-action${saving ? ' rpm-topbar-action--disabled' : ''}`}
          onClick={handleAction}
          disabled={saving}
        >
          {actionLabel}
        </button>
      </header>

      <div className="cm-scroll rpm-body">
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
      </div>
    </CenteredModal>
  )
}

export default ReorderPinsModal
