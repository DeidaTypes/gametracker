import React, { useState, useEffect, useRef, useCallback } from 'react'
import { LuSend } from 'react-icons/lu'
import { formatActivityDate } from '../utils/formatActivityDate'
import {
  getListComments,
  postListComment,
  deleteListComment,
} from '../services/listInteractionService'
import { whenKeyboardSettled } from '../services/keyboardInset'
import { showToast } from './Toast'
import { shouldShowCount } from '../utils/formatSocialCount'
import { hapticImpact } from '../utils/haptics'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import Avatar from './Avatar'
import KeyboardAwareView from './KeyboardAwareView'
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
  // Sentinel just past the last comment — scrolled into view after posting
  // and once the keyboard has settled on focus, so the thread (not the
  // composer, which is now pinned via .kb-composer-bar/.kb-lift and always
  // on screen) stays visible above the raised bar. Same pattern as
  // ReviewComments'/ReviewDetail's threadBottomRef.
  const listBottomRef = useRef(null)

  const scrollListIntoView = useCallback(() => {
    listBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  const handleComposerFocus = useCallback(() => {
    whenKeyboardSettled(scrollListIntoView)
  }, [scrollListIntoView])

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

  // Auto-grow textarea — shared with Review Detail / Review Comments so the
  // grow-then-cap behavior can never drift between composers (see
  // src/hooks/useAutoGrowTextarea.js). Cap matches .lc-composer__input's
  // max-height in ListComments.css.
  useAutoGrowTextarea(textareaRef, draft, 90)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || submitting) return

    hapticImpact('Medium')
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
    // Keep the just-posted comment visible above the pinned composer.
    requestAnimationFrame(scrollListIntoView)

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

      {/* Sentinel: scrolled into view after posting and once the keyboard
          has settled on focus, so the thread stays visible above the
          pinned composer below. */}
      <div ref={listBottomRef} aria-hidden="true" />

      {/* Viewport-anchored composer — shares its rest position/chrome with
          every other comment screen via .kb-composer-bar, and its keyboard
          lift via <KeyboardAwareView mode="composer"> (.kb-lift), exactly
          like ReviewComments/ReviewDetail. It never scrolls with the page;
          .lc-section's own bottom padding (ListComments.css) reserves the
          clearance this bar needs so it never covers the last comment. */}
      {currentUserId && (
        <KeyboardAwareView
          as="form"
          mode="composer"
          className="kb-composer-bar lc-composer"
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
              onFocus={handleComposerFocus}
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
              <LuSend size={18} aria-hidden="true" />
            </button>
          </div>
        </KeyboardAwareView>
      )}
    </section>
  )
}
