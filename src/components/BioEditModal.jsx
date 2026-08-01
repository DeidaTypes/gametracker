import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { updateProfile } from '../services/profileService'
import { supabase } from '../services/supabase'
import { showToast } from './Toast'
import ActionSheet from './ActionSheet'
import CenteredModal from './CenteredModal'
import './BioEditModal.css'

const BIO_MAX = 160

/**
 * BioEditModal — centered modal for editing the user's bio.
 *
 * Presentation (including keyboard avoidance) comes from the shared
 * CenteredModal shell; this component owns only the bio-editing behaviour.
 *
 * Props:
 *   isOpen      – boolean
 *   onClose     – () => void
 *   currentBio  – string (pre-fills the textarea)
 *   onSave      – (updatedProfile) => void  called after optimistic save
 */
function BioEditModal({ isOpen, onClose, currentBio = '', onSave }) {
  const [text, setText] = useState(currentBio)
  const [saving, setSaving] = useState(false)
  const [focused, setFocused] = useState(false)
  const [discardSheetOpen, setDiscardSheetOpen] = useState(false)
  const textareaRef = useRef(null)

  // Sync textarea whenever the modal opens or currentBio changes
  useEffect(() => {
    if (isOpen) setText(currentBio)
  }, [isOpen, currentBio])

  // Auto-focus with cursor at end when modal opens
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 120)
    return () => clearTimeout(id)
  }, [isOpen])

  // Auto-grow textarea height between min and max
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])

  // Escape key triggers the dismiss flow
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') handleDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, text, currentBio])

  const isDirty = text !== currentBio
  const overLimit = text.length > BIO_MAX
  // Show counter when focused OR within 20 chars of the limit
  const showCounter = focused || text.length >= BIO_MAX - 20

  const handleDismiss = () => {
    if (isDirty) {
      setDiscardSheetOpen(true)
    } else {
      onClose()
    }
  }

  const handleDiscard = () => {
    setDiscardSheetOpen(false)
    onClose()
  }

  const handleSave = async () => {
    if (saving || overLimit || !isDirty) return
    setSaving(true)

    const trimmed = text.trim()

    // Optimistic update — localStorage is source of truth for the session
    const updated = updateProfile({ bio: trimmed })
    onSave(updated)
    onClose()
    showToast('Bio updated')

    // Best-effort sync to Supabase
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users').update({ bio: trimmed }).eq('id', user.id)
      }
    } catch {
      // offline / signed-out — localStorage value applies
    }

    setSaving(false)
  }

  return (
    <>
      <CenteredModal
        isOpen={isOpen}
        onClose={handleDismiss}
        ariaLabel="Edit bio"
        className="bio-modal-card"
      >
        {/* Header */}
        <div className="bio-modal-header">
          <h2 className="bio-modal-title">Edit bio</h2>
          <button
            type="button"
            className="bio-modal-close"
            onClick={handleDismiss}
            aria-label="Close"
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="bio-modal-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Tell people what you play…"
          aria-label="Bio"
        />

        {/* Character counter — conditional */}
        {showCounter && (
          <p
            className={`bio-modal-counter${overLimit ? ' bio-modal-counter--over' : ''}`}
            aria-live="polite"
          >
            {text.length}/160
          </p>
        )}

        {/* Save button */}
        <button
          type="button"
          className="bio-modal-save"
          onClick={handleSave}
          disabled={!isDirty || overLimit || saving}
        >
          Save Changes
        </button>
      </CenteredModal>

      {/* Discard confirm sheet */}
      <ActionSheet
        isOpen={discardSheetOpen}
        onClose={() => setDiscardSheetOpen(false)}
        title="Discard changes?"
        items={[
          { label: 'Discard', onClick: handleDiscard, destructive: true },
        ]}
      />
    </>
  )
}

export default BioEditModal
