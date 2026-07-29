import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft, LuSearch, LuX } from 'react-icons/lu'
import { Edit3, MessageCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getInbox, MESSAGES_CHANGED_EVENT } from '../services/messageService'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { searchUsers } from '../services/userService'
import { useDebounce } from '../hooks/useDebounce'
import { generateDefaultAvatar } from '../services/profileService'
import { supabase } from '../services/supabase'
import { subscribeWithRecovery } from '../services/realtimeRecovery'
import EmptyState from '../components/EmptyState'
import CenteredModal from '../components/CenteredModal'
import './MessagesInbox.css'

/* ============================================================
   Helpers
   ============================================================ */

function relativeTime(timestamp) {
  if (!timestamp) return ''
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'now'
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
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

function partnerLabel(partner) {
  if (!partner) return 'Unknown user'
  return partner.display_name || partner.username || 'Unknown user'
}

function partnerHandle(partner) {
  // Prefer username for the route — usernames are unique. Fall back to
  // the partner UUID so a tap still resolves to *something* even if the
  // recipient has not set a username yet.
  if (!partner) return ''
  return partner.username || partner.id || ''
}

/* ============================================================
   Page
   ============================================================ */

function MessagesInbox() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [composeOpen, setComposeOpen] = useState(false)
  // Bumped on app resume so the realtime effect below tears down the dead
  // (post-suspend) channel and re-subscribes onto a fresh socket — same
  // pattern as UnreadMessagesContext / NotificationsContext.
  const [resumeKey, setResumeKey] = useState(0)

  const reload = useCallback(async () => {
    try {
      const rows = await getInbox()
      setConversations(rows)
    } catch (err) {
      console.error('[MessagesInbox] load failed:', err)
      setConversations([])
    } finally {
      setLoading(false)
    }
  }, [])

  /* ── Initial + cross-surface refresh ───────────────────────── */

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])

  /* ── Realtime subscription ──────────────────────────────────
     Subscribe to INSERTs + UPDATEs on direct_messages where the
     current user is either sender or recipient. We refetch the inbox
     on every event rather than mutating state in place — it keeps the
     DISTINCT-ON / unread-count math centralised in the service and
     the wire payload (one row metadata) is tiny. */

  useEffect(() => {
    if (!user?.id) return undefined

    const channel = supabase
      .channel(`inbox:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${user.id}`,
        },
        () => reload()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${user.id}`,
        },
        () => reload()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${user.id}`,
        },
        // The recipient flipping read_at affects whose dot to show on
        // OUR end (it doesn't, actually — but we still want previews to
        // re-sort if necessary when the realtime echo arrives).
        () => reload()
      )

    const disposeSubscribe = subscribeWithRecovery(channel)

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
  }, [user?.id, reload, resumeKey])

  /* ── Refetch on iOS resume + after mark-as-read in thread ───
     Resume also bumps resumeKey (the realtime effect above depends on it)
     so the dead post-suspend channel is torn down and rebuilt rather than
     left relying on a naive re-subscribe of the same instance. */

  useEffect(() => {
    const onResume = () => {
      setResumeKey((k) => k + 1)
      reload()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    window.addEventListener(MESSAGES_CHANGED_EVENT, reload)
    return () => {
      window.removeEventListener(APP_RESUMED_EVENT, onResume)
      window.removeEventListener(MESSAGES_CHANGED_EVENT, reload)
    }
  }, [reload])

  /* ── Row tap ───────────────────────────────────────────────── */

  const openThread = useCallback(
    (conversation) => {
      const handle = partnerHandle(conversation.partner)
      if (!handle) return
      navigate(`/messages/${encodeURIComponent(handle)}`)
    },
    [navigate]
  )

  const openCompose = useCallback(() => setComposeOpen(true), [])
  const closeCompose = useCallback(() => setComposeOpen(false), [])

  const handlePickRecipient = useCallback(
    (recipient) => {
      const handle = recipient.username || recipient.id
      if (!handle) return
      setComposeOpen(false)
      navigate(`/messages/${encodeURIComponent(handle)}`)
    },
    [navigate]
  )

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div className="dm-inbox">
      <header className="dm-inbox__header">
        <button
          type="button"
          className="dm-inbox__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="dm-inbox__title">Messages</h1>
        <button
          type="button"
          className="dm-inbox__compose"
          onClick={openCompose}
          aria-label="New message"
        >
          <Edit3 size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="dm-inbox__body">
        {loading ? (
          <div className="dm-inbox__loading" aria-hidden="true">
            <span className="skeleton dm-inbox__loading-row" />
            <span className="skeleton dm-inbox__loading-row" />
            <span className="skeleton dm-inbox__loading-row" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="dm-inbox__empty">
            <EmptyState
              icon={MessageCircle}
              title="No messages yet."
              body="Tap someone's profile to send them a message."
            />
          </div>
        ) : (
          <ul className="dm-inbox__list" role="list">
            {conversations.map((c) => (
              <ConversationRow
                key={c.partnerId}
                conversation={c}
                currentUserId={user?.id}
                onTap={() => openThread(c)}
              />
            ))}
          </ul>
        )}
      </div>

      <ComposeSheet
        isOpen={composeOpen}
        onClose={closeCompose}
        onPick={handlePickRecipient}
        currentUserId={user?.id}
      />
    </div>
  )
}

/* ============================================================
   Conversation row
   ============================================================ */

function ConversationRow({ conversation, currentUserId, onTap }) {
  const { partner, lastMessage, unreadCount } = conversation
  const fallback = generateDefaultAvatar(partnerLabel(partner))

  // Preview prefix when WE sent the latest message ("You: …") so the
  // user can scan the inbox without opening every thread to figure
  // out who sent the last reply.
  const fromMe = lastMessage.sender_id === currentUserId
  const preview = fromMe ? `You: ${lastMessage.body}` : lastMessage.body
  const hasUnread = unreadCount > 0 && !fromMe

  return (
    <li>
      <button
        type="button"
        className={`dm-inbox-row${hasUnread ? ' dm-inbox-row--unread' : ''}`}
        onClick={onTap}
      >
        <div className="dm-inbox-row__avatar">
          {partner?.avatar_url ? (
            <img src={partner.avatar_url} alt="" loading="lazy" />
          ) : (
            <span
              className="dm-inbox-row__avatar-fallback"
              style={{ background: fallback.color }}
              aria-hidden="true"
            >
              {fallback.initials}
            </span>
          )}
        </div>
        <div className="dm-inbox-row__main">
          <div className="dm-inbox-row__line1">
            <span className="dm-inbox-row__name">{partnerLabel(partner)}</span>
            <span className="dm-inbox-row__time">
              {relativeTime(lastMessage.created_at)}
              {hasUnread && (
                <span
                  className="dm-inbox-row__dot"
                  aria-label={`${unreadCount} unread`}
                />
              )}
            </span>
          </div>
          <p className="dm-inbox-row__preview">{preview}</p>
        </div>
      </button>
    </li>
  )
}

/* ============================================================
   Compose sheet — pick a recipient by username
   ============================================================ */

function ComposeSheet({ isOpen, onClose, onPick, currentUserId }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const debounced = useDebounce(query, 250)

  // Reset the query each time the picker opens so a stale search from a
  // previous compose doesn't linger.
  useEffect(() => {
    if (isOpen) setQuery('')
  }, [isOpen])

  // Focus the input on open. Defer slightly so the popup enter animation
  // doesn't fight the keyboard for layout.
  useEffect(() => {
    if (!isOpen) return undefined
    const id = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [isOpen])

  // Debounced search.
  useEffect(() => {
    const trimmed = debounced.trim()
    if (!trimmed) {
      setResults([])
      setSearching(false)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    searchUsers(trimmed, 20)
      .then((rows) => {
        if (cancelled) return
        // Hide self from the picker — messaging yourself is rejected
        // server-side anyway and would just confuse the UI.
        setResults(rows.filter((r) => r.id !== currentUserId))
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, currentUserId])

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="New message"
      maxWidth={520}
      className="dm-compose"
    >
      <header className="dm-compose__header">
        <button
          type="button"
          className="dm-compose__close"
          onClick={onClose}
          aria-label="Close"
        >
          <LuX size={22} aria-hidden="true" />
        </button>
        <h2 className="dm-compose__title">New message</h2>
        <span className="dm-compose__spacer" aria-hidden="true" />
      </header>

      <div className="dm-compose__search">
        <LuSearch size={16} aria-hidden="true" className="dm-compose__search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="dm-compose__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users by username or display name"
          aria-label="Search users"
        />
      </div>

      <div className="dm-compose__results cm-scroll">
        {!query.trim() ? (
          <p className="dm-compose__hint">
            Start typing to find someone.
          </p>
        ) : searching ? (
          <div aria-hidden="true">
            <span className="skeleton dm-compose__loading-row" />
            <span className="skeleton dm-compose__loading-row" />
          </div>
        ) : results.length === 0 ? (
          <p className="dm-compose__hint">No users match "{query}".</p>
        ) : (
          <ul role="list" className="dm-compose__list">
            {results.map((u) => {
              const fallback = generateDefaultAvatar(
                u.display_name || u.username || 'User'
              )
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className="dm-compose-row"
                    onClick={() => onPick(u)}
                  >
                    <div className="dm-compose-row__avatar">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" loading="lazy" />
                      ) : (
                        <span
                          className="dm-compose-row__avatar-fallback"
                          style={{ background: fallback.color }}
                          aria-hidden="true"
                        >
                          {fallback.initials}
                        </span>
                      )}
                    </div>
                    <div className="dm-compose-row__text">
                      <span className="dm-compose-row__name">
                        {u.display_name || u.username || 'Anonymous'}
                      </span>
                      {u.username && (
                        <span className="dm-compose-row__handle">
                          {u.username}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </CenteredModal>
  )
}

export default MessagesInbox
