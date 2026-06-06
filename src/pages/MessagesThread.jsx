import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import {
  getThread,
  sendMessage,
  markThreadAsRead,
} from '../services/messageService'
import { getUserByUsername } from '../services/userService'
import { generateDefaultAvatar } from '../services/profileService'
import { showToast } from '../components/Toast'
import ReportSheet from '../components/ReportSheet'
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

const MAX_COMPOSER_LINES = 6
const COMPOSER_LINE_HEIGHT = 22

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
    getUserByUsername(decodedUsername)
      .then((row) => {
        if (cancelled) return
        if (!row?.id) {
          setResolveError(true)
          setPartner(null)
        } else {
          setPartner(row)
        }
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

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const composerRef = useRef(null)
  const scrollRef = useRef(null)

  // Report sheet — holds the message being reported (incoming only).
  const [reportTarget, setReportTarget] = useState(null)

  const partnerId = partner?.id || null
  const currentUserId = user?.id || null

  const loadThread = useCallback(async () => {
    if (!partnerId) return
    setLoading(true)
    try {
      const rows = await getThread(partnerId)
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
      .subscribe()

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
      supabase.removeChannel(channel)
    }
  }, [partnerId, currentUserId, user])

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

  /* ── Send ─────────────────────────────────────────────────── */

  const handleSend = useCallback(
    async (e) => {
      e?.preventDefault?.()
      if (!partnerId || sending) return
      const trimmed = draft.trim()
      if (!trimmed) return
      if (isSelf) {
        showToast("You can't message yourself.", 'error')
        return
      }
      setSending(true)
      // Optimistic — append a temp row so the bubble shows up the
      // instant the user taps Send. Replaced with the real row once
      // sendMessage resolves; rolled back on failure.
      const tempId = `temp-${Date.now()}-${Math.random()}`
      const optimistic = {
        id: tempId,
        sender_id: currentUserId,
        recipient_id: partnerId,
        body: trimmed,
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
      try {
        const inserted = await sendMessage({
          recipientId: partnerId,
          body: trimmed,
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
        setDraft(trimmed) // restore so the user can retry
        showToast(
          err?.message || "Couldn't send your message. Please try again.",
          'error'
        )
      } finally {
        setSending(false)
      }
    },
    [partnerId, sending, draft, isSelf, currentUserId]
  )

  /* ── Header click → partner profile ───────────────────────── */

  const openPartnerProfile = useCallback(() => {
    if (!partner) return
    const handle = partner.username || ''
    if (handle) navigate(`/user/${encodeURIComponent(handle)}`)
  }, [partner, navigate])

  /* ── Render ───────────────────────────────────────────────── */

  const headerLabel = partner ? partnerLabel(partner) : decodedUsername || 'Messages'
  const fallback = useMemo(
    () => generateDefaultAvatar(headerLabel),
    [headerLabel]
  )
  const partnerAvatar = partner?.avatar_url || null
  const sendDisabled = !draft.trim() || sending || isSelf || !partnerId

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
          <div className="dm-thread__avatar">
            {partnerAvatar ? (
              <img src={partnerAvatar} alt="" />
            ) : (
              <span
                className="dm-thread__avatar-fallback"
                style={{ background: fallback.color }}
                aria-hidden="true"
              >
                {fallback.initials}
              </span>
            )}
          </div>
          <span className="dm-thread__partner-name">{headerLabel}</span>
        </button>
        <span className="dm-thread__header-spacer" aria-hidden="true" />
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
        ) : loading ? (
          <div className="dm-thread__loading" aria-hidden="true">
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--out" />
            <span className="skeleton dm-thread__loading-bubble dm-thread__loading-bubble--in" />
          </div>
        ) : messages.length === 0 ? (
          <div className="dm-thread__empty">
            <p className="dm-thread__empty-h2">Say hi to {headerLabel}</p>
            <p className="dm-thread__empty-sub">
              No messages yet — your first message starts the conversation.
            </p>
          </div>
        ) : (
          <ul className="dm-thread__list" role="list">
            {messages.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                isOutgoing={m.sender_id === currentUserId}
                onReport={m.sender_id !== currentUserId ? setReportTarget : undefined}
              />
            ))}
          </ul>
        )}
      </div>

      <ReportSheet
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        contentType="message"
        contentId={reportTarget?.id}
      />

      <form className="dm-thread__composer" onSubmit={handleSend}>
        <textarea
          ref={composerRef}
          className="dm-thread__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isSelf
              ? "You can't message yourself"
              : `Message ${headerLabel}`
          }
          rows={1}
          maxLength={4000}
          disabled={isSelf || !partnerId}
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
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

/* ============================================================
   Single bubble
   ============================================================ */

function Bubble({ message, isOutgoing, onReport }) {
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

  const startPress = () => {
    if (!onReport) return
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

  return (
    <li
      className={`dm-bubble-row${
        isOutgoing ? ' dm-bubble-row--out' : ' dm-bubble-row--in'
      }`}
    >
      <div className="dm-bubble-row__inner" ref={bubbleRef}>
        <div
          className={`dm-bubble${
            isOutgoing ? ' dm-bubble--out' : ' dm-bubble--in'
          }${message.__pending ? ' dm-bubble--pending' : ''}`}
          onMouseDown={startPress}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onTouchCancel={cancelPress}
          onContextMenu={(e) => {
            if (onReport) {
              e.preventDefault()
              setContextMenuOpen(true)
            }
          }}
        >
          <p className="dm-bubble__body">{message.body}</p>
          <span className="dm-bubble__time">{bubbleTime(message.created_at)}</span>
        </div>

        {contextMenuOpen && onReport && (
          <div
            className={`dm-bubble__context-menu${
              isOutgoing ? '' : ' dm-bubble__context-menu--in'
            }`}
            role="menu"
          >
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
          </div>
        )}
      </div>
    </li>
  )
}

export default MessagesThread
