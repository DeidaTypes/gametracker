import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuCheck, LuChevronLeft, LuEllipsis, LuSend } from 'react-icons/lu'
import { HiOutlineFlag } from 'react-icons/hi'
import ReviewCard from '../components/ReviewCard'
import HomeReviewCard from '../components/home/HomeReviewCard'
import Reactions from '../components/Reactions'
import ReportSheet from '../components/ReportSheet'
import { showToast } from '../components/Toast'
import { supabase } from '../services/supabase'
import { shouldShowCount } from '../utils/formatSocialCount'
import { getReviewById } from '../services/reviewService'
import { getActivityEventForCard } from '../services/communityService'
import {
  getCommentsForReview,
  getCommentsForActivityEvent,
  postComment,
  updateComment,
  deleteComment,
} from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import { bumpCommentsCount } from '../hooks/useUserStats'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'
import { whenKeyboardSettled } from '../services/keyboardInset'
import { useHideNav } from '../hooks/useHideNav'
import KeyboardAwareView from '../components/KeyboardAwareView'
import Avatar from '../components/Avatar'
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
    hoursPlayed: Number(row.hours_played) || 0,
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
    likeCount: 0,
    commentCount,
    createdAt: row.created_at,
  }
}

/* ── Spoiler parsing ────────────────────────────────────────────────── */

function parseForSpoilers(text) {
  const parts = []
  const re = /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi
  let lastIdx = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ type: 'text', content: text.slice(lastIdx, m.index) })
    parts.push({ type: 'spoiler', content: m[1] })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) parts.push({ type: 'text', content: text.slice(lastIdx) })
  return parts
}

function SpoilerSegment({ text }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <button
      type="button"
      className={`rc-comment__spoiler${revealed ? ' rc-comment__spoiler--revealed' : ''}`}
      onClick={() => !revealed && setRevealed(true)}
      aria-label={revealed ? undefined : 'Tap to reveal spoiler'}
    >
      {text}
    </button>
  )
}

function CommentBody({ text }) {
  const segments = parseForSpoilers(text)
  const hasSpoilers = segments.some((s) => s.type === 'spoiler')

  if (!hasSpoilers) {
    const match = text.match(/^(@\S+)(\s[\s\S]*|$)/)
    if (!match) return <p className="rc-comment__text">{text}</p>
    const [, mention, rest] = match
    return (
      <p className="rc-comment__text">
        <span className="rc-comment__mention">{mention}</span>
        {rest}
      </p>
    )
  }

  return (
    <p className="rc-comment__text">
      {segments.map((seg, i) => {
        if (seg.type === 'spoiler') {
          return <SpoilerSegment key={i} text={seg.content} />
        }
        if (i === 0) {
          const mm = seg.content.match(/^(@\S+)(\s[\s\S]*|$)/)
          if (mm) {
            return (
              <React.Fragment key={i}>
                <span className="rc-comment__mention">{mm[1]}</span>
                {mm[2]}
              </React.Fragment>
            )
          }
        }
        return <React.Fragment key={i}>{seg.content}</React.Fragment>
      })}
    </p>
  )
}

/* ============================================================
   Comment row
   ============================================================ */

function CommentRow({
  comment,
  isReply,
  isOwn,
  isEditing,
  onReply,
  onEditStart,
  onDelete,
  onReport,
}) {
  const navigate = useNavigate()
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef(null)

  // Tapping a commenter's avatar or name opens their profile. Prefer
  // username route; fall back to /user/id/:userId for users without a handle.
  const authorUsername = comment.users?.username || ''
  const authorUserId = comment.user_id || ''
  const openAuthorProfile = () => {
    if (authorUsername) {
      navigate(`/user/${encodeURIComponent(authorUsername)}`)
    } else if (authorUserId) {
      navigate(`/user/id/${encodeURIComponent(authorUserId)}`)
    }
  }

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
      className={`rc-comment${isReply ? ' rc-comment--reply' : ''}${isEditing ? ' rc-comment--editing' : ''}`}
      data-comment-id={comment.id}
    >
      <button
        type="button"
        className="rc-comment__avatar-wrap"
        onClick={openAuthorProfile}
        disabled={!authorUsername}
        aria-label={authorUsername ? `View ${username}'s profile` : undefined}
      >
        <Avatar
          avatarUrl={avatarUrl}
          name={username}
          seed={comment.users?.id}
          size="sm"
          className="rc-comment__avatar"
        />
      </button>

      <div className="rc-comment__body">
        <header className="rc-comment__header">
          <button
            type="button"
            className="rc-comment__name"
            onClick={openAuthorProfile}
            disabled={!authorUsername}
          >
            {username}
          </button>
          <span className="rc-comment__time">{timeAgo(comment.created_at)}</span>
          {edited && (
            <span className="rc-comment__edited" title="Edited">
              · edited
            </span>
          )}
        </header>

        <CommentBody text={comment.body} />

        <Reactions
          targetType="comment"
          targetId={comment.id}
          className="rc-comment__reactions"
        />

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
                        onEditStart(comment)
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
      </div>
    </article>
  )
}

/* ============================================================
   Page
   ============================================================ */

function ReviewComments() {
  // This page also powers the Pulse-broadening activity thread at
  // /activity/:activityId/comments — same composer/thread UI, just
  // keyed to whichever target the route carries (never both). See
  // commentService.js's polymorphic review_comments contract.
  const { reviewId, activityId } = useParams()
  const targetType = reviewId ? 'review' : 'activity'
  const targetId = reviewId || activityId
  const navigate = useNavigate()
  const { user } = useAuth()

  // This screen always has a comment composer (pinned or disabled while
  // signed out) — the bottom nav is hidden for the whole lifetime of the
  // screen, not just while the composer is focused, and restored on
  // unmount. See src/hooks/useHideNav.js.
  useHideNav()

  const [review, setReview] = useState(null)
  const [activityItem, setActivityItem] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [reviewMissing, setReviewMissing] = useState(false)

  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)

  // Bumped on app resume so the realtime effect below tears down the dead
  // (post-suspend) channel and re-subscribes onto a fresh socket — same
  // pattern as UnreadMessagesContext / NotificationsContext.
  const [resumeKey, setResumeKey] = useState(0)

  // Composer state. `replyTo` holds the parent comment object (not just
  // the id) so we can prepend "@displayName " on focus AND pass the
  // parent's id to postComment without a second lookup.
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  // `editingComment` is the full comment object being edited via the
  // pinned composer, or null when in normal add-a-comment mode.
  const [editingComment, setEditingComment] = useState(null)
  const [posting, setPosting] = useState(false)
  const composerInputRef = useRef(null)
  // Keep a ref in sync with editingComment so handleComposerFocus can
  // read the current value without being a stale closure.
  const editingCommentRef = useRef(null)
  // Sentinel at the bottom of the thread list — scrolled into view when
  // the keyboard opens (see handleComposerFocus). `.rc-scroll` itself is
  // no longer a scroll container (`.main-content` is), so there's no ref
  // needed on the body element itself.
  const threadBottomRef = useRef(null)

  // Report sheet
  const [reportTarget, setReportTarget] = useState(null)

  const isAuthed = !!user

  // Keep ref in sync so handleComposerFocus sees the latest value.
  useEffect(() => {
    editingCommentRef.current = editingComment
  }, [editingComment])

  /* ── Load ────────────────────────────────────────────────────── */

  /** Discards responses from a load that a newer one has superseded. */
  const loadGenerationRef = useRef(0)

  /**
   * @param {{ silent?: boolean }} [opts] `silent` leaves the loading flags
   *   alone, so a resume revalidation swaps the thread in underneath the user
   *   instead of flashing skeletons over content already on screen.
   */
  const loadThread = useCallback(
    ({ silent = false } = {}) => {
      if (!targetId) return
      const generation = ++loadGenerationRef.current
      const isStale = () => generation !== loadGenerationRef.current

      if (!silent) {
        setReviewLoading(true)
        setReviewMissing(false)
      }
      const headerFetch =
        targetType === 'review' ? getReviewById(targetId) : getActivityEventForCard(targetId)
      headerFetch
        .then((row) => {
          if (isStale()) return
          if (!row) {
            setReviewMissing(true)
            setReview(null)
            setActivityItem(null)
          } else if (targetType === 'review') {
            setReview(row)
          } else {
            setActivityItem(row)
          }
        })
        .catch(() => {
          if (!isStale()) setReviewMissing(true)
        })
        .finally(() => {
          if (!isStale()) setReviewLoading(false)
        })

      if (!silent) setCommentsLoading(true)
      const commentsFetch =
        targetType === 'review'
          ? getCommentsForReview(targetId)
          : getCommentsForActivityEvent(targetId)
      commentsFetch
        .then((rows) => {
          if (isStale()) return
          setComments(rows)
        })
        .catch((err) => {
          console.error('[ReviewComments] load failed:', err)
          if (!isStale()) setComments([])
        })
        .finally(() => {
          if (!isStale()) setCommentsLoading(false)
        })
    },
    [targetId, targetType]
  )

  useEffect(() => {
    loadThread()
  }, [loadThread])

  /* ── Resume revalidation ──────────────────────────────────────
     The realtime subscription below only carries INSERTs, and it was dead
     while the app was suspended anyway — so edits, deletes, and comments
     posted in the meantime are only picked up by refetching here. */
  useEffect(() => {
    const onResume = () => {
      setResumeKey((k) => k + 1)
      loadThread({ silent: true })
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [loadThread])

  /* ── Realtime subscription ──────────────────────────────────────
     INSERT events on review_comments, filtered by whichever target
     column this thread is keyed to, are pushed into local state so
     other users' comments appear without a refresh. We dedupe by id
     because the optimistic insert we did on our own submit may beat
     the realtime echo back. */
  useEffect(() => {
    if (!targetId) return undefined
    const filterColumn = targetType === 'review' ? 'review_id' : 'activity_event_id'

    const channel = supabase
      .channel(`review_comments:${targetType}:${targetId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'review_comments',
          filter: `${filterColumn}=eq.${targetId}`,
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

    const disposeSubscribe = subscribeWithRecovery(channel)

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
  }, [targetId, targetType, resumeKey])

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
      // Exit edit mode if the user switches to a reply instead.
      setEditingComment(null)
      setReplyTo(parent)
      const name = displayNameFor(parent.users)
      const mention = `@${name} `
      setDraft((prev) => {
        if (prev.startsWith(mention)) return prev
        const stripped = prev.replace(/^@\S+\s*/, '')
        return mention + stripped
      })
      window.requestAnimationFrame(focusComposer)
    },
    [focusComposer]
  )

  const handleCancelReply = useCallback(() => {
    setReplyTo(null)
    setDraft((prev) => prev.replace(/^@\S+\s*/, ''))
  }, [])

  // When the textarea gains focus the keyboard slides in. Once it has
  // actually settled we either scroll the comment being edited into view
  // (edit mode) or scroll the bottom sentinel into view (normal mode).
  // `.rc-scroll` no longer owns its own scroll (see ReviewComments.css) —
  // `.main-content` is the real scroll container, so we scroll via
  // scrollIntoView() rather than setting scrollTop directly on a ref.
  const handleComposerFocus = useCallback(() => {
    whenKeyboardSettled(() => {
      const editing = editingCommentRef.current
      if (editing) {
        const el = document.querySelector(`[data-comment-id="${editing.id}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else {
        threadBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })
  }, [])

  // Enter edit mode: pre-fill the pinned composer and focus it.
  const handleEditStart = useCallback(
    (comment) => {
      setReplyTo(null)
      setEditingComment(comment)
      setDraft(comment.body)
      window.requestAnimationFrame(focusComposer)
    },
    [focusComposer]
  )

  // Exit edit mode without saving.
  const handleCancelEdit = useCallback(() => {
    setEditingComment(null)
    setDraft('')
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

    // ── Edit mode: update the existing comment in place ──────────
    if (editingComment) {
      if (trimmed === editingComment.body) {
        // No change — just exit edit mode.
        setEditingComment(null)
        setDraft('')
        return
      }
      setPosting(true)
      try {
        const updated = await updateComment(editingComment.id, trimmed)
        setComments((prev) =>
          prev.map((c) =>
            c.id === editingComment.id
              ? { ...c, ...updated, users: updated.users || c.users }
              : c
          )
        )
        setEditingComment(null)
        setDraft('')
      } catch (err) {
        console.error('[ReviewComments] updateComment failed:', err)
        showToast(
          err?.message || "Couldn't update your comment. Please try again.",
          'error'
        )
      } finally {
        setPosting(false)
      }
      return
    }

    // ── Normal mode: post a new comment ──────────────────────────
    setPosting(true)
    try {
      const inserted = await postComment({
        reviewId: targetType === 'review' ? targetId : null,
        activityEventId: targetType === 'activity' ? targetId : null,
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
      // Increment local Conversationalist badge counter on successful post.
      bumpCommentsCount(1)
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
            {commentsLoading ? '' : shouldShowCount(commentCount) ? commentCount : ''}
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
          ) : targetType === 'review' ? (
            reviewMissing || !reviewCardShape ? (
              <div className="rc-review-missing">
                This review is no longer available.
              </div>
            ) : (
              <ReviewCard review={reviewCardShape} variant="compact" />
            )
          ) : reviewMissing || !activityItem ? (
            <div className="rc-review-missing">
              This activity is no longer available.
            </div>
          ) : (
            <HomeReviewCard item={{ ...activityItem, commentCount }} />
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
                  isEditing={editingComment?.id === c.id}
                  onReply={handleReplyClick}
                  onEditStart={handleEditStart}
                  onDelete={handleDelete}
                  onReport={handleReport}
                />
                {c.replies.map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    isReply
                    isOwn={!!user && r.user_id === user.id}
                    isEditing={editingComment?.id === r.id}
                    onReply={handleReplyClick}
                    onEditStart={handleEditStart}
                    onDelete={handleDelete}
                    onReport={handleReport}
                  />
                ))}
              </div>
            ))
          )}
          {/* Sentinel: scrolled into view after the keyboard opens so the
              last comment stays visible above the raised composer bar. */}
          <div ref={threadBottomRef} aria-hidden="true" />
        </section>
      </div>

      <ReportSheet
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType="comment"
        contentId={reportTarget?.id}
      />

      <KeyboardAwareView
        as="form"
        mode="composer"
        className="rc-composer"
        onSubmit={handleSubmit}
      >
        {/* Edit-mode strip — shown above the composer when editing a comment */}
        {editingComment && (
          <div className="rc-composer__edit-chip">
            <span>Editing comment</span>
            <button
              type="button"
              className="rc-composer__reply-cancel"
              onClick={handleCancelEdit}
              aria-label="Cancel editing"
            >
              ×
            </button>
          </div>
        )}
        {/* Reply chip — only shown in reply mode (mutually exclusive with edit) */}
        {replyTo && !editingComment && (
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
            aria-label={editingComment ? 'Edit comment text' : 'Comment text'}
            onFocus={handleComposerFocus}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleSubmit(e)
              }
            }}
          />
          <button
            type="submit"
            className={`rc-composer__send${editingComment ? ' rc-composer__send--save' : ''}`}
            disabled={!isAuthed || posting || !draft.trim()}
            aria-label={editingComment ? 'Save edit' : 'Send comment'}
          >
            {editingComment
              ? <LuCheck size={15} aria-hidden="true" />
              : <LuSend size={15} aria-hidden="true" />
            }
          </button>
        </div>
      </KeyboardAwareView>
    </div>
  )
}

export default ReviewComments
