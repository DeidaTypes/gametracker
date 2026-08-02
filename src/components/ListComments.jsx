import React, { useState, useEffect, useRef, useCallback } from 'react'
import { LuSend } from 'react-icons/lu'
import { formatActivityDate } from '../utils/formatActivityDate'
import {
  getListComments,
  postListComment,
  deleteListComment,
} from '../services/listInteractionService'
import { showToast } from './Toast'
import { shouldShowCount } from '../utils/formatSocialCount'
import Avatar from './Avatar'
import './ListComments.css'

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
      <Avatar user={user} size="sm" className="lc-avatar" />
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

  // No focus handler here on purpose. The composer is a normal in-flow
  // field inside `.main-content` (the app's single scroll container),
  // which already reserves keyboard clearance globally (see
  // body.keyboard-open .main-content in src/styles/keyboard.css) — the
  // same mechanism the in-flow list-description editor on this page
  // relies on with zero custom JS. Tapping the textarea lets the
  // platform's native "scroll focused input above the keyboard"
  // behavior do the work in lockstep with the keyboard's own show
  // animation. A hand-rolled animated scrollIntoView() here raced that
  // native scroll (and the padding-bottom transition) and produced the
  // "jumps to the top / slides all over" bug — do not reintroduce one.
  const scrollComposerIntoView = useCallback(() => {
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

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
    el.style.height = Math.min(el.scrollHeight, 90) + 'px'
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
    // Keep the just-posted comment (and the composer below it) on screen.
    requestAnimationFrame(scrollComposerIntoView)

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

      {/* In-flow composer — sits in its natural place at the end of the
          thread and scrolls with the page like any other content. It is
          NOT pinned/fixed to the screen and does not follow the user.
          No keyboard-lift wrapper and no focus handler: it relies purely
          on the platform's native "scroll focused input above the
          keyboard" behavior plus the global `.main-content` keyboard
          padding (src/styles/keyboard.css) — the single mechanism that
          already keeps this uniform with the keyboard's own animation. */}
      {currentUserId && (
        <form
          className="lc-composer"
          aria-label="Comment composer"
          onSubmit={handleSubmit}
        >
          <div className="lc-composer__row">
            <textarea
              ref={textareaRef}
              className="lc-composer__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment…"
              maxLength={2000}
              rows={1}
              aria-label="Add a comment"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
            />
            <button
              type="submit"
              className="lc-composer__send"
              disabled={submitting || !draft.trim()}
              aria-label="Post comment"
            >
              <LuSend size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
