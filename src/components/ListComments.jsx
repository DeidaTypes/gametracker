import React, { useState, useEffect, useRef, useCallback } from 'react'
import { formatActivityDate } from '../utils/formatActivityDate'
import {
  getListComments,
  postListComment,
  deleteListComment,
} from '../services/listInteractionService'
import { showToast } from './Toast'
import { shouldShowCount } from '../utils/formatSocialCount'
import { whenKeyboardSettled } from '../services/keyboardInset'
import './ListComments.css'


function Avatar({ user, size = 32 }) {
  const name = user?.display_name || user?.username || '?'
  const initial = name.charAt(0).toUpperCase()
  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt=""
        className="lc-avatar"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    )
  }
  return (
    <span
      className="lc-avatar lc-avatar--fallback"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

function CommentRow({ comment, canDelete, onDelete }) {
  const [deleting, setDeleting] = useState(false)
  const user = comment.users || {}
  const displayName = user.display_name || user.username || 'Unknown'

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await onDelete(comment.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className={`lc-comment${deleting ? ' lc-comment--deleting' : ''}`}>
      <Avatar user={user} size={28} />
      <div className="lc-comment-content">
        <div className="lc-comment-header">
          <span className="lc-comment-author">{displayName}</span>
          <span className="lc-comment-time">{formatActivityDate(comment.created_at)}</span>
          {canDelete && (
            <button
              type="button"
              className="lc-comment-delete"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete comment"
            >
              Delete
            </button>
          )}
        </div>
        <p className="lc-comment-body">{comment.body}</p>
      </div>
    </div>
  )
}

/**
 * Flat comments thread for a custom list.
 *
 * Props:
 *   listId       — uuid of the list
 *   currentUserId — auth.uid() or null
 *   isOwner      — true if the viewer owns the list (can moderate/delete any comment)
 */
export default function ListComments({ listId, currentUserId, isOwner }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

  const load = useCallback(async () => {
    if (!listId) return
    setLoading(true)
    const data = await getListComments(listId)
    setComments(data)
    setLoading(false)
  }, [listId])

  useEffect(() => {
    load()
  }, [load])

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [draft])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)

    // Optimistic insert with a temp id
    const tempId = `__temp_${Date.now()}`
    const optimistic = {
      id: tempId,
      list_id: listId,
      user_id: currentUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      users: null,
      __optimistic: true,
    }
    setComments((prev) => [...prev, optimistic])
    setDraft('')

    try {
      const confirmed = await postListComment({ listId, body: trimmed })
      setComments((prev) =>
        prev.map((c) => (c.id === tempId ? confirmed : c))
      )
    } catch (err) {
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      showToast(err.message || "Couldn't post comment. Please try again.", 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (commentId) => {
    // Optimistic remove
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    try {
      await deleteListComment(commentId)
    } catch (err) {
      // Re-fetch to restore if delete failed
      load()
      showToast(err.message || "Couldn't delete comment. Please try again.", 'error')
    }
  }

  return (
    <section className="lc-section" aria-label="Comments">
      {/* Heading always renders, even at zero — only the comment count
          itself is hidden below the zero-state threshold (< 3). */}
      <h3 className="lc-heading">
        Comments{shouldShowCount(comments.length) ? ` · ${comments.length}` : ''}
      </h3>

      {!loading && comments.length > 0 && (
        <div className="lc-list">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              canDelete={
                !c.__optimistic &&
                (c.user_id === currentUserId || isOwner)
              }
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {currentUserId && (
        <form className="lc-compose" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className="lc-compose-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment"
            maxLength={2000}
            rows={1}
            aria-label="Write a comment"
            onFocus={() => {
              // Scroll only once the keyboard has settled, so we target where
              // the layout actually ended up rather than where it was headed.
              whenKeyboardSettled(() => {
                textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          {/* Text-only "Post" — appears only once there's something to
              post; no button at all while the composer is empty. */}
          {draft.trim() && (
            <button
              type="submit"
              className="lc-compose-submit"
              disabled={submitting}
              aria-label="Post comment"
            >
              Post
            </button>
          )}
        </form>
      )}
    </section>
  )
}
