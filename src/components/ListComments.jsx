import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
import { hapticSuccess } from '../utils/haptics'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import Avatar from './Avatar'
import KeyboardAwareView from './KeyboardAwareView'
import ReservedSlot from './ReservedSlot'
import { ugcErrorMessage } from '../services/moderationService'
import './forms/forms.css'
import './ListComments.css'

function CommentSkeleton() {
  return (
    <div className="lc-comment" aria-hidden="true">
      <span className="skeleton lc-skel-avatar" />
      <div className="lc-comment-content">
        <div className="lc-comment-header">
          <span className="lc-comment-author">&nbsp;</span>
        </div>
        <p className="lc-comment-body">&nbsp;</p>
      </div>
    </div>
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
export default function ListComments({ listId, currentUserId, isOwner, onUnsentChange }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [composerError, setComposerError] = useState(null)
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
  // src/hooks/useAutoGrowTextarea.js). Cap matches .composer__input's
  // max-height in styles/keyboard.css.
  useAutoGrowTextarea(textareaRef, draft, 90)

  useEffect(() => {
    onUnsentChange?.(draft.trim().length > 0)
  }, [draft, onUnsentChange])

  useEffect(() => () => onUnsentChange?.(false), [onUnsentChange])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || submitting) return

    hapticSuccess()
    setSubmitting(true)
    setComposerError(null)

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
      const blocked = ugcErrorMessage(err)
      if (blocked) {
        setDraft((current) => current || trimmed)
        setComposerError(blocked)
      } else {
        showToast(err.message || "Couldn't post comment. Please try again.", 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const composerBar =
    currentUserId ? (
      <KeyboardAwareView
        as="form"
        mode="composer"
        className="kb-composer-bar composer-bar lc-composer-bar"
        aria-label="Comment composer"
        onSubmit={handleSubmit}
      >
        {composerError && (
          <p className="composer__error form-field__error" role="alert">{composerError}</p>
        )}
        <div className="composer__row">
          <div className="composer__shell">
            <textarea
              ref={textareaRef}
              className="composer__input"
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
              className="composer__send"
              disabled={submitting || !draft.trim()}
              aria-label="Post comment"
            >
              <LuSend size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </KeyboardAwareView>
    ) : null

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

      <ReservedSlot open={loading || comments.length > 0}>
        <div className="lc-list">
          {loading || comments.length === 0
            ? Array.from({ length: 3 }, (_, i) => <CommentSkeleton key={i} />)
            : comments.map((c) => (
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
      </ReservedSlot>

      {/* Sentinel: scrolled into view after posting and once the keyboard
          has settled on focus, so the thread stays visible above the
          pinned composer below. */}
      <div ref={listBottomRef} aria-hidden="true" />

      {/* Viewport-anchored composer — portaled to body so position:fixed is not
          re-parented by PageTransition's motion wrapper on this tall page
          (see bb2a57a). Keyboard lift + shared chrome match Review Detail. */}
      {composerBar && createPortal(composerBar, document.body)}
    </section>
  )
}
