import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuArrowUp, LuCheck, LuChevronLeft, LuEllipsis, LuFlag, LuShare2, LuX } from 'react-icons/lu'
import { HiOutlineFlag, HiHeart, HiOutlineHeart } from 'react-icons/hi'
import { MessageCircle } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import ReviewCard from '../components/ReviewCard'
import Reactions from '../components/Reactions'
import ReportSheet from '../components/ReportSheet'
import { deleteConfirm, useConfirmSheet } from '../components/ConfirmSheet'
import { showToast } from '../components/Toast'
import { supabase } from '../services/supabase'
import { shouldShowCount } from '../utils/formatSocialCount'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
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
import { useLikeState } from '../hooks/useLikeState'
import { useLikedBy } from '../components/LikedBy'
import { bumpCommentsCount, bumpSharesCount } from '../hooks/useUserStats'
import DmShareSheet from '../components/DmShareSheet'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'
import { whenKeyboardSettled } from '../services/keyboardInset'
import { useHideNav } from '../hooks/useHideNav'
import { useComposerLift } from '../hooks/useComposerLift'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import KeyboardAwareView from '../components/KeyboardAwareView'
import Avatar from '../components/Avatar'
import { ugcErrorMessage } from '../services/moderationService'
import '../components/forms/forms.css'
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
      highestStreakMilestone: row.users?.highest_streak_milestone ?? null,
      plusActive: row.users?.plus_active === true,
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

/* ── Spoiler parsing ─────────────────────────────────────────────────── */

/**
 * Split comment text into plain-text and [spoiler]…[/spoiler] segments.
 * Unmatched brackets are returned as literal text.
 */
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

/** Inline spoiler segment — hidden until tapped. */
function SpoilerSegment({ text }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <button
      type="button"
      className={`rd-comment__spoiler${revealed ? ' rd-comment__spoiler--revealed' : ''}`}
      onClick={() => {
        if (revealed) return
        hapticImpact('Light')
        setRevealed(true)
      }}
      aria-label={revealed ? undefined : 'Tap to reveal spoiler'}
    >
      {text}
    </button>
  )
}

/**
 * Render comment text with:
 *   - [spoiler]…[/spoiler] tags rendered as tap-to-reveal blobs
 *   - The leading @mention (if present) highlighted in brand color
 */
function CommentBody({ text }) {
  const segments = parseForSpoilers(text)
  const hasSpoilers = segments.some((s) => s.type === 'spoiler')

  if (!hasSpoilers) {
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

  return (
    <p className="rd-comment__text">
      {segments.map((seg, i) => {
        if (seg.type === 'spoiler') {
          return <SpoilerSegment key={i} text={seg.content} />
        }
        if (i === 0) {
          const m = seg.content.match(/^(@\S+)(\s[\s\S]*|$)/)
          if (m) {
            return (
              <React.Fragment key={i}>
                <span className="rd-comment__mention">{m[1]}</span>
                {m[2]}
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
   CommentRow
   ============================================================ */

function CommentRow({
  comment,
  isReply,
  isOwn,
  isEditing,
  likeState,
  onLike,
  onReply,
  onEditStart,
  onDelete,
  onReport,
}) {
  const navigate = useNavigate()
  const [kebabOpen, setKebabOpen] = useState(false)
  const [localLike, setLocalLike] = useState(likeState || { liked: false, count: 0 })
  const [pulse, setPulse] = useState(false)
  const kebabRef = useRef(null)
  // Guards against a double-tap firing a second like/unlike write before
  // the first round-trip resolves — mirrors ReviewCard's handleLike guard.
  const likeInFlightRef = useRef(false)

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
    if (likeInFlightRef.current) return
    likeInFlightRef.current = true

    const prev = localLike
    const wasLiked = prev.liked
    hapticImpact('Light')
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
      // onLike (handleCommentLike below) already shows a friendly toast
      // and rethrows on failure — this just owns the local rollback.
      await onLike(comment.id, wasLiked)
    } catch {
      setLocalLike(prev)
    } finally {
      likeInFlightRef.current = false
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
      className={`rd-comment${isReply ? ' rd-comment--reply' : ''}${isEditing ? ' rd-comment--editing' : ''}`}
      data-comment-id={comment.id}
    >
      <button
        type="button"
        className="rd-comment__avatar-wrap"
        onClick={goToAuthor}
        disabled={!authorUsername && !authorUserId}
        aria-label={authorUsername ? `View ${username}'s profile` : undefined}
      >
        <Avatar
          avatarUrl={avatarUrl}
          name={username}
          seed={comment.users?.id}
          size="sm"
          className="rd-comment__avatar"
        />
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

        <CommentBody text={comment.body} />

        <Reactions
          targetType="comment"
          targetId={comment.id}
          className="rd-comment__reactions"
        />
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
                        onClick={() => { setKebabOpen(false); onEditStart(comment) }}
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
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setKebabOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
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
  onEditStart,
  editingCommentId,
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
        isEditing={editingCommentId === comment.id}
        likeState={likeStates.get(comment.id)}
        onLike={onLike}
        onReply={onReply}
        onEditStart={onEditStart}
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
          isEditing={editingCommentId === r.id}
          likeState={likeStates.get(r.id)}
          onLike={onLike}
          onReply={onReply}
          onEditStart={onEditStart}
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
  const [confirm, confirmSheet] = useConfirmSheet()
  const { user, profile } = useAuth()

  // This screen always has a comment composer pinned to the bottom — hide
  // the nav for the whole lifetime of the screen and restore it on
  // unmount. See src/hooks/useHideNav.js.
  useHideNav()

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
  const [editingComment, setEditingComment] = useState(null)
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState(null)
  const [posting, setPosting] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  // ── Refs ────────────────────────────────────────────────────
  /** The textarea inside the inline composer. */
  const inputRef = useRef(null)
  const draftRef = useRef('')
  const editingCommentRef = useRef(null)
  /** Draft in the bar before edit mode started — restored on cancel. */
  const composerDraftBeforeEditRef = useRef('')
  // The bar lifts only while its own field is focused (see useComposerLift).
  const composerLift = useComposerLift(inputRef)
  const { onFocus: liftOnFocus } = composerLift
  /** Sentinel at the bottom of the thread — scrolled into view instead of
   * setting scrollTop directly, since `.rd-scroll` is no longer its own
   * scroll container (`.main-content` is; see ReviewDetail.css). */
  const threadBottomRef = useRef(null)

  // ── Report sheet ────────────────────────────────────────────
  const [reportTarget, setReportTarget] = useState(null)
  const [reportReview, setReportReview] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)

  // Bumped on app resume so the realtime effect below tears down the dead
  // (post-suspend) channel and re-subscribes onto a fresh socket — same
  // pattern as UnreadMessagesContext / NotificationsContext.
  const [resumeKey, setResumeKey] = useState(0)

  const isAuthed = !!user
  const reviewLikeState = useLikeState(reviewId)
  const likedByViewer = useMemo(
    () =>
      user
        ? {
            id: user.id,
            username: profile?.username || user.user_metadata?.username || null,
            avatarUrl: profile?.avatarUrl || user.user_metadata?.avatar_url || null,
          }
        : null,
    [user, profile]
  )
  const likedBy = useLikedBy(
    'review',
    reviewId,
    `${reviewLikeState.liked}:${reviewLikeState.count}`,
    likedByViewer
  )

  /* ── Load ─────────────────────────────────────────────────── */

  /** Discards responses from a load that a newer one has superseded. */
  const loadGenerationRef = useRef(0)

  /**
   * @param {{ silent?: boolean }} [opts] `silent` leaves the loading flags
   *   alone, so a resume revalidation swaps the thread in underneath the user
   *   instead of flashing skeletons over content already on screen.
   */
  const loadThread = useCallback(
    ({ silent = false } = {}) => {
      if (!reviewId) return
      const generation = ++loadGenerationRef.current
      const isStale = () => generation !== loadGenerationRef.current

      if (!silent) {
        setReviewLoading(true)
        setReviewMissing(false)
      }
      getReviewById(reviewId)
        .then((row) => {
          if (isStale()) return
          if (!row) { setReviewMissing(true); setReview(null) }
          else setReview(row)
        })
        .catch(() => { if (!isStale()) setReviewMissing(true) })
        .finally(() => { if (!isStale()) setReviewLoading(false) })

      if (!silent) setCommentsLoading(true)
      getCommentsForReview(reviewId)
        .then((rows) => {
          if (isStale()) return
          setComments(rows)
          const ids = rows.map((c) => c.id)
          getCommentLikeStates(ids, user?.id || null).then((states) => {
            if (!isStale()) setLikeStates(states)
          })
        })
        .catch((err) => {
          console.error('[ReviewDetail] load failed:', err)
          if (!isStale()) setComments([])
        })
        .finally(() => { if (!isStale()) setCommentsLoading(false) })
    },
    [reviewId, user?.id]
  )

  useEffect(() => {
    loadThread()
  }, [loadThread])

  /* ── Resume revalidation ──────────────────────────────────────
     The realtime subscription below only carries INSERTs, and it was dead
     while the app was suspended anyway — so edits, deletes, and likes that
     happened in the meantime are only picked up by refetching here. */
  useEffect(() => {
    const onResume = () => {
      setResumeKey((k) => k + 1)
      loadThread({ silent: true })
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [loadThread])

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

    const disposeSubscribe = subscribeWithRecovery(channel)

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
  }, [reviewId, resumeKey])

  /* ── Auto-grow textarea ───────────────────────────────────── */
  // Shared with List Comments / Review Comments (see
  // src/hooks/useAutoGrowTextarea.js) so the grow-then-cap behavior can
  // never drift between composers. Cap matches .composer__input's
  // max-height in styles/keyboard.css.
  useAutoGrowTextarea(inputRef, draft, 90)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    editingCommentRef.current = editingComment
  }, [editingComment])

  /* ── Scroll helpers ───────────────────────────────────────── */

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [])

  /* ── Composer focus / blur ────────────────────────────────── */

  const focusComposer = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      // Some browsers throw on non-text inputs; ignore.
    }
  }, [])

  const handleComposerFocus = useCallback(() => {
    liftOnFocus()
    whenKeyboardSettled(() => {
      const editing = editingCommentRef.current
      if (editing) {
        const el = document.querySelector(`[data-comment-id="${editing.id}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else {
        scrollToBottom()
      }
    })
    if (!editingCommentRef.current) {
      scrollToBottom()
    }
  }, [scrollToBottom, liftOnFocus])

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
    setEditingComment(null)
    setComposerError(null)
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
    window.requestAnimationFrame(focusComposer)
  }, [isAuthed, focusComposer])

  const handleEditStart = useCallback(
    (comment) => {
      setReplyTo(null)
      setComposerError(null)
      composerDraftBeforeEditRef.current = draftRef.current
      setEditingComment(comment)
      setDraft(comment.body)
      window.requestAnimationFrame(focusComposer)
    },
    [focusComposer]
  )

  const handleCancelEdit = useCallback(() => {
    setEditingComment(null)
    setDraft(composerDraftBeforeEditRef.current)
    setComposerError(null)
  }, [])

  /** Cancel reply — clears the @mention prefix and the replyTo state. */
  const cancelReply = useCallback(() => {
    setReplyTo(null)
    setDraft((prev) => prev.replace(/^@\S+\s*/, ''))
  }, [])

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
      if (!ugcErrorMessage(err)) {
        showToast(
          err?.message || "Couldn't update your comment. Please try again.",
          'error'
        )
      }
      throw err
    }
  }, [])

  const handlePost = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || posting) return
    setComposerError(null)

    if (editingComment) {
      if (trimmed === editingComment.body) {
        setEditingComment(null)
        setDraft(composerDraftBeforeEditRef.current)
        return
      }
      setPosting(true)
      try {
        await handleEdit(editingComment.id, trimmed)
        hapticSuccess()
        setEditingComment(null)
        setDraft('')
      } catch (err) {
        const blocked = ugcErrorMessage(err)
        if (blocked) setComposerError(blocked)
      } finally {
        setPosting(false)
      }
      return
    }

    hapticSuccess()
    setPosting(true)
    const replyTarget = replyTo

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
      // Increment local Conversationalist badge counter on successful post.
      bumpCommentsCount(1)
    } catch (err) {
      console.error('[ReviewDetail] postComment failed:', err)
      // Roll back optimistic row
      setComments((prev) => prev.filter((c) => c.id !== optimisticId))
      setLikeStates((prev) => {
        const next = new Map(prev)
        next.delete(optimisticId)
        return next
      })
      const blocked = ugcErrorMessage(err)
      if (blocked) {
        setDraft((current) => current || trimmed)
        setReplyTo((current) => current ?? replyTarget)
        setComposerError(blocked)
      } else {
        showToast(
          err?.message || "Couldn't post your comment. Please try again.",
          'error'
        )
      }
    } finally {
      setPosting(false)
    }
  }, [draft, posting, reviewId, replyTo, editingComment, handleEdit, user, scrollToBottom])

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

  /* ── Delete / report handlers ─────────────────────────────── */

  const handleDelete = useCallback(async (comment) => {
    if (!(await confirm(deleteConfirm('comment')))) return
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
  }, [comments, confirm])

  const handleReport = useCallback((comment) => {
    setReportTarget(comment)
  }, [])

  // Same share path ReviewCard's action-row share icon used (DmShareSheet
  // → native/web/clipboard cascade). Share-quote is removed, not repaired.
  const handleShare = useCallback(() => {
    if (!reviewCardShape) return
    setDmShareOpen(true)
    bumpSharesCount(1)
  }, [reviewCardShape])

  const dmShareAttachment = reviewCardShape
    ? {
        type: 'review',
        id: reviewCardShape.id,
        title:
          reviewCardShape.title ||
          `${reviewCardShape.author?.username || 'Someone'}\u2019s review of ${reviewCardShape.game?.name || 'a game'}`,
        cover_url: reviewCardShape.game?.coverUrl || null,
        subtitle: reviewCardShape.game?.name || null,
        url_path: `/reviews/${reviewCardShape.id}`,
      }
    : null

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="rd-page">
      {/* ── Fixed header ─────────────────────────── */}
      <header className="rd-header">
        <button
          type="button"
          className="rd-back"
          onClick={() => {
            if (draft.trim()) {
              setDiscardOpen(true)
              return
            }
            navigate(-1)
          }}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="rd-header__title">Review</h1>
        <div className="rd-header__actions">
          <button
            type="button"
            className="rd-header__icon"
            onClick={handleShare}
            disabled={!reviewCardShape}
            aria-label="Share"
          >
            <LuShare2 size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rd-header__icon"
            onClick={() => setReportReview(true)}
            disabled={!reviewCardShape}
            aria-label="Report review"
          >
            <LuFlag size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ── Thread body ──────────────────────────── */}
      <div className="rd-scroll">
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
              isOwn={!!user && review?.user_id === user.id}
              onCommentClick={openComposer}
              likedBy={likedBy}
            />
          )}
        </div>

        {/* Comments section */}
        <section className="rd-thread" aria-label="Comments">
          <div className="rd-thread__divider">
            <span className="rd-thread__divider-label">Comments</span>
            {!commentsLoading && shouldShowCount(commentCount) && (
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
            <div role="status">
              <EmptyState icon={MessageCircle} size="compact" body="No comments yet — start the conversation." />
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
                onEditStart={handleEditStart}
                editingCommentId={editingComment?.id}
                onDelete={handleDelete}
                onReport={handleReport}
              />
            ))
          )}
          {/* Sentinel: scrolled into view after posting or when the
              keyboard opens, so the newest comment stays visible above
              the composer (see scrollToBottom / handleComposerFocus). */}
          <div ref={threadBottomRef} aria-hidden="true" />
        </section>
      </div>

      {/* ── Inline keyboard-attached composer ────── */}
      {/*
       * In-flow last child of .rd-page (position:fixed, rides keyboard).
       * The lift comes from the shared composer mode, so this bar sits flush
       * flush on the keyboard's top edge when the keyboard is up.
       */}
      <KeyboardAwareView
        mode="composer"
        lift={composerLift.active}
        className="kb-composer-bar kb-composer-bar--seamless composer-bar rd-composer"
        aria-label="Comment composer"
      >
        {editingComment && (
          <div className="composer__chip text-caption">
            <span className="composer__chip-text">Editing comment</span>
            <button
              type="button"
              className="composer__chip-close"
              onClick={handleCancelEdit}
              aria-label="Cancel editing"
            >
              <LuX size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {replyTo && !editingComment && (
          <div className="composer__chip text-caption">
            <span className="composer__chip-text">
              Replying to{' '}
              <strong>{displayNameFor(replyTo.users)}</strong>
            </span>
            <button
              type="button"
              className="composer__chip-close"
              onClick={cancelReply}
              aria-label="Cancel reply"
            >
              <LuX size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {composerError && (
          <p className="composer__error form-field__error" role="alert">{composerError}</p>
        )}

        <div className="composer__row">
          <div className="composer__shell">
            <textarea
              ref={inputRef}
              className="composer__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={handleComposerFocus}
              onBlur={composerLift.onBlur}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                editingComment
                  ? undefined
                  : replyTo
                    ? `Reply to ${displayNameFor(replyTo.users)}…`
                    : 'Add a comment…'
              }
              maxLength={MAX_COMMENT_LEN}
              rows={1}
              aria-label={
                editingComment
                  ? 'Edit comment text'
                  : replyTo
                    ? `Reply to ${displayNameFor(replyTo.users)}`
                    : 'Add a comment'
              }
            />

            <button
              type="button"
              className="composer__send"
              onClick={handlePost}
              disabled={!draft.trim() || posting}
              aria-label={editingComment ? 'Save edit' : 'Send comment'}
            >
              {editingComment
                ? <LuCheck size={16} aria-hidden="true" />
                : <LuArrowUp size={16} aria-hidden="true" />
              }
            </button>
          </div>
        </div>
      </KeyboardAwareView>

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

      <DmShareSheet
        isOpen={dmShareOpen}
        onClose={() => setDmShareOpen(false)}
        attachment={dmShareAttachment}
      />

      {confirmSheet}

      <ActionSheet
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard message?"
        cancelLabel="Keep editing"
        items={[
          {
            label: 'Discard',
            destructive: true,
            onClick: () => navigate(-1),
          },
        ]}
      />
    </div>
  )
}

export default ReviewDetail
