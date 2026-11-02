import React, { useState, useEffect } from 'react'
import { UserPlus, X, Users } from 'lucide-react'
import { getFollowing } from '../services/followService'
import { addCollaborator, removeCollaborator } from '../services/listService'
import { showToast } from './Toast'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import CenteredModal from './CenteredModal'
import './CollaboratorSheet.css'

/**
 * CollaboratorSheet — centered popup for managing list collaborators.
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
  const [following, setFollowing] = useState([])
  const [loadingFollowing, setLoadingFollowing] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(new Set())
  const [pendingRemove, setPendingRemove] = useState(new Set())

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

  const inviteable = following.filter(
    (u) => !collaboratorIds.has(u.userId) && u.userId !== currentUserId
  )

  const handleAdd = async (user) => {
    setPendingAdd((s) => new Set(s).add(user.userId))
    try {
      await addCollaborator(listId, user.userId)
      showToast('Collaborator added', 'success', null, null, 'user-plus', { sub: user.displayName || user.username, tone: 'list' })
      onChanged?.()
    } catch {
      showToast("Couldn't add the collaborator", 'error', null, null, null, { sub: 'Try again' })
    } finally {
      setPendingAdd((s) => { const n = new Set(s); n.delete(user.userId); return n })
    }
  }

  const handleRemove = async (user) => {
    setPendingRemove((s) => new Set(s).add(user.userId))
    try {
      await removeCollaborator(listId, user.userId)
      showToast('Collaborator removed', 'success', null, null, 'user-minus', { sub: user.displayName || user.username, tone: 'list' })
      onChanged?.()
    } catch {
      showToast("Couldn't remove the collaborator", 'error', null, null, null, { sub: 'Try again' })
    } finally {
      setPendingRemove((s) => { const n = new Set(s); n.delete(user.userId); return n })
    }
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Manage collaborators"
      maxWidth={400}
      className="collab-card"
    >
      <header className="collab-top">
        <span aria-hidden="true" />
        <h2 className="collab-top__title text-title">Collaborators</h2>
        <button type="button" className="collab-top__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="cm-scroll collab-sheet__body">

        {collaborators.length > 0 ? (
          <section className="collab-sheet__section">
            <p className="collab-sheet__section-label">Co-editors</p>
            <ul className="collab-sheet__user-list">
              {collaborators.map((u) => (
                <li key={u.userId} className="collab-sheet__user-row">
                  <Avatar
                    avatarUrl={u.avatarUrl}
                    name={u.displayName || u.username}
                    seed={u.userId}
                    userId={u.userId}
                    size="md"
                    className="collab-sheet__avatar"
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
          <EmptyState icon={Users} size="compact" body="No co-editors yet" />
        )}

        {isOwner && (
          <section className="collab-sheet__section">
            <p className="collab-sheet__section-label">Invite from Following</p>
            {loadingFollowing ? (
              <div className="collab-sheet__loading">Loading…</div>
            ) : inviteable.length === 0 ? (
              <EmptyState
                size="inline"
                body={
                  following.length === 0
                    ? "You're not following anyone yet."
                    : 'Everyone you follow is already a co-editor.'
                }
              />
            ) : (
              <ul className="collab-sheet__user-list">
                {inviteable.map((u) => (
                  <li key={u.userId} className="collab-sheet__user-row">
                    <Avatar
                      avatarUrl={u.avatarUrl}
                      name={u.displayName || u.username}
                      seed={u.userId}
                      userId={u.userId}
                      size="md"
                      className="collab-sheet__avatar"
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
    </CenteredModal>
  )
}

export default CollaboratorSheet
