import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { LuChevronLeft, LuEllipsis, LuArrowUp } from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import {
  getThread,
  sendMessage,
  markThreadAsRead,
  getSharedGame,
  getPartnerHighlights,
} from '../services/messageService'
import { getUserByUsername, getUserById } from '../services/userService'
import { MESSAGES_CHANGED_EVENT } from '../services/messageService'
import {
  loadBlockedIds,
  isMutuallyBlocked,
  blockUser,
  unblockUser,
} from '../services/blockService'
import { shouldShowCount } from '../utils/formatSocialCount'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'
import { showToast } from '../components/Toast'
import { useReactions, prefetchReactionsBatch } from '../hooks/useReactions'
import { useDmPresence } from '../hooks/useDmPresence'
import ReportSheet from '../components/ReportSheet'
import ActionSheet from '../components/ActionSheet'
import KeyboardAwareView from '../components/KeyboardAwareView'
import Avatar from '../components/Avatar'
import './MessagesThread.css'

/* ============================================================
   Helpers
   ============================================================ */

function bubbleTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = (() => {
    const now = new Date()
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    )
  })()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  // Older than today — include the date so the bubble timestamp
  // doesn't read just "9:42 AM" with no calendar context.
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function partnerLabel(partner) {
  if (!partner) return 'Unknown user'
  return partner.display_name || partner.username || 'Unknown user'
}

/** Centered "Today" / "Yesterday" / "July 12" separator between day groups. */
function daySeparatorLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'long', day: 'numeric' })
  }
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

// Empty-state quick replies — tapping one sends it immediately (not just a
// prefill) so starting a conversation is a single tap.
const QUICK_REPLIES = ['👋 Hey!', 'What are you playing?']

const MAX_COMPOSER_LINES = 6
const COMPOSER_LINE_HEIGHT = 22
const TYPING_IDLE_MS = 3000

/* ============================================================
   Page
   ============================================================ */

function MessagesThread() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const decodedUsername = decodeURIComponent(username || '')

  /* ── Resolve username -> partner row ──────────────────────── */

  const [partner, setPartner] = useState(null)
  const [resolveError, setResolveError] = useState(false)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!decodedUsername) {
      setResolveError(true)
      setResolving(false)
      return undefined
    }
    setResolving(true)
    setResolveError(false)

    // Try username first. If that returns nothing AND the param looks
    // like a UUID (inbox/compose may navigate with partner.id when the
    // partner has no username set), fall back to getUserById so those
    // deep-links don't land on "User not found".
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    getUserByUsername(decodedUsername)
      .then(async (row) => {
        if (cancelled) return
        if (row?.id) {
          setPartner(row)
          return
        }
        if (UUID_RE.test(decodedUsername)) {
          const byId = await getUserById(decodedUsername)
          if (cancelled) return
          if (byId?.id) {
            setPartner(byId)
            return
          }
        }
        setResolveError(true)
        setPartner(null)
      })
      .catch(() => {
        if (!cancelled) {
          setResolveError(true)
          setPartner(null)
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [decodedUsername])

  // Prevent the user from messaging themselves — RLS would reject
  // the insert anyway, but warning early is friendlier.
  const isSelf = !!user && partner?.id === user.id

  /* ── Thread state ─────────────────────────────────────────── */

  const { state: navState } = useLocation()

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // Pending attachment injected by DmShareSheet via navigation state.
  // Cleared after the first send attempt.
  const [pendingAttachment, setPendingAttachment] = useState(
    navState?.dmAttachment || null
  )
  const composerRef = useRef(null)
  const scrollRef = useRef(null)

  // Report sheet — holds the message being reported (incoming only).
  const [reportTarget, setReportTarget] = useState(null)

  // Header overflow (⋯) sheet + the block-confirm / report-profile sheets
  // it opens into.
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false)
  const [blockPending, setBlockPending] = useState(false)
  const [reportProfileOpen, setReportProfileOpen] = useState(false)
  const [partnerBlocked, setPartnerBlocked] = useState(false)

  // Empty-state identity stats ("142 games · follows you") — both parts
  // are independently optional, see getPartnerHighlights.
  const [partnerStats, setPartnerStats] = useState({ gamesCount: null, followsYou: false })

  // Whether *we* are actively composing — re-tracked onto the presence
  // channel below so the partner's client can render a typing indicator.
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeoutRef = useRef(null)

  // Bumped on app resume so the realtime effect below tears down the dead
  // (post-suspend) channel and re-subscribes onto a fresh socket — same
  // pattern as UnreadMessagesContext / NotificationsContext.
  const [resumeKey, setResumeKey] = useState(0)

  const partnerId = partner?.id || null
  const currentUserId = user?.id || null

  /* ── F1: DM-thread presence (+ typing) ────────────────────── */

  const { partnerOnline, partnerTyping } = useDmPresence(partnerId, isTyping)

  /* ── Blocked-status + empty-state identity stats ──────────── */

  useEffect(() => {
    if (!partnerId || isSelf) {
      setPartnerBlocked(false)
      return
    }
    let cancelled = false
    loadBlockedIds().then(() => {
      if (!cancelled) setPartnerBlocked(isMutuallyBlocked(partnerId))
    })
    return () => {
      cancelled = true
    }
  }, [partnerId, isSelf])

  useEffect(() => {
    if (!partnerId || isSelf) {
      setPartnerStats({ gamesCount: null, followsYou: false })
      return
    }
    let cancelled = false
    getPartnerHighlights(partnerId)
      .then((stats) => {
        if (!cancelled) setPartnerStats(stats)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [partnerId, isSelf])

  /* ── Shared-game context ───────────────────────────────────── */

  const [sharedGame, setSharedGame] = useState(null)

  useEffect(() => {
    if (!currentUserId || !partnerId) return
    let cancelled = false
    getSharedGame(currentUserId, partnerId)
      .then((game) => {
        if (!cancelled) setSharedGame(game)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [currentUserId, partnerId])

  const loadThread = useCallback(async () => {
    if (!partnerId) return
    setLoading(true)
    try {
      const rows = await getThread(partnerId)
      // Seed every bubble's reactions from one batched read. Without this
      // each Bubble's useReactions fires its own pair of queries, so a
      // thread cost two round-trips per message.
      //
      // Deliberately not awaited: the prefetch marks its ids in-flight on
      // the synchronous path, which is already enough to stop the
      // about-to-mount hooks from racing it, and awaiting would hold the
      // messages off screen for a round-trip they don't depend on.
      prefetchReactionsBatch('dm_message', rows.map((r) => r.id).filter(Boolean))
      setMessages(rows)
    } catch (err) {
      console.error('[MessagesThread] load failed:', err)
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [partnerId])

  useEffect(() => {
    loadThread()
  }, [loadThread])

  /* ── Mark as read on open + when new incoming arrives ─────── */

  useEffect(() => {
    if (!partnerId || !currentUserId) return
    if (isSelf) return
    // Defer to next tick so the messages render before we flip the
    // read receipt — this avoids a jank where the dot disappears
    // before the user actually sees the message that cleared it.
    const id = window.setTimeout(() => {
      markThreadAsRead(partnerId).catch((err) => {
        console.error('[MessagesThread] mark-as-read failed:', err)
      })
    }, 100)
    return () => window.clearTimeout(id)
    // We intentionally rerun this whenever the messages array
    // changes — a realtime INSERT from the partner should mark
    // itself as read immediately since the user is looking at the
    // thread right now.
  }, [partnerId, currentUserId, isSelf, messages.length])

  /* ── Refetch on iOS resume + cross-surface send/read ──────── */

  useEffect(() => {
    if (!partnerId) return undefined
    // Resume also bumps resumeKey (the realtime effect below depends on
    // it) so the dead post-suspend channel is torn down and rebuilt rather
    // than left relying on a naive re-subscribe of the same instance.
    const onResume = () => {
      setResumeKey((k) => k + 1)
      loadThread()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    window.addEventListener(MESSAGES_CHANGED_EVENT, loadThread)
    return () => {
      window.removeEventListener(APP_RESUMED_EVENT, onResume)
      window.removeEventListener(MESSAGES_CHANGED_EVENT, loadThread)
    }
  }, [partnerId, loadThread])

  /* ── Realtime subscription ────────────────────────────────── */

  useEffect(() => {
    if (!partnerId || !currentUserId) return undefined

    const channel = supabase
      .channel(`thread:${currentUserId}:${partnerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          // postgres_changes only supports a single eq filter, so we
          // subscribe to every direct_message INSERT touching this user
          // and then narrow client-side to the (me ↔ partner) pair.
          filter: `recipient_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const row = payload?.new
          if (!row) return
          if (row.sender_id !== partnerId) return
          await appendRealtimeRow(row)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const row = payload?.new
          if (!row) return
          if (row.recipient_id !== partnerId) return
          await appendRealtimeRow(row)
        }
      )

    const disposeSubscribe = subscribeWithRecovery(channel)

    async function appendRealtimeRow(row) {
      // The realtime payload doesn't include the joined sender row,
      // so fetch the author so the avatar + name on incoming bubbles
      // render properly. For our own bubbles we reuse the auth user.
      let sender = null
      if (row.sender_id === currentUserId) {
        sender = {
          id: currentUserId,
          username: user?.user_metadata?.username || '',
          display_name: user?.user_metadata?.display_name || '',
          avatar_url: user?.user_metadata?.avatar_url || null,
        }
      } else {
        try {
          const { data } = await supabase
            .from('users')
            .select('id, username, display_name, avatar_url')
            .eq('id', row.sender_id)
            .maybeSingle()
          sender = data || null
        } catch {
          sender = null
        }
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev
        return [...prev, { ...row, sender }]
      })
    }

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
    // Narrowed to currentUserId (user?.id) rather than the whole `user`
    // object — `user` gets a new reference on every auth token refresh,
    // which used to tear down and rebuild this channel on every refresh
    // even though nothing about the subscription actually needs to
    // change. appendRealtimeRow reads `user?.user_metadata` from the
    // closure captured when the effect last ran (i.e. when currentUserId
    // last changed), which is fine since display name/avatar rarely
    // change mid-thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, currentUserId, resumeKey])

  /* ── Auto-scroll to bottom when messages append ──────────── */

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  /* ── Composer auto-resize ─────────────────────────────────── */

  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = MAX_COMPOSER_LINES * COMPOSER_LINE_HEIGHT + 20
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [draft])

  /* ── Typing indicator — broadcast onto the presence channel ──
     Flips `isTyping` true as soon as the composer has content, and
     back to false after a few seconds of inactivity, on send, or on
     unmount. useDmPresence re-tracks this without rejoining. ─── */

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    setIsTyping(false)
  }, [])

  const handleDraftChange = useCallback((value) => {
    setDraft(value)
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
    if (value.trim()) {
      setIsTyping(true)
      typingTimeoutRef.current = window.setTimeout(stopTyping, TYPING_IDLE_MS)
    } else {
      setIsTyping(false)
    }
  }, [stopTyping])

  useEffect(() => stopTyping, [stopTyping])

  /* ── Send ─────────────────────────────────────────────────── */

  const handleSend = useCallback(
    async (e, overrideText) => {
      e?.preventDefault?.()
      if (!partnerId || sending || partnerBlocked) return
      const trimmed = (overrideText ?? draft).trim()
      const attachment = overrideText ? null : pendingAttachment || null
      if (!trimmed && !attachment) return
      if (isSelf) {
        showToast("You can't message yourself.", 'error')
        return
      }
      stopTyping()
      setSending(true)
      // Optimistic — append a temp row so the bubble shows up the
      // instant the user taps Send. Replaced with the real row once
      // sendMessage resolves; rolled back on failure.
      const tempId = `temp-${Date.now()}-${Math.random()}`
      const optimistic = {
        id: tempId,
        sender_id: currentUserId,
        recipient_id: partnerId,
        body: trimmed || null,
        attachment,
        read_at: null,
        created_at: new Date().toISOString(),
        sender: {
          id: currentUserId,
          username: '',
          display_name: '',
          avatar_url: null,
        },
        __pending: true,
      }
      setMessages((prev) => [...prev, optimistic])
      setDraft('')
      setPendingAttachment(null)
      try {
        const inserted = await sendMessage({
          recipientId: partnerId,
          body: trimmed || undefined,
          attachment,
        })
        setMessages((prev) => {
          // Replace the optimistic row with the server one. If the
          // realtime echo beat us here, just drop the temp.
          const withoutTemp = prev.filter((m) => m.id !== tempId)
          if (withoutTemp.some((m) => m.id === inserted.id)) {
            return withoutTemp
          }
          return [...withoutTemp, inserted]
        })
      } catch (err) {
        console.error('[MessagesThread] sendMessage failed:', err)
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        setDraft(trimmed)
        setPendingAttachment(attachment)
        showToast(
          err?.message || "Couldn't send your message. Please try again.",
          'error'
        )
      } finally {
        setSending(false)
      }
    },
    [partnerId, sending, partnerBlocked, draft, pendingAttachment, isSelf, currentUserId, stopTyping]
  )

  /* ── Header click → partner profile ───────────────────────── */

  const openPartnerProfile = useCallback(() => {
    if (!partner) return
    const handle = partner.username || ''
    if (handle) navigate(`/user/${encodeURIComponent(handle)}`)
  }, [partner, navigate])

  /* ── Header overflow actions ──────────────────────────────── */

  const handleToggleBlock = useCallback(async () => {
    if (!partnerId || blockPending) return
    setBlockPending(true)
    try {
      if (partnerBlocked) {
        await unblockUser(partnerId)
        setPartnerBlocked(false)
        showToast('User unblocked.', 'success')
      } else {
        await blockUser(partnerId)
        setPartnerBlocked(true)
        showToast('User blocked.', 'success')
        navigate(-1)
      }
    } catch (err) {
      console.error('[MessagesThread] toggle block failed:', err)
      showToast(err?.message || 'Could not update block status.', 'error')
    } finally {
      setBlockPending(false)
    }
  }, [partnerId, partnerBlocked, blockPending, navigate])

  /* ── Render ───────────────────────────────────────────────── */

  const headerLabel = partner ? partnerLabel(partner) : decodedUsername || 'Messages'
  const partnerAvatar = partner?.avatar_url || null
  const sendDisabled =
    (!draft.trim() && !pendingAttachment) || sending || isSelf || !partnerId || partnerBlocked

  // "Active now" is a real presence signal (Realtime channel); there is no
  // persisted last-seen timestamp anywhere in the schema, so we never
  // fabricate an "Active 2h ago" — the presence line is simply omitted
  // when the partner isn't currently online.
  const presenceLabel = partnerOnline ? 'Active now' : null

  // "142 games · follows you" — each half independently omitted when
  // that data isn't available (see getPartnerHighlights).
  const statLine = useMemo(() => {
    const parts = []
    if (partnerStats.gamesCount != null) {
      parts.push(`${partnerStats.gamesCount} game${partnerStats.gamesCount === 1 ? '' : 's'}`)
    }
    if (partnerStats.followsYou) parts.push('follows you')
    return parts.length ? parts.join(' · ') : null
  }, [partnerStats])

  // Group messages into day buckets with a separator between each —
  // computed once per messages-array change rather than on every render.
  const dayItems = useMemo(() => {
    const items = []
    let lastDayKey = null
    for (const m of messages) {
      const d = new Date(m.created_at)
      const dayKey = Number.isNaN(d.getTime()) ? 'unknown' : d.toDateString()
      if (dayKey !== lastDayKey) {
        items.push({ kind: 'separator', key: `sep-${dayKey}-${m.id}`, label: daySeparatorLabel(d) })
        lastDayKey = dayKey
      }
      items.push({ kind: 'message', key: m.id, message: m })
    }
    return items
  }, [messages])

  return (
    <div className="dm-thread">
      <header className="dm-thread__header">
        <button
          type="button"
          className="dm-thread__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dm-thread__partner"
          onClick={openPartnerProfile}
          aria-label={`Open ${headerLabel}'s profile`}
        >
          <div className="dm-thread__avatar-wrap">
            <Avatar
              avatarUrl={partnerAvatar}
              name={headerLabel}
              seed={partner?.id}
              size="sm"
              className="dm-thread__avatar"
            />
            {partnerOnline && (
              <span className="dm-thread__online-dot" aria-label="Online" />
            )}
          </div>
          <div className="dm-thread__partner-info">
            <span className="dm-thread__partner-name">{headerLabel}</span>
            {presenceLabel ? (
              <span className="dm-thread__presence-line">{presenceLabel}</span>
            ) : sharedGame?.gameTitle ? (
              <span className="dm-thread__context-line">
                you both played {sharedGame.gameTitle}
              </span>
            ) : null}
          </div>
        </button>
        <button
          type="button"
          className="dm-thread__overflow"
          onClick={() => setOverflowOpen(true)}
          aria-label="More options"
          disabled={!partner || isSelf}
        >
          <LuEllipsis size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="dm-thread__scroll" ref={scrollRef}>
        {resolving ? (
          <div className="dm-thread__loading" aria-hidden="true">
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--out" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
          </div>
        ) : resolveError ? (
          <div className="dm-thread__empty">
            <p className="dm-thread__empty-h2">User not found</p>
            <p className="dm-thread__empty-sub">
              We couldn&rsquo;t find <strong>@{decodedUsername}</strong>.
            </p>
          </div>
        ) : isSelf ? (
          <div className="dm-thread__empty">
            <p className="dm-thread__empty-h2">That&rsquo;s you</p>
            <p className="dm-thread__empty-sub">
              You can&rsquo;t message yourself.
            </p>
          </div>
        ) : partnerBlocked ? (
          <div className="dm-thread__empty">
            <p className="dm-thread__empty-h2">You can&rsquo;t message this user</p>
            <p className="dm-thread__empty-sub">
              This conversation isn&rsquo;t available.
            </p>
          </div>
        ) : loading ? (
          <div className="dm-thread__loading" aria-hidden="true">
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--out" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
          </div>
        ) : messages.length === 0 ? (
          <div className="dm-empty">
            <Avatar
              avatarUrl={partnerAvatar}
              name={headerLabel}
              seed={partner?.id}
              size="xl"
              className="dm-empty__avatar"
            />
            <h2 className="dm-empty__name">{headerLabel}</h2>
            {statLine && <p className="dm-empty__stats">{statLine}</p>}
            <p className="dm-empty__starter">
              This is the start of your conversation with {headerLabel}.
            </p>
            <div className="dm-empty__chips" role="group" aria-label="Quick replies">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  className="dm-empty__chip"
                  onClick={() => handleSend(null, reply)}
                  disabled={sending}
                >
                  {reply}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="dm-thread__list" role="list">
            {dayItems.map((item) =>
              item.kind === 'separator' ? (
                <li key={item.key} className="dm-day-separator" role="presentation">
                  <span>{item.label}</span>
                </li>
              ) : (
                <Bubble
                  key={item.key}
                  message={item.message}
                  isOutgoing={item.message.sender_id === currentUserId}
                  onReport={item.message.sender_id !== currentUserId ? setReportTarget : undefined}
                />
              )
            )}
            {partnerTyping && (
              <li
                className="dm-bubble-row dm-bubble-row--in"
                aria-live="polite"
                aria-label={`${headerLabel} is typing`}
              >
                <div className="dm-bubble-row__inner">
                  <div className="dm-bubble dm-bubble--in dm-bubble--typing">
                    <span className="dm-typing-dot" />
                    <span className="dm-typing-dot" />
                    <span className="dm-typing-dot" />
                  </div>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      <ReportSheet
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType="message"
        contentId={reportTarget?.id}
      />

      <ReportSheet
        isOpen={reportProfileOpen}
        onClose={() => setReportProfileOpen(false)}
        contentType="profile"
        contentId={partnerId}
      />

      <ActionSheet
        isOpen={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        items={[
          { label: 'View profile', onClick: openPartnerProfile },
          {
            label: partnerBlocked ? `Unblock ${headerLabel}` : `Block ${headerLabel}`,
            destructive: !partnerBlocked,
            onClick: () => (partnerBlocked ? handleToggleBlock() : setBlockConfirmOpen(true)),
          },
          { label: 'Report', onClick: () => setReportProfileOpen(true) },
        ]}
      />

      <ActionSheet
        isOpen={blockConfirmOpen}
        onClose={() => setBlockConfirmOpen(false)}
        title={`Block ${headerLabel}? They won't be able to see your profile, message you, or interact with your content.`}
        items={[
          {
            label: blockPending ? 'Blocking…' : `Block ${headerLabel}`,
            destructive: true,
            disabled: blockPending,
            onClick: handleToggleBlock,
          },
        ]}
      />

      <KeyboardAwareView
        as="form"
        mode="composer"
        className="dm-thread__composer"
        onSubmit={handleSend}
      >
        {pendingAttachment && (
          <div className="dm-composer-attachment">
            {pendingAttachment.cover_url && (
              <img
                src={pendingAttachment.cover_url}
                alt=""
                className="dm-composer-attachment__thumb"
              />
            )}
            <div className="dm-composer-attachment__text">
              <span className="dm-composer-attachment__type">
                {pendingAttachment.type}
              </span>
              <span className="dm-composer-attachment__title">
                {pendingAttachment.title}
              </span>
            </div>
            <button
              type="button"
              className="dm-composer-attachment__remove"
              onClick={() => setPendingAttachment(null)}
              aria-label="Remove attachment"
            >
              ✕
            </button>
          </div>
        )}
        <div className="dm-thread__composer-row">
          <textarea
            ref={composerRef}
            className="dm-thread__input"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            placeholder={
              isSelf
                ? "You can't message yourself"
                : partnerBlocked
                ? "You can't message this user"
                : pendingAttachment
                ? 'Add a caption (optional)'
                : `Message ${headerLabel}`
            }
            rows={1}
            maxLength={4000}
            disabled={isSelf || !partnerId || partnerBlocked}
            aria-label="Message body"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleSend(e)
              }
            }}
          />
          <button
            type="submit"
            className="dm-thread__send"
            disabled={sendDisabled}
            aria-label={sending ? 'Sending message' : 'Send message'}
          >
            {sending ? (
              <span className="dm-thread__send-spinner" aria-hidden="true" />
            ) : (
              <LuArrowUp size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </KeyboardAwareView>
    </div>
  )
}

/* ============================================================
   Attachment card — rendered inside a bubble when message.attachment
   is present. Tapping navigates to the target within the app.
   ============================================================ */

const ATTACHMENT_TYPE_LABELS = {
  game: 'Game',
  review: 'Review',
  list: 'List',
}

function AttachmentCard({ attachment, isOutgoing }) {
  const navigate = useNavigate()

  const handleTap = () => {
    if (attachment?.url_path) {
      navigate(attachment.url_path)
    }
  }

  return (
    <button
      type="button"
      className={`dm-attachment-card${isOutgoing ? ' dm-attachment-card--out' : ' dm-attachment-card--in'}`}
      onClick={handleTap}
      aria-label={`Open ${attachment?.title || 'shared item'}`}
    >
      {attachment?.cover_url && (
        <img
          src={attachment.cover_url}
          alt=""
          className="dm-attachment-card__cover"
        />
      )}
      <div className="dm-attachment-card__body">
        <span className="dm-attachment-card__type">
          {ATTACHMENT_TYPE_LABELS[attachment?.type] || attachment?.type}
        </span>
        <span className="dm-attachment-card__title">{attachment?.title}</span>
        {attachment?.subtitle && (
          <span className="dm-attachment-card__subtitle">{attachment.subtitle}</span>
        )}
      </div>
      <svg
        className="dm-attachment-card__chevron"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}

/* ============================================================
   Single bubble
   ============================================================ */

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

function Bubble({ message, isOutgoing, onReport }) {
  const isPending = !!message.__pending
  // Reactions — skipped for optimistic/pending bubbles that have no
  // server-side id yet. useReactions handles null gracefully.
  const messageId = isPending ? null : message.id
  const { reactions, toggle } = useReactions('dm_message', messageId)

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const pressTimerRef = useRef(null)
  const bubbleRef = useRef(null)

  // Close context menu on outside click/touch.
  useEffect(() => {
    if (!contextMenuOpen) return undefined
    function handleOutside(e) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target)) {
        setContextMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [contextMenuOpen])

  // Long-press opens the context menu for any non-pending message.
  const startPress = () => {
    if (isPending) return
    pressTimerRef.current = window.setTimeout(() => {
      setContextMenuOpen(true)
    }, 500)
  }

  const cancelPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  const hasAttachment = !!message.attachment
  const hasBody = !!(message.body && message.body.trim())

  return (
    <li
      className={`dm-bubble-row${
        isOutgoing ? ' dm-bubble-row--out' : ' dm-bubble-row--in'
      }`}
    >
      <div className="dm-bubble-row__inner" ref={bubbleRef}>
        <div
          className={`dm-bubble${hasAttachment ? ' dm-bubble--card' : ''}${
            isOutgoing ? ' dm-bubble--out' : ' dm-bubble--in'
          }${isPending ? ' dm-bubble--pending' : ''}`}
          onMouseDown={startPress}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onTouchCancel={cancelPress}
          onContextMenu={(e) => {
            if (!isPending) {
              e.preventDefault()
              setContextMenuOpen(true)
            }
          }}
        >
          {hasBody && (
            <p className="dm-bubble__body">{message.body}</p>
          )}
          {hasAttachment && (
            <AttachmentCard attachment={message.attachment} isOutgoing={isOutgoing} />
          )}
          <span className="dm-bubble__time">{bubbleTime(message.created_at)}</span>
        </div>

        {/* F3: reaction pills below the bubble */}
        {reactions.length > 0 && (
          <div
            className={`dm-bubble__reactions${isOutgoing ? ' dm-bubble__reactions--out' : ''}`}
          >
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`dm-bubble__reaction-pill${r.reacted ? ' dm-bubble__reaction-pill--reacted' : ''}`}
                onClick={() => toggle(r.emoji)}
                aria-label={shouldShowCount(r.count) ? `${r.emoji} ${r.count}` : r.emoji}
              >
                {r.emoji}
                {shouldShowCount(r.count) && <span className="dm-bubble__reaction-count">{r.count}</span>}
              </button>
            ))}
          </div>
        )}

        {/* F3: context menu (emoji picker + optional Report) */}
        {contextMenuOpen && (
          <div
            className={`dm-bubble__context-menu${
              isOutgoing ? '' : ' dm-bubble__context-menu--in'
            }`}
            role="menu"
          >
            <div className="dm-bubble__emoji-picker" role="group" aria-label="React with emoji">
              {REACTION_EMOJIS.map((emoji) => {
                const isReacted = reactions.some((r) => r.emoji === emoji && r.reacted)
                return (
                  <button
                    key={emoji}
                    type="button"
                    className={`dm-bubble__emoji-btn${isReacted ? ' dm-bubble__emoji-btn--active' : ''}`}
                    onClick={() => {
                      toggle(emoji)
                      setContextMenuOpen(false)
                    }}
                    aria-label={emoji}
                    aria-pressed={isReacted}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
            {onReport && (
              <button
                type="button"
                role="menuitem"
                className="dm-bubble__context-btn"
                onClick={() => {
                  setContextMenuOpen(false)
                  onReport(message)
                }}
              >
                Report
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export default MessagesThread
