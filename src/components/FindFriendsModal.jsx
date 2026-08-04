import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserX } from 'lucide-react'
import { searchUsers } from '../services/userService'
import {
  followUser,
  unfollowUser,
  isFollowing as fetchIsFollowing,
  FOLLOW_CHANGED_EVENT,
} from '../services/followService'
import { usePresence } from '../hooks/usePresence'
import { hapticImpact } from '../utils/haptics'
import CenteredModal from './CenteredModal'
import PulseDot from './PulseDot'
import Avatar from './Avatar'
import { showToast } from './Toast'
import EmptyState from './EmptyState'
import './FindFriendsModal.css'

const SEARCH_DEBOUNCE_MS = 300

/**
 * FindFriendsModal — focused, centered user-search popup.
 *
 * Replaces the old "navigate to Explore" behaviour on the Followers /
 * Following pages: the user stays where they are, types a name, and either
 * taps a result to open that person's profile or taps Follow to follow them
 * inline without leaving the popup.
 *
 * Presentation reuses the shared CenteredModal shell (centered, keyboard-
 * aware, NOT a slide-up sheet, NOT a navigation). Content mirrors
 * TrackerSearchModal: a pinned search band on top and a scrollable results
 * list below. Each row shows avatar + display name + username (no @) and a
 * Follow / Following toggle.
 *
 * Props:
 *   isOpen          boolean
 *   onClose         () => void
 *   currentUserId   string | null — used to hide the Follow button on your
 *                   own row and skip the self follow-state check.
 */
function FindFriendsModal({ isOpen, onClose, currentUserId = null }) {
  const navigate = useNavigate()

  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [lastQuery, setLastQuery] = useState('')

  // Per-row "am I following this user?" cache, keyed by user id. Built
  // lazily as results arrive and kept in lockstep with follows toggled
  // elsewhere via FOLLOW_CHANGED_EVENT.
  const [followingMap, setFollowingMap] = useState({})
  const [pendingMap, setPendingMap] = useState({})

  // Presence — dots for opted-in followees currently playing something.
  // Only users in the signed-in user's follow graph who have opted in
  // are returned by usePresence, so privacy is handled by the hook.
  const { playingNow } = usePresence()
  const liveSet = useMemo(
    () => new Set(playingNow.map((p) => p.userId)),
    [playingNow]
  )

  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const searchCallIdRef = useRef(0)

  // Reset on close; autofocus on open (short delay lets the card animate in).
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('')
      setResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastQuery('')
      setFollowingMap({})
      setPendingMap({})
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }
    const t = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [isOpen])

  // Debounced user search.
  useEffect(() => {
    if (!isOpen) return undefined
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = searchTerm.trim()
    if (!trimmed) {
      setResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastQuery('')
      return undefined
    }

    setIsSearching(true)
    setSearchError(null)
    const callId = ++searchCallIdRef.current

    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchUsers(trimmed, 20)
        if (callId !== searchCallIdRef.current) return
        setResults(found)
        setLastQuery(trimmed)

        // Hydrate follow state for everyone except the signed-in user.
        if (currentUserId) {
          const ids = found
            .map((u) => u.id)
            .filter((id) => id && id !== currentUserId)
          if (ids.length > 0) {
            const states = await Promise.all(
              ids.map((id) => fetchIsFollowing(id))
            )
            if (callId !== searchCallIdRef.current) return
            const next = {}
            ids.forEach((id, i) => {
              next[id] = states[i]
            })
            setFollowingMap((prev) => ({ ...prev, ...next }))
          }
        }
      } catch (err) {
        if (callId !== searchCallIdRef.current) return
        console.error('[FindFriendsModal] search failed:', err)
        setSearchError('Search failed. Please try again.')
        setResults([])
        setLastQuery(trimmed)
      } finally {
        if (callId === searchCallIdRef.current) setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, isOpen, currentUserId])

  // Keep buttons consistent when a follow is toggled anywhere (here or on a
  // profile opened from here, etc.).
  useEffect(() => {
    function handleChange(e) {
      const { followeeId, following: newState } = e.detail || {}
      if (!followeeId) return
      setFollowingMap((prev) =>
        followeeId in prev ? { ...prev, [followeeId]: !!newState } : prev
      )
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(FOLLOW_CHANGED_EVENT, handleChange)
  }, [])

  // Tap a row → open that user's profile, then close the popup.
  const handleOpenProfile = (u) => {
    onClose?.()
    if (u.username) {
      navigate(`/user/${encodeURIComponent(u.username)}`)
    } else if (u.id) {
      navigate(`/user/id/${encodeURIComponent(u.id)}`)
    }
  }

  // Inline follow toggle — optimistic, never leaves the popup.
  const handleToggleFollow = useCallback(
    async (userId) => {
      if (!userId || !currentUserId || userId === currentUserId) return
      if (pendingMap[userId]) return
      const wasFollowing = !!followingMap[userId]
      hapticImpact('Light')
      setFollowingMap((prev) => ({ ...prev, [userId]: !wasFollowing }))
      setPendingMap((prev) => ({ ...prev, [userId]: true }))
      try {
        if (wasFollowing) {
          await unfollowUser(userId)
        } else {
          await followUser(userId)
        }
      } catch (err) {
        setFollowingMap((prev) => ({ ...prev, [userId]: wasFollowing }))
        console.error('[FindFriendsModal] follow toggle failed:', err)
        showToast(
          err?.message || "Couldn't update follow status. Tap to retry.",
          'error',
          4000,
          { label: 'Retry', onClick: () => handleToggleFollow(userId) }
        )
      } finally {
        setPendingMap((prev) => ({ ...prev, [userId]: false }))
      }
    },
    [currentUserId, followingMap, pendingMap]
  )

  const showNoResults =
    !isSearching &&
    searchTerm.trim() !== '' &&
    searchTerm.trim() === lastQuery &&
    results.length === 0 &&
    !searchError

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Find people to follow"
      maxWidth={400}
      className="ffm-card"
    >
      {/* ── Pinned search band ── */}
      <div className="ffm-search-pinned">
        <div className="ffm-search-row">
          <svg
            className="ffm-search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10.5 10.5L14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="ffm-search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search people by name…"
            aria-label="Search people by username or display name"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
        </div>
      </div>

      {/* ── Scrollable results body ── */}
      <div className="ffm-body cm-scroll">
        {isSearching && (
          <p className="ffm-status" aria-live="polite">
            Searching…
          </p>
        )}

        {searchError && (
          <p className="ffm-status ffm-status--error" role="alert">
            {searchError}
          </p>
        )}

        {showNoResults && (
          <EmptyState icon={UserX} size="inline" body={`No people found for "${searchTerm.trim()}".`} />
        )}

        {results.length > 0 && (
          <div className="ffm-results-list" role="list">
            {results.map((u) => {
              const username = u.username || ''
              const displayName = u.display_name || ''
              const primary = displayName || username || 'Unknown'
              const isSelf = currentUserId && u.id === currentUserId
              const following = !!followingMap[u.id]
              const pending = !!pendingMap[u.id]
              return (
                <div key={u.id} role="listitem" className="ffm-user-row">
                  <button
                    type="button"
                    className="ffm-user-row__main"
                    onClick={() => handleOpenProfile(u)}
                    aria-label={`View ${primary}'s profile`}
                  >
                    <span className="ffm-user-row__avatar-wrap">
                      <Avatar user={u} name={primary} size="md" />
                      {liveSet.has(u.id) && (
                        <PulseDot
                          size="sm"
                          live
                          label="Playing now"
                          className="ffm-user-row__pulse"
                        />
                      )}
                    </span>
                    <span className="ffm-user-row__text">
                      <span className="ffm-user-row__name">{primary}</span>
                      {displayName && username && (
                        <span className="ffm-user-row__handle">{username}</span>
                      )}
                    </span>
                  </button>

                  {!isSelf && currentUserId && (
                    <button
                      type="button"
                      className={`ffm-user-row__follow${
                        following ? ' ffm-user-row__follow--following' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleFollow(u.id)
                      }}
                      disabled={pending}
                      aria-pressed={following}
                      aria-label={
                        following ? `Unfollow ${primary}` : `Follow ${primary}`
                      }
                    >
                      {following ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CenteredModal>
  )
}

export default FindFriendsModal
