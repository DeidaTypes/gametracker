import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft, LuEllipsis } from 'react-icons/lu'
import { HiOutlineFlag } from 'react-icons/hi'
import ReviewCard from '../components/ReviewCard'
import ReportSheet from '../components/ReportSheet'
import { showToast } from '../components/Toast'
import { supabase } from '../services/supabase'
import { getReviewById } from '../services/reviewService'
import {
  getCommentsForReview,
  postComment,
  updateComment,
  deleteComment,
} from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import './ReviewComments.css'

/* ============================================================
   Helpers
   ============================================================ */

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w`
  const months = Math.round(d / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(d / 365)}y`
}

function displayNameFor(user) {
  if (!user) return 'Anonymous'
  return user.display_name || user.username || 'Anonymous'
}

/**
 * Group a flat list of comment rows into a top-level array, each item
 * carrying a `replies` array sorted oldest → newest. Replies with a
 * parent we no longer have (e.g. stale realtime ordering) get hoisted
 * to the top level so they don't disappear.
 */
function threadComments(rows) {
  const topLevel = []
  const repliesByParent = new Map()
  for (const row of rows) {
    if (row.parent_comment_id) {
      const bucket = repliesByParent.get(row.parent_comment_id) || []
      bucket.push(row)
      repliesByParent.set(row.parent_comment_id, bucket)
    } else {
      topLevel.push(row)
    }
  }
  return topLevel.map((c) => ({
    ...c,
    replies: (repliesByParent.get(c.id) || []).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    ),
  }))
}

/**
 * Map a Supabase review row into the canonical ReviewCard prop shape.
 * Mirrors the adapters in TimelineFeed / GameDetail / Profile — we
 * intentionally keep it inline here rather than extracting a shared
 * helper because every consumer has slightly different fallbacks
 * (compact variant, no like prefetch on this page, etc.).
 */
function toReviewCardShape(row, commentCount) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    game: {
      id: String(row.igdb_game_id || ''),
      name: row.game_title || 'Unknown Game',
      coverUrl: row.game_image || '',
      developer: '',
    },
    author: {
      username: row.users?.username || row.users?.display_name || 'Anonymous',
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
    likeCount: 0,
    commentCount,
    createdAt: row.created_at,
  }
}

/* ============================================================
   Comment row
   ============================================================ */

function CommentRow({
  comment,
  isReply,
  isOwn,
  onReply,
  onEdit,
  onDelete,
  onReport,
}) {
  const [kebabOpen, setKebabOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const kebabRef = useRef(null)

  useEffect(() => {
    setDraft(comment.body)
  }, [comment.body])

  useEffect(() => {
    if (!kebabOpen) return undefined
    function handleOutside(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [kebabOpen])

  const handleSaveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      showToast('Comment cannot be empty.', 'error')
      return
    }
    if (trimmed === comment.body) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onEdit(comment.id, trimmed)
      setEditing(false)
    } catch (err) {
      // Toast surfaced by parent — keep the editor open so the user
      // can retry without retyping.
    } finally {
      setSaving(false)
    }
  }

  const edited =
    comment.updated_at &&
    comment.created_at &&
    new Date(comment.updated_at).getTime() -
      new Date(comment.created_at).getTime() >
      1500

  const username = displayNameFor(comment.users)
  const avatarUrl = comment.users?.avatar_url || ''

  return (
    <article
      className={`rc-comment${isReply ? ' rc-comment--reply' : ''}`}
      data-comment-id={comment.id}
    >
      <div className="rc-comment__avatar-wrap">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="rc-comment__avatar"
            loading="lazy"
          />
        ) : (
          <div className="rc-comment__avatar rc-comment__avatar--fallback" aria-hidden="true">
            {username.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="rc-comment__body">
        <header className="rc-comment__header">
          <span className="rc-comment__name">{username}</span>
          <span className="rc-comment__time">{timeAgo(comment.created_at)}</span>
          {edited && (
            <span className="rc-comment__edited" title="Edited">
              · edited
            </span>
          )}
        </header>

        {editing ? (
          <div className="rc-comment__edit">
            <textarea
              className="rc-comment__edit-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              aria-label="Edit comment"
            />
            <div className="rc-comment__edit-actions">
              <button
                type="button"
                className="rc-comment__edit-btn rc-comment__edit-btn--ghost"
                onClick={() => {
                  setDraft(comment.body)
                  setEditing(false)
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rc-comment__edit-btn rc-comment__edit-btn--primary"
                onClick={handleSaveEdit}
                disabled={saving || !draft.trim()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <p className="rc-comment__text">{comment.body}</p>
        )}

        {!editing && (
          <div className="rc-comment__actions">
            {/* Only top-level comments get a Reply button — replies
                cannot have their own replies. */}
            {!isReply && (
              <button
                type="button"
                className="rc-comment__action"
                onClick={() => onReply(comment)}
              >
                Reply
              </button>
            )}
            <div className="rc-comment__kebab" ref={kebabRef}>
              <button
                type="button"
                className="rc-comment__kebab-btn"
                onClick={() => setKebabOpen((v) => !v)}
                aria-label="More options"
                aria-expanded={kebabOpen}
              >
                <LuEllipsis size={16} aria-hidden="true" />
              </button>
              {kebabOpen && (
                <div className="rc-comment__kebab-menu" role="menu">
                  {isOwn && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setKebabOpen(false)
                          setEditing(true)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rc-comment__kebab-menu-danger"
                        onClick={() => {
                          setKebabOpen(false)
                          onDelete(comment)
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {!isOwn && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setKebabOpen(false)
                        onReport(comment)
                      }}
                    >
                      <HiOutlineFlag size={14} aria-hidden="true" />
                      Report
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/* ============================================================
   Page
   ============================================================ */

function ReviewComments() {
  const { reviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [review, setReview] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [reviewMissing, setReviewMissing] = useState(false)

  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)

  // Composer state. `replyTo` holds the parent comment object (not just
  // the id) so we can prepend "@displayName " on focus AND pass the
  // parent's id to postComment without a second lookup.
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [posting, setPosting] = useState(false)
  const composerInputRef = useRef(null)

  // Report sheet
  const [reportTarget, setReportTarget] = useState(null)

  const isAuthed = !!user

  /* ── Initial load ────────────────────────────────────────────── */

  useEffect(() => {
    if (!reviewId) return undefined
    let cancelled = false

    setReviewLoading(true)
    setReviewMissing(false)
    getReviewById(reviewId)
      .then((row) => {
        if (cancelled) return
        if (!row) {
          setReviewMissing(true)
          setReview(null)
        } else {
          setReview(row)
        }
      })
      .catch(() => {
        if (!cancelled) setReviewMissing(true)
      })
      .finally(() => {
        if (!cancelled) setReviewLoading(false)
      })

    setCommentsLoading(true)
    getCommentsForReview(reviewId)
      .then((rows) => {
        if (cancelled) return
        setComments(rows)
      })
      .catch((err) => {
        console.error('[ReviewComments] load failed:', err)
        if (!cancelled) setComments([])
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reviewId])

  /* ── Realtime subscription ──────────────────────────────────────
     INSERT events on the comments table, filtered by review_id, are
     pushed into local state so other users' comments appear without a
     refresh. We dedupe by id because the optimistic insert we did on
     our own submit may beat the realtime echo back. */
  useEffect(() => {
    if (!reviewId) return undefined

    const channel = supabase
      .channel(`comments:${reviewId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comments',
          filter: `review_id=eq.${reviewId}`,
        },
        async (payload) => {
          const row = payload?.new
          if (!row || !row.id) return
          // The realtime payload doesn't include the joined users row,
          // so fetch the author so the avatar + name render properly.
          let userRow = null
          try {
            const { data } = await supabase
              .from('users')
              .select('username, display_name, avatar_url')
              .eq('id', row.user_id)
              .maybeSingle()
            userRow = data || null
          } catch {
            // Soft-fail — author panel will show "Anonymous" until the
            // next full reload, which is a perfectly acceptable
            // degradation.
          }
          setComments((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev
            return [...prev, { ...row, users: userRow }]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [reviewId])

  /* ── Threaded view model ────────────────────────────────────── */

  const threaded = useMemo(() => threadComments(comments), [comments])
  const commentCount = comments.length

  const reviewCardShape = useMemo(
    () => toReviewCardShape(review, commentCount),
    [review, commentCount]
  )

  /* ── Composer ───────────────────────────────────────────────── */

  const focusComposer = useCallback(() => {
    const el = composerInputRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      // Some browsers throw on non-text inputs; ignore.
    }
  }, [])

  const handleReplyClick = useCallback(
    (parent) => {
      setReplyTo(parent)
      const name = displayNameFor(parent.users)
      const mention = `@${name} `
      setDraft((prev) => {
        // Avoid stacking mentions if the user taps Reply twice in a row.
        if (prev.startsWith(mention)) return prev
        // If the user was previously replying to someone else, swap
        // their mention prefix out.
        const stripped = prev.replace(/^@\S+\s*/, '')
        return mention + stripped
      })
      // Defer focus to next tick so the prefix paints first.
      window.requestAnimationFrame(focusComposer)
    },
    [focusComposer]
  )

  const handleCancelReply = useCallback(() => {
    setReplyTo(null)
    setDraft((prev) => prev.replace(/^@\S+\s*/, ''))
  }, [])

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!isAuthed) {
      showToast('Sign in to leave a comment.', 'error')
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) return
    if (posting) return

    setPosting(true)
    try {
      const inserted = await postComment({
        reviewId,
        body: trimmed,
        parentCommentId: replyTo?.id || null,
      })
      // Optimistically append — the realtime echo will be deduped by id.
      setComments((prev) => {
        if (prev.some((c) => c.id === inserted.id)) return prev
        return [...prev, inserted]
      })
      setDraft('')
      setReplyTo(null)
    } catch (err) {
      console.error('[ReviewComments] postComment failed:', err)
      showToast(
        err?.message || "Couldn't post your comment. Please try again.",
        'error'
      )
    } finally {
      setPosting(false)
    }
  }

  const handleEdit = useCallback(async (commentId, body) => {
    try {
      const updated = await updateComment(commentId, body)
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? // Preserve the joined users row when the API didn't return one.
              { ...c, ...updated, users: updated.users || c.users }
            : c
        )
      )
    } catch (err) {
      console.error('[ReviewComments] updateComment failed:', err)
      showToast(
        err?.message || "Couldn't update your comment. Please try again.",
        'error'
      )
      throw err
    }
  }, [])

  const handleReport = useCallback((comment) => {
    setReportTarget(comment)
  }, [])

  const handleDelete = useCallback(async (comment) => {
    // Window.confirm is fine here — every delete confirm in the app
    // (DeleteConfirmModal) is bound to a specific surface and rebuilding
    // it for comments would be overkill. Mobile UI still shows the
    // native iOS prompt via Capacitor's web bridge.
    const ok = window.confirm('Delete this comment?')
    if (!ok) return
    // Optimistic removal — drop the comment and any of its replies
    // (one level only).
    const removeIds = new Set([comment.id])
    for (const c of comments) {
      if (c.parent_comment_id === comment.id) removeIds.add(c.id)
    }
    const prevComments = comments
    setComments((prev) => prev.filter((c) => !removeIds.has(c.id)))
    try {
      await deleteComment(comment.id)
    } catch (err) {
      console.error('[ReviewComments] deleteComment failed:', err)
      setComments(prevComments)
      showToast(
        err?.message || "Couldn't delete your comment. Please try again.",
        'error'
      )
    }
  }, [comments])

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="rc-page">
      <header className="rc-header">
        <button
          type="button"
          className="rc-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="rc-header__titles">
          <h1 className="rc-title">Comments</h1>
          <span className="rc-count" aria-live="polite">
            {commentsLoading ? '…' : commentCount}
          </span>
        </div>
        <span className="rc-header__spacer" aria-hidden="true" />
      </header>

      <div className="rc-scroll">
        <div className="rc-review-wrap">
          {reviewLoading ? (
            <div className="rc-review-skel" aria-hidden="true">
              <div className="skeleton rc-review-skel__cover" />
              <div className="rc-review-skel__lines">
                <div className="skeleton rc-review-skel__line" style={{ width: '60%' }} />
                <div className="skeleton rc-review-skel__line" style={{ width: '90%' }} />
                <div className="skeleton rc-review-skel__line" style={{ width: '80%' }} />
              </div>
            </div>
          ) : reviewMissing || !reviewCardShape ? (
            <div className="rc-review-missing">
              This review is no longer available.
            </div>
          ) : (
            <ReviewCard review={reviewCardShape} variant="compact" />
          )}
        </div>

        <section className="rc-thread" aria-label="Comments">
          {commentsLoading ? (
            <div className="rc-thread__loading" aria-hidden="true">
              <div className="skeleton rc-thread__line" style={{ width: '70%' }} />
              <div className="skeleton rc-thread__line" style={{ width: '85%' }} />
              <div className="skeleton rc-thread__line" style={{ width: '60%' }} />
            </div>
          ) : threaded.length === 0 ? (
            <div className="rc-thread__empty">
              No comments yet — be the first to start the conversation.
            </div>
          ) : (
              threaded.map((c) => (
              <div key={c.id} className="rc-thread__group">
                <CommentRow
                  comment={c}
                  isReply={false}
                  isOwn={!!user && c.user_id === user.id}
                  onReply={handleReplyClick}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onReport={handleReport}
                />
                {c.replies.map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    isReply
                    isOwn={!!user && r.user_id === user.id}
                    onReply={handleReplyClick}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onReport={handleReport}
                  />
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      <ReportSheet
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType="comment"
        contentId={reportTarget?.id}
      />

      <form className="rc-composer" onSubmit={handleSubmit}>
        {replyTo && (
          <div className="rc-composer__reply-chip">
            <span>
              Replying to <strong>{displayNameFor(replyTo.users)}</strong>
            </span>
            <button
              type="button"
              className="rc-composer__reply-cancel"
              onClick={handleCancelReply}
              aria-label="Cancel reply"
            >
              ×
            </button>
          </div>
        )}
        <div className="rc-composer__row">
          <textarea
            ref={composerInputRef}
            className="rc-composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isAuthed ? 'Add a comment…' : 'Sign in to leave a comment'
            }
            rows={1}
            maxLength={2000}
            disabled={!isAuthed || posting}
            aria-label="Comment text"
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter sends — matches the convention in most
              // chat apps and avoids accidental sends on mobile.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleSubmit(e)
              }
            }}
          />
          <button
            type="submit"
            className="rc-composer__send"
            disabled={!isAuthed || posting || !draft.trim()}
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ReviewComments
