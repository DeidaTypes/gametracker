import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { ShieldOff } from 'lucide-react'
import {
  listBlockedUsers,
  unblockUser,
  BLOCK_CHANGED_EVENT,
} from '../services/blockService'
import { showToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import InlineErrorBanner from '../components/InlineErrorBanner'
import './Settings.css'
import './SettingsBlocked.css'

function initialsOf(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function BlockedUserRow({ row, onUnblock }) {
  const u = row.user || {}
  const display = u.display_name || u.username || 'Unknown user'
  const handle = u.username || null

  const [pending, setPending] = useState(false)

  const handleClick = async () => {
    if (pending) return
    setPending(true)
    try {
      await onUnblock(row.blocked_id)
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="blocked-row">
      <span className="blocked-row__avatar" aria-hidden="true">
        {u.avatar_url ? (
          <img src={u.avatar_url} alt="" />
        ) : (
          <span className="blocked-row__avatar-fallback">
            {initialsOf(display)}
          </span>
        )}
      </span>
      <span className="blocked-row__meta">
        <span className="blocked-row__name">{display}</span>
        {handle && <span className="blocked-row__handle">{handle}</span>}
      </span>
      <button
        type="button"
        className="blocked-row__btn"
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? 'Unblocking…' : 'Unblock'}
      </button>
    </li>
  )
}

function BlockedRowSkeleton() {
  return (
    <li className="blocked-row blocked-row--skeleton" aria-hidden="true">
      <span className="skeleton blocked-sk-avatar" />
      <span className="blocked-row__meta">
        <span className="skeleton blocked-sk-name" />
        <span className="skeleton blocked-sk-handle" />
      </span>
      <span className="skeleton blocked-sk-btn" />
    </li>
  )
}

function SettingsBlocked() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const refresh = useCallback(async () => {
    setLoadError(false)
    try {
      const data = await listBlockedUsers()
      setRows(data)
    } catch (err) {
      console.error('[settings/blocked] load failed:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener(BLOCK_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(BLOCK_CHANGED_EVENT, onChanged)
  }, [refresh])

  const handleUnblock = async (blockedId) => {
    const previousRows = rows
    setRows((prev) => prev.filter((r) => r.blocked_id !== blockedId))
    try {
      await unblockUser(blockedId)
      showToast('User unblocked', 'success', 1800)
    } catch (err) {
      console.error('[settings/blocked] unblock failed:', err)
      setRows(previousRows)
      showToast(err?.message || 'Could not unblock. Try again.', 'error')
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          className="settings-header__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="settings-header__title">Blocked users</h1>
        <span className="settings-header__spacer" aria-hidden="true" />
      </header>

      <div className="settings-page__body">
        {loading ? (
          <ul className="blocked-list" aria-hidden="true">
            <BlockedRowSkeleton />
            <BlockedRowSkeleton />
            <BlockedRowSkeleton />
          </ul>
        ) : loadError ? (
          <div className="blocked-empty">
            <InlineErrorBanner
              message="Couldn't load. Tap to retry."
              onRetry={() => { setLoading(true); refresh() }}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="blocked-empty">
            <EmptyState
              icon={ShieldOff}
              title="You haven't blocked anyone."
              body="Users you block won't see your profile, message you, or interact with your content."
            />
          </div>
        ) : (
          <ul className="blocked-list content-fade-in">
            {rows.map((row) => (
              <BlockedUserRow
                key={row.blocked_id}
                row={row}
                onUnblock={handleUnblock}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default SettingsBlocked
