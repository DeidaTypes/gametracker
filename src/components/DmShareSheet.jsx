import React, { useEffect, useRef, useState } from 'react'
import { LuSearch, LuX } from 'react-icons/lu'
import { UserX } from 'lucide-react'
import { sendMessage } from '../services/messageService'
import { searchUsers } from '../services/userService'
import { useAuth } from '../contexts/AuthContext'
import { useDebounce } from '../hooks/useDebounce'
import { showToast } from './Toast'
import CenteredModal from './CenteredModal'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import './DmShareSheet.css'

/**
 * DmShareSheet — pick a DM recipient and send an F2-style attachment card.
 *
 * Props:
 *   isOpen      boolean
 *   onClose     () => void
 *   attachment  {
 *     type:      'game'|'review'|'list',
 *     id:        string,
 *     title:     string,
 *     cover_url: string|null,
 *     subtitle:  string|null,
 *     url_path:  string,
 *   }|null
 */
export default function DmShareSheet({ isOpen, onClose, attachment }) {
  const { user } = useAuth()
  const currentUserId = user?.id || null

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(null) // recipient id being sent to
  const inputRef = useRef(null)
  const debounced = useDebounce(query, 250)

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setResults([])
      setSending(null)
    }
  }, [isOpen])

  // Focus input shortly after open so keyboard doesn't fight animation
  useEffect(() => {
    if (!isOpen) return undefined
    const id = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [isOpen])

  // Debounced user search
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
        setResults(rows.filter((r) => r.id !== currentUserId))
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => { cancelled = true }
  }, [debounced, currentUserId])

  const handlePick = async (recipient) => {
    if (sending || !attachment) return
    setSending(recipient.id)
    try {
      await sendMessage({ recipientId: recipient.id, attachment })
      const name = recipient.display_name || recipient.username || 'them'
      showToast(`Sent to ${name}`, 'success')
      onClose()
    } catch (err) {
      console.error('[DmShareSheet] send failed:', err)
      showToast(err?.message || "Couldn't send. Please try again.", 'error')
      setSending(null)
    }
  }

  const ATTACHMENT_TYPE_LABELS = { game: 'Game', review: 'Review', list: 'List' }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Send via direct message"
      maxWidth={520}
      className="dm-share-sheet"
    >
      <header className="dm-share-sheet__header">
        <button
          type="button"
          className="dm-share-sheet__close"
          onClick={onClose}
          aria-label="Close"
        >
          <LuX size={22} aria-hidden="true" />
        </button>
        <h2 className="dm-share-sheet__title">Send as direct message</h2>
        <span className="dm-share-sheet__spacer" aria-hidden="true" />
      </header>

      {attachment && (
        <div className="dm-share-sheet__preview">
          {attachment.cover_url && (
            <img
              src={attachment.cover_url}
              alt=""
              className="dm-share-sheet__preview-cover"
            />
          )}
          <div className="dm-share-sheet__preview-text">
            <span className="dm-share-sheet__preview-type">
              {ATTACHMENT_TYPE_LABELS[attachment.type] || attachment.type}
            </span>
            <span className="dm-share-sheet__preview-title">{attachment.title}</span>
            {attachment.subtitle && (
              <span className="dm-share-sheet__preview-subtitle">
                {attachment.subtitle}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="dm-share-sheet__search">
        <LuSearch size={16} aria-hidden="true" className="dm-share-sheet__search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="dm-share-sheet__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users by username or display name"
          aria-label="Search users"
        />
      </div>

      <div className="dm-share-sheet__results cm-scroll">
        {!query.trim() ? (
          <p className="dm-share-sheet__hint">Start typing to find someone.</p>
        ) : searching ? (
          <div aria-hidden="true">
            <span className="skeleton dm-share-sheet__loading-row" />
            <span className="skeleton dm-share-sheet__loading-row" />
          </div>
        ) : results.length === 0 ? (
          <EmptyState icon={UserX} size="inline" body={`No users match "${query}".`} />
        ) : (
          <ul role="list" className="dm-share-sheet__list">
            {results.map((u) => {
              const isSending = sending === u.id
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className="dm-share-row"
                    onClick={() => handlePick(u)}
                    disabled={!!sending}
                  >
                    <Avatar user={u} size="md" className="dm-share-row__avatar" />
                    <div className="dm-share-row__text">
                      <span className="dm-share-row__name">
                        {u.display_name || u.username || 'Anonymous'}
                      </span>
                      {u.username && (
                        <span className="dm-share-row__handle">@{u.username}</span>
                      )}
                    </div>
                    <span className="dm-share-row__action">
                      {isSending ? 'Sending…' : 'Send'}
                    </span>
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
