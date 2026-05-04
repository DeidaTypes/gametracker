import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DestructiveButton, SecondaryButton } from './forms'
import './DeleteConfirmModal.css'

/**
 * Confirmation modal for destructive list-deletion.
 *
 * Props:
 *   isOpen    – boolean
 *   listName  – string  (e.g. "JRPGs")
 *   gameCount – number
 *   onConfirm – () => void
 *   onCancel  – () => void
 */
function DeleteConfirmModal({ isOpen, listName, gameCount, onConfirm, onCancel }) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const gamesLabel = `${gameCount} ${gameCount === 1 ? 'game' : 'games'}`

  return createPortal(
    <div
      className="modal-overlay delete-confirm-overlay"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      aria-describedby="delete-confirm-body"
    >
      <div
        className="modal-content delete-confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-confirm-title" className="delete-confirm__title">
          Delete this list?
        </h2>

        <p id="delete-confirm-body" className="delete-confirm__body">
          <strong>{listName}</strong> and its {gamesLabel} will be permanently
          removed from your library. This can&rsquo;t be undone.
        </p>

        <div className="delete-confirm__footer">
          <DestructiveButton onClick={onConfirm}>
            Delete list
          </DestructiveButton>
          {/* autoFocus Cancel so accidental taps don't delete */}
          <SecondaryButton onClick={onCancel} autoFocus>
            Cancel
          </SecondaryButton>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default DeleteConfirmModal
