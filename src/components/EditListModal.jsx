import { useEffect, useRef, useState } from 'react'
import { Globe, Lock } from 'lucide-react'
import CenteredModal from './CenteredModal'
import IOSSwitch from './IOSSwitch'
import { discardConfirm, useConfirmSheet } from './ConfirmSheet'
import { QaCounter } from '../pages/qa/QaComposerSheet'
import '../pages/qa/qaComposerModal.css'
import './forms/forms.css'
import './EditListModal.css'

const NAME_MAX = 60
const DESC_MAX = 500

const VISIBILITY_COPY = {
  public: 'Anyone can find and view this list.',
  private: 'Only you and collaborators can see this list.',
}

/**
 * EditListModal — owner-only centered popup to edit list name, description, and visibility.
 */
export default function EditListModal({
  isOpen,
  onClose,
  initialName = '',
  initialDescription = '',
  initialIsPublic = true,
  fieldError = null,
  onSave,
  saving = false,
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const descRef = useRef(null)
  const [confirm, confirmSheet] = useConfirmSheet()

  useEffect(() => {
    if (!isOpen) return
    setName(initialName)
    setDescription(initialDescription)
    setIsPublic(initialIsPublic)
    const t = setTimeout(() => {
      const el = descRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }, 80)
    return () => clearTimeout(t)
  }, [isOpen, initialName, initialDescription, initialIsPublic])

  const trimmedName = name.trim()
  const trimmedDesc = description.trim()
  const initialTrimmedDesc = (initialDescription || '').trim()

  const isDirty =
    trimmedName !== (initialName || '').trim() ||
    trimmedDesc !== initialTrimmedDesc ||
    isPublic !== initialIsPublic

  const canSave = isDirty && trimmedName.length > 0 && !saving

  const handleCancel = async () => {
    if (isDirty && !(await confirm(discardConfirm('list', { editing: true })))) return
    onClose()
  }

  const handleSave = () => {
    if (!canSave) return
    onSave({
      name: trimmedName,
      description: trimmedDesc,
      isPublic,
    })
  }

  return (
    <>
      <CenteredModal
        isOpen={isOpen}
        onClose={handleCancel}
        ariaLabel="Edit list"
        maxWidth={360}
        steady
      >
        <div className="qa-cmp-topbar">
          <button className="qa-cmp-topbar-cancel" onClick={handleCancel} type="button">
            Cancel
          </button>
          <span className="qa-cmp-topbar-title">Edit list</span>
          <button
            className={`qa-cmp-topbar-post${!canSave ? ' qa-cmp-topbar-post--disabled' : ''}`}
            onClick={handleSave}
            disabled={!canSave}
            type="button"
            aria-disabled={!canSave}
          >
            {saving ? (
              <span className="qa-cmp-post-spinner" aria-label="Saving…" />
            ) : (
              'Save'
            )}
          </button>
        </div>

        <div className="qa-cmp-scroll cm-scroll">
          <div className="qa-cmp-field">
            <p className="qa-cmp-section-label">Name</p>
            <input
              className="qa-cmp-title-input elm-list-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
              maxLength={NAME_MAX}
              placeholder="List name"
              aria-label="List name"
              autoComplete="off"
            />
          </div>

          <div className="qa-cmp-field">
            <p className="qa-cmp-section-label">Description</p>
            <div className="qa-cmp-textarea-wrap">
              <textarea
                ref={descRef}
                className="qa-cmp-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
                maxLength={DESC_MAX}
                placeholder="Add a description… (optional)"
                aria-label="List description"
              />
              <QaCounter value={description} max={DESC_MAX} />
            </div>
          </div>

          {fieldError && (
            <p className="form-field__error" role="alert">
              {fieldError}
            </p>
          )}

          <div className="qa-cmp-group" role="group" aria-label="List visibility">
            <div className="qa-cmp-group-row elm-list-vis-row">
              <span className="elm-list-vis-icon" aria-hidden="true">
                {isPublic ? <Globe size={19} /> : <Lock size={19} />}
              </span>
              <span className="qa-cmp-group-copy">
                <span className="qa-cmp-group-label">{isPublic ? 'Public' : 'Private'}</span>
                <span className="qa-cmp-group-sub">
                  {isPublic ? VISIBILITY_COPY.public : VISIBILITY_COPY.private}
                </span>
              </span>
              <IOSSwitch
                checked={isPublic}
                label={isPublic ? 'Public list' : 'Private list'}
                onChange={setIsPublic}
              />
            </div>
          </div>
        </div>
      </CenteredModal>
      {confirmSheet}
    </>
  )
}
