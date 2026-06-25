import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { UserPlus, X, Users } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { getFollowing } from '../services/followService'
import { addCollaborator, removeCollaborator } from '../services/listService'
import { showToast } from './Toast'
import './CollaboratorSheet.css'

/**
 * CollaboratorSheet — bottom-sheet for managing list collaborators.
 *
 * Props:
 *   isOpen          – boolean
 *   onClose         – () => void
 *   listId          – string
 *   isOwner         – boolean; if false sheet is read-only
 *   currentUserId   – string|null; the signed-in user (owner) id
 *   collaborators   – Array<{ userId, username, displayName, avatarUrl }>
 *   onChanged       – () => void; called after any mutation so parent refreshes
 */
function CollaboratorSheet({
  isOpen,
  onClose,
  listId,
  isOwner,
  currentUserId,
  collaborators = [],
  onChanged,
}) {
  const { reduced } = useMotionPreference()
  const [following, setFollowing] = useState([])
  const [loadingFollowing, setLoadingFollowing] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(new Set())
  const [pendingRemove, setPendingRemove] = useState(new Set())

  // Load the owner's Following list once the sheet opens
  useEffect(() => {
    if (!isOpen || !isOwner || !currentUserId) return
    let cancelled = false
    setLoadingFollowing(true)
    getFollowing(currentUserId, 50, 0)
      .then((rows) => {
        if (!cancelled) {
          setFollowing(rows.map((r) => ({
            userId: r.followee_id,
            username: r.followee?.username || '',
            displayName: r.followee?.display_name || r.followee?.username || '',
            avatarUrl: r.followee?.avatar_url || null,
          })))
        }
      })
      .finally(() => { if (!cancelled) setLoadingFollowing(false) })
    return () => { cancelled = true }
  }, [isOpen, isOwner, currentUserId])

  const collaboratorIds = new Set(collaborators.map((c) => c.userId))

  // People the owner follows who are not yet collaborators (and not the owner)
  const inviteable = following.filter(
    (u) => !collaboratorIds.has(u.userId) && u.userId !== currentUserId
  )

  const handleAdd = async (user) => {
    setPendingAdd((s) => new Set(s).add(user.userId))
    try {
      await addCollaborator(listId, user.userId)
      showToast(`${user.displayName || user.username} added`, 'success')
      onChanged?.()
    } catch {
      showToast('Could not add collaborator. Please try again.', 'error')
    } finally {
      setPendingAdd((s) => { const n = new Set(s); n.delete(user.userId); return n })
    }
  }

  const handleRemove = async (user) => {
    setPendingRemove((s) => new Set(s).add(user.userId))
    try {
      await removeCollaborator(listId, user.userId)
      showToast(`${user.displayName || user.username} removed`, 'success')
      onChanged?.()
    } catch {
      showToast('Could not remove collaborator. Please try again.', 'error')
    } finally {
      setPendingRemove((s) => { const n = new Set(s); n.delete(user.userId); return n })
    }
  }

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="collab-sheet-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label="Manage collaborators"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="collab-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="collab-sheet__handle" aria-hidden="true" />

            <div className="collab-sheet__header">
              <span className="collab-sheet__title">Collaborators</span>
              <button
                type="button"
                className="collab-sheet__close"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="collab-sheet__body">

              {/* Current collaborators */}
              {collaborators.length > 0 ? (
                <section className="collab-sheet__section">
                  <p className="collab-sheet__section-label">Co-editors</p>
                  <ul className="collab-sheet__user-list">
                    {collaborators.map((u) => (
                      <li key={u.userId} className="collab-sheet__user-row">
                        <UserAvatar
                          avatarUrl={u.avatarUrl}
                          name={u.displayName || u.username}
                        />
                        <div className="collab-sheet__user-info">
                          <span className="collab-sheet__user-name">
                            {u.displayName || u.username}
                          </span>
                          {u.username && (
                            <span className="collab-sheet__user-handle">@{u.username}</span>
                          )}
                        </div>
                        {isOwner && (
                          <button
                            type="button"
                            className="collab-sheet__remove-btn"
                            onClick={() => handleRemove(u)}
                            disabled={pendingRemove.has(u.userId)}
                            aria-label={`Remove ${u.displayName || u.username}`}
                          >
                            <X size={15} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <div className="collab-sheet__empty-collab">
                  <Users size={28} aria-hidden="true" />
                  <p>No co-editors yet</p>
                </div>
              )}

              {/* Invite from Following — owner only */}
              {isOwner && (
                <section className="collab-sheet__section">
                  <p className="collab-sheet__section-label">Invite from Following</p>
                  {loadingFollowing ? (
                    <div className="collab-sheet__loading">Loading…</div>
                  ) : inviteable.length === 0 ? (
                    <div className="collab-sheet__empty-following">
                      {following.length === 0
                        ? "You're not following anyone yet."
                        : 'Everyone you follow is already a co-editor.'}
                    </div>
                  ) : (
                    <ul className="collab-sheet__user-list">
                      {inviteable.map((u) => (
                        <li key={u.userId} className="collab-sheet__user-row">
                          <UserAvatar
                            avatarUrl={u.avatarUrl}
                            name={u.displayName || u.username}
                          />
                          <div className="collab-sheet__user-info">
                            <span className="collab-sheet__user-name">
                              {u.displayName || u.username}
                            </span>
                            {u.username && (
                              <span className="collab-sheet__user-handle">@{u.username}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="collab-sheet__add-btn"
                            onClick={() => handleAdd(u)}
                            disabled={pendingAdd.has(u.userId)}
                            aria-label={`Add ${u.displayName || u.username}`}
                          >
                            <UserPlus size={15} aria-hidden="true" />
                            <span>Add</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function UserAvatar({ avatarUrl, name }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className="collab-sheet__avatar"
      loading="lazy"
    />
  ) : (
    <span className="collab-sheet__avatar collab-sheet__avatar--fallback" aria-hidden="true">
      {initial}
    </span>
  )
}

export default CollaboratorSheet
