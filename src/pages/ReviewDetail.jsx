import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft, LuEllipsis, LuSend } from 'react-icons/lu'
import { HiOutlineFlag, HiHeart, HiOutlineHeart } from 'react-icons/hi'
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
  likeComment,
  unlikeComment,
  getCommentLikeStates,
} from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import './ReviewDetail.css'

/* ============================================================
   Constants
   ============================================================ */

const VISIBLE_REPLIES = 2
const MAX_COMMENT_LEN = 2000

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
 * Group flat comment rows into a threaded array. Replies with a missing
 * parent (stale RT ordering) are hoisted to top level.
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
 * Adapt a raw Supabase review row into the canonical ReviewCard prop shape.
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
      userId: row.user_id,
      username: row.users?.username || row.users?.display_name || 'Anonymous',
      displayName: row.users?.display_name || row.users?.username || '',
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
    hoursPlayed: Number(row.hours_played) || 0,
    likeCount: 0,
    commentCount,
    createdAt: row.created_at,
  }
}

/**
 * Render comment text with the leading @mention highlighted in cobalt.
 * Only the first token of the form `@word` is styled; the rest is plain text.
 */
function CommentBody({ text }) {
  const match = text.match(/^(@\S+)(\s[\s\S]*|$)/)
  if (!match) return <p className="rd-comment__text">{text}</p>
  const [, mention, rest] = match
  return (
    <p className="rd-comment__text">
      <span className="rd-comment__mention">{mention}</span>
      {rest}
    </p>
  )
}

/* ============================================================
   CommentRow
   ============================================================ */

function CommentRow({
  comment,
  isReply,
  isOwn,
  likeState,
  onLike,
  onReply,
  onEdit,
  onDelete,
  onReport,
}) {
  const navigate = useNavigate()
  const [kebabOpen, setKebabOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [localLike, setLocalLike] = useState(likeState || { liked: false, count: 0 })
  const [pulse, setPulse] = useState(false)
  const kebabRef = useRef(null)

  // Keep local like in sync when the parent re-seeds likeState (e.g. on
  // initial load). After first paint we own the optimistic state.
  const seeded = useRef(false)
  useEffect(() => {
    if (!seeded.current && likeState) {
      setLocalLike(likeState)
      seeded.current = true
    }
  }, [likeState])

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

  const authorUsername = comment.users?.username || ''
  const authorUserId = comment.user_id || ''
  const goToAuthor = () => {
    if (authorUsername) navigate(`/user/${encodeURIComponent(authorUsername)}`)
    else if (authorUserId) navigate(`/user/id/${encodeURIComponent(authorUserId)}`)
  }

  const handleLike = async () => {
    const prev = localLike
    const wasLiked = prev.liked
    const next = {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prev.count - 1) : prev.count + 1,
    }
    setLocalLike(next)
    if (!wasLiked) {
      setPulse(true)
      window.setTimeout(() => setPulse(false), 280)
    }
    try {
      await onLike(comment.id, wasLiked)
    } catch {
      setLocalLike(prev)
    }
  }

  const handleSaveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) { showToast('Comment cannot be empty.', 'error'); return }
    if (trimmed === comment.body) { setEditing(false); return }
    setSaving(true)
    try {
      await onEdit(comment.id, trimmed)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const edited =
    comment.updated_at &&
    comment.created_at &&
    new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1500

  const username = displayNameFor(comment.users)
  const avatarUrl = comment.users?.avatar_url || ''

  return (
    <article
      className={`rd-comment${isReply ? ' rd-comment--reply' : ''}`}
      data-comment-id={comment.id}
    >
      <button
        type="button"
        className="rd-comment__avatar-wrap"
        onClick={goToAuthor}
        disabled={!authorUsername && !authorUserId}
        aria-label={authorUsername ? `View ${username}'s profile` : undefined}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="rd-comment__avatar" loading="lazy" />
        ) : (
          <div className="rd-comment__avatar rd-comment__avatar--fallback" aria-hidden="true">
            {username.charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      <div className="rd-comment__body">
        <header className="rd-comment__header">
          <button
            type="button"
            className="rd-comment__name"
            onClick={goToAuthor}
            disabled={!authorUsername && !authorUserId}
          >
            {username}
          </button>
          <span className="rd-comment__time">{timeAgo(comment.created_at)}</span>
          {edited && <span className="rd-comment__edited">· edited</span>}
        </header>

        {editing ? (
          <div className="rd-comment__edit">
            <textarea
              className="rd-modal-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={MAX_COMMENT_LEN}
              aria-label="Edit comment"
              style={{ minHeight: 60 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)',
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--font-size-caption)',
                  fontWeight: 'var(--font-weight-semibold)',
                  cursor: 'pointer',
                }}
                onClick={() => { setDraft(comment.body); setEditing(false) }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rd-modal-post"
                onClick={handleSaveEdit}
                disabled={saving || !draft.trim()}
                style={{ padding: '6px 14px' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <CommentBody text={comment.body} />
        )}

        {!editing && (
          <div className="rd-comment__meta">
            <button
              type="button"
              className={`rd-comment__like-btn${localLike.liked ? ' rd-comment__like-btn--liked' : ''}`}
              onClick={handleLike}
              aria-pressed={localLike.liked}
              aria-label={localLike.liked ? 'Unlike comment' : 'Like comment'}
            >
              <span className={`rd-comment__like-icon${pulse ? ' rd-comment__like-icon--pulse' : ''}`}>
                {localLike.liked ? (
                  <HiHeart size={14} aria-hidden="true" />
                ) : (
                  <HiOutlineHeart size={14} aria-hidden="true" />
                )}
              </span>
              {localLike.count > 0 && localLike.count}
            </button>

            {!isReply && (
              <button
                type="button"
                className="rd-comment__action-btn"
                onClick={() => onReply(comment)}
              >
                Reply
              </button>
            )}

            <div className="rd-comment__kebab" ref={kebabRef}>
              <button
                type="button"
                className="rd-comment__kebab-btn"
                onClick={() => setKebabOpen((v) => !v)}
                aria-label="More options"
                aria-expanded={kebabOpen}
              >
                <LuEllipsis size={16} aria-hidden="true" />
              </button>
              {kebabOpen && (
                <div className="rd-comment__kebab-menu" role="menu">
                  {isOwn ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setKebabOpen(false); setEditing(true) }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rd-comment__kebab-menu-danger"
                        onClick={() => { setKebabOpen(false); onDelete(comment) }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setKebabOpen(false); onReport(comment) }}
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
   ThreadGroup — top-level comment + its collapsible replies
   ============================================================ */

function ThreadGroup({
  comment,
  likeStates,
  currentUserId,
  onLike,
  onReply,
  onEdit,
  onDelete,
  onReport,
}) {
  const [showAll, setShowAll] = useState(false)
  const replies = comment.replies || []

  const hiddenCount = Math.max(0, replies.length - VISIBLE_REPLIES)
  // Show only the LAST N replies until "Show earlier replies" is tapped.
  const visibleReplies =
    showAll || replies.length <= VISIBLE_REPLIES
      ? replies
      : replies.slice(replies.length - VISIBLE_REPLIES)

  return (
    <div className="rd-thread__group">
      <CommentRow
        comment={comment}
        isReply={false}
        isOwn={!!currentUserId && comment.user_id === currentUserId}
        likeState={likeStates.get(comment.id)}
        onLike={onLike}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onReport={onReport}
      />

      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          className="rd-thread__replies-toggle"
          onClick={() => setShowAll(true)}
        >
          Show {hiddenCount} earlier {hiddenCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {visibleReplies.map((r) => (
        <CommentRow
          key={r.id}
          comment={r}
          isReply
          isOwn={!!currentUserId && r.user_id === currentUserId}
          likeState={likeStates.get(r.id)}
          onLike={onLike}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onReport={onReport}
        />
      ))}
    </div>
  )
}

/* ============================================================
   Page
   ============================================================ */

function ReviewDetail() {
  const { id: reviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // ── Review ─────────────────────────────────────────────────
  const [review, setReview] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [reviewMissing, setReviewMissing] = useState(false)

  // ── Comments ────────────────────────────────────────────────
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)

  // ── Comment likes ───────────────────────────────────────────
  const [likeStates, setLikeStates] = useState(new Map())

  // ── Composer state ──────────────────────────────────────────
  const [replyTo, setReplyTo] = useState(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  // ── Refs ────────────────────────────────────────────────────
  /** The textarea inside the inline composer. */
  const inputRef = useRef(null)
  /** The scrollable thread container. */
  const scrollRef = useRef(null)

  // ── Report sheet ────────────────────────────────────────────
  const [reportTarget, setReportTarget] = useState(null)
  const [reportReview, setReportReview] = useState(false)

  const isAuthed = !!user

  /* ── Initial load ─────────────────────────────────────────── */

  useEffect(() => {
    if (!reviewId) return undefined
    let cancelled = false

    setReviewLoading(true)
    setReviewMissing(false)
    getReviewById(reviewId)
      .then((row) => {
        if (cancelled) return
        if (!row) { setReviewMissing(true); setReview(null) }
        else setReview(row)
      })
      .catch(() => { if (!cancelled) setReviewMissing(true) })
      .finally(() => { if (!cancelled) setReviewLoading(false) })

    setCommentsLoading(true)
    getCommentsForReview(reviewId)
      .then((rows) => {
        if (cancelled) return
        setComments(rows)
        const ids = rows.map((c) => c.id)
        getCommentLikeStates(ids, user?.id || null).then((states) => {
          if (!cancelled) setLikeStates(states)
        })
      })
      .catch((err) => {
        console.error('[ReviewDetail] load failed:', err)
        if (!cancelled) setComments([])
      })
      .finally(() => { if (!cancelled) setCommentsLoading(false) })

    return () => { cancelled = true }
  }, [reviewId, user?.id])

  /* ── Realtime subscription ────────────────────────────────────
     INSERTs on review_comments filtered by review_id so that comments
     from other users appear without a refresh. Own optimistic inserts
     are deduped by id. */
  useEffect(() => {
    if (!reviewId) return undefined

    const channel = supabase
      .channel(`rd-comments:${reviewId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'review_comments',
          filter: `review_id=eq.${reviewId}`,
        },
        async (payload) => {
          const row = payload?.new
          if (!row || !row.id) return
          let userRow = null
          try {
            const { data } = await supabase
              .from('users')
              .select('username, display_name, avatar_url')
              .eq('id', row.user_id)
              .maybeSingle()
            userRow = data || null
          } catch { /* soft-fail */ }
          setComments((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev
            return [...prev, { ...row, users: userRow }]
          })
          setLikeStates((prev) => {
            if (prev.has(row.id)) return prev
            const next = new Map(prev)
            next.set(row.id, { liked: false, count: 0 })
            return next
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [reviewId])

  /* ── Auto-grow textarea ───────────────────────────────────── */

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 90)}px`
  }, [draft])

  /* ── Scroll helpers ───────────────────────────────────────── */

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  /* ── Composer focus / blur ────────────────────────────────── */

  const handleComposerFocus = useCallback(() => {
    // Scroll immediately so the newest comments are visible above the composer
    scrollToBottom()
    // Also scroll after the keyboard finishes animating (~300 ms on iOS)
    window.setTimeout(scrollToBottom, 320)
  }, [scrollToBottom])

  /* ── Derived ──────────────────────────────────────────────── */

  const threaded = useMemo(() => threadComments(comments), [comments])
  const commentCount = comments.length

  const reviewCardShape = useMemo(
    () => toReviewCardShape(review, commentCount),
    [review, commentCount]
  )

  /* ── Composer handlers ────────────────────────────────────── */

  /**
   * Focus the inline composer, optionally pre-filled for a reply.
   * Replaces the old "open modal" flow.
   */
  const openComposer = useCallback((parentComment = null) => {
    if (!isAuthed) {
      showToast('Sign in to leave a comment.', 'error')
      return
    }
    setReplyTo(parentComment)
    if (parentComment) {
      const mention = `@${displayNameFor(parentComment.users)} `
      setDraft((prev) => {
        if (prev.startsWith(mention)) return prev
        const stripped = prev.replace(/^@\S+\s*/, '')
        return mention + stripped
      })
    } else {
      setDraft((prev) => prev.replace(/^@\S+\s*/, ''))
    }
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [isAuthed])

  /** Cancel reply — clears the @mention prefix and the replyTo state. */
  const cancelReply = useCallback(() => {
    setReplyTo(null)
    setDraft((prev) => prev.replace(/^@\S+\s*/, ''))
  }, [])

  const handlePost = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || posting) return
    setPosting(true)

    const optimisticId = `opt-${Date.now()}`
    const optimistic = {
      id: optimisticId,
      review_id: reviewId,
      user_id: user?.id,
      parent_comment_id: replyTo?.id || null,
      body: trimmed,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      users: {
        username: user?.user_metadata?.username || '',
        display_name: user?.user_metadata?.display_name || '',
        avatar_url: user?.user_metadata?.avatar_url || '',
      },
    }

    // Optimistic append
    setComments((prev) => [...prev, optimistic])
    setLikeStates((prev) => {
      const next = new Map(prev)
      next.set(optimisticId, { liked: false, count: 0 })
      return next
    })

    // Clear input immediately; keep focus for continued typing
    setDraft('')
    setReplyTo(null)
    // Scroll to the new optimistic comment
    scrollToBottom()

    // Restore focus after the React state flush
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    try {
      const inserted = await postComment({
        reviewId,
        body: trimmed,
        parentCommentId: replyTo?.id || null,
      })
      // Swap optimistic row for the real one
      setComments((prev) =>
        prev.map((c) => (c.id === optimisticId ? inserted : c))
      )
      setLikeStates((prev) => {
        const next = new Map(prev)
        next.delete(optimisticId)
        next.set(inserted.id, { liked: false, count: 0 })
        return next
      })
      scrollToBottom()
    } catch (err) {
      console.error('[ReviewDetail] postComment failed:', err)
      // Roll back optimistic row
      setComments((prev) => prev.filter((c) => c.id !== optimisticId))
      setLikeStates((prev) => {
        const next = new Map(prev)
        next.delete(optimisticId)
        return next
      })
      showToast(
        err?.message || "Couldn't post your comment. Please try again.",
        'error'
      )
    } finally {
      setPosting(false)
    }
  }, [draft, posting, reviewId, replyTo, user, scrollToBottom])

  /** Enter sends; Shift+Enter inserts a newline. */
  const handleComposerKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handlePost()
    }
  }, [handlePost])

  /* ── Comment like handler ─────────────────────────────────── */

  const handleCommentLike = useCallback(async (commentId, wasLiked) => {
    try {
      if (wasLiked) await unlikeComment(commentId)
      else await likeComment(commentId)
    } catch (err) {
      showToast(
        wasLiked
          ? "Couldn't unlike — please try again."
          : "Couldn't like — please try again.",
        'error'
      )
      throw err
    }
  }, [])

  /* ── Edit / delete handlers ───────────────────────────────── */

  const handleEdit = useCallback(async (commentId, body) => {
    try {
      const updated = await updateComment(commentId, body)
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, ...updated, users: updated.users || c.users }
            : c
        )
      )
    } catch (err) {
      console.error('[ReviewDetail] updateComment failed:', err)
      showToast(
        err?.message || "Couldn't update your comment. Please try again.",
        'error'
      )
      throw err
    }
  }, [])

  const handleDelete = useCallback(async (comment) => {
    const ok = window.confirm('Delete this comment?')
    if (!ok) return
    const removeIds = new Set([comment.id])
    for (const c of comments) {
      if (c.parent_comment_id === comment.id) removeIds.add(c.id)
    }
    const prevComments = comments
    setComments((prev) => prev.filter((c) => !removeIds.has(c.id)))
    try {
      await deleteComment(comment.id)
    } catch (err) {
      console.error('[ReviewDetail] deleteComment failed:', err)
      setComments(prevComments)
      showToast(
        err?.message || "Couldn't delete your comment. Please try again.",
        'error'
      )
    }
  }, [comments])

  const handleReport = useCallback((comment) => {
    setReportTarget(comment)
  }, [])

  /* ── Current user avatar for the composer bar ─────────────── */

  const currentAvatarUrl = user?.user_metadata?.avatar_url || ''
  const currentDisplayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.username ||
    ''

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="rd-page">
      {/* ── Fixed header ─────────────────────────── */}
      <header className="rd-header">
        <button
          type="button"
          className="rd-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="rd-header__title">Review</h1>
        <button
          type="button"
          className="rd-header__menu"
          onClick={() => setReportReview(true)}
          aria-label="More options"
        >
          <LuEllipsis size={20} aria-hidden="true" />
        </button>
      </header>

      {/* ── Scrollable thread ────────────────────── */}
      <div className="rd-scroll" ref={scrollRef}>
        {/* Review block */}
        <div className="rd-review-wrap">
          {reviewLoading ? (
            <div className="rd-review-skel" aria-hidden="true">
              <div className="rd-review-skel__cover-row">
                <div className="skeleton rd-review-skel__cover" />
                <div className="rd-review-skel__lines">
                  <div className="skeleton rd-review-skel__line" style={{ width: '60%' }} />
                  <div className="skeleton rd-review-skel__line" style={{ width: '40%' }} />
                </div>
              </div>
              <div className="skeleton rd-review-skel__line" style={{ width: '90%' }} />
              <div className="skeleton rd-review-skel__line" style={{ width: '80%' }} />
              <div className="skeleton rd-review-skel__line" style={{ width: '70%' }} />
            </div>
          ) : reviewMissing || !reviewCardShape ? (
            <div className="rd-review-missing">
              This review is no longer available.
            </div>
          ) : (
            <ReviewCard
              review={reviewCardShape}
              variant="detail"
            />
          )}
        </div>

        {/* Comments section */}
        <section className="rd-thread" aria-label="Comments">
          <div className="rd-thread__divider">
            <span className="rd-thread__divider-label">Comments</span>
            {!commentsLoading && (
              <span className="rd-thread__divider-count" aria-live="polite">
                {commentCount}
              </span>
            )}
            <div className="rd-thread__divider-line" aria-hidden="true" />
          </div>

          {commentsLoading ? (
            <div className="rd-thread__loading" aria-hidden="true">
              <div className="skeleton rd-thread__line" style={{ width: '70%' }} />
              <div className="skeleton rd-thread__line" style={{ width: '85%' }} />
              <div className="skeleton rd-thread__line" style={{ width: '60%' }} />
            </div>
          ) : threaded.length === 0 ? (
            <div className="rd-thread__empty" role="status">
              No comments yet — start the conversation.
            </div>
          ) : (
            threaded.map((c) => (
              <ThreadGroup
                key={c.id}
                comment={c}
                likeStates={likeStates}
                currentUserId={user?.id}
                onLike={handleCommentLike}
                onReply={openComposer}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onReport={handleReport}
              />
            ))
          )}
        </section>
      </div>

      {/* ── Inline keyboard-attached composer ────── */}
      {/*
       * In-flow last child of .rd-page (position:fixed, rides keyboard).
       * --keyboard-inset (written by main.jsx) already includes the 44 px
       * iOS "Done" accessory bar, so this bar sits flush on the Done bar's
       * top edge.  No custom offset or suppression of setAccessoryBarVisible.
       */}
      <div className="rd-composer" aria-label="Comment composer">
        {replyTo && (
          <div className="rd-composer__reply-hint">
            <span>
              Replying to{' '}
              <strong className="rd-composer__reply-name">
                {displayNameFor(replyTo.users)}
              </strong>
            </span>
            <button
              type="button"
              className="rd-composer__reply-cancel"
              onClick={cancelReply}
              aria-label="Cancel reply"
            >
              ×
            </button>
          </div>
        )}

        <div className="rd-composer__row">
          {/* Current-user avatar */}
          {currentAvatarUrl ? (
            <img
              src={currentAvatarUrl}
              alt=""
              className="rd-composer__avatar"
              loading="lazy"
            />
          ) : (
            <div
              className="rd-composer__avatar rd-composer__avatar--fallback"
              aria-hidden="true"
            >
              {currentDisplayName.charAt(0).toUpperCase() || '?'}
            </div>
          )}

          {/* Auto-growing textarea */}
          <textarea
            ref={inputRef}
            className="rd-composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={handleComposerFocus}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              replyTo
                ? `Reply to ${displayNameFor(replyTo.users)}…`
                : 'Add a comment…'
            }
            maxLength={MAX_COMMENT_LEN}
            rows={1}
            aria-label={
              replyTo
                ? `Reply to ${displayNameFor(replyTo.users)}`
                : 'Add a comment'
            }
          />

          {/* Send button — always visible; dims when empty */}
          <button
            type="button"
            className="rd-composer__send"
            onClick={handlePost}
            disabled={!draft.trim() || posting}
            aria-label="Send comment"
          >
            <LuSend size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Report: comment ──────────────────────────── */}
      <ReportSheet
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType="comment"
        contentId={reportTarget?.id}
      />

      {/* ── Report: review ───────────────────────────── */}
      <ReportSheet
        isOpen={reportReview}
        onClose={() => setReportReview(false)}
        contentType="review"
        contentId={reviewId}
      />
    </div>
  )
}

export default ReviewDetail
