import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { UserPlus, UserMinus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getProfile, generateDefaultAvatar } from '../services/profileService'
import { getUserByUsername, getUserById } from '../services/userService'
import {
  followUser,
  unfollowUser,
  isFollowing as fetchIsFollowing,
  getFollowers,
  getFollowing,
  FOLLOW_CHANGED_EVENT,
} from '../services/followService'
import { usePresence } from '../hooks/usePresence'
import { shareContent } from '../utils/share'
import { showToast } from './Toast'
import EmptyState from './EmptyState'
import FindFriendsModal from './FindFriendsModal'
import PulseDot from './PulseDot'
import '../pages/UserFollows.css'

/**
 * Shared screen for /user/:username/followers|following AND
 * /user/id/:userId/followers|following. The routes mount this
 * component with a different `mode` prop — keeps row/header/tab/
 * pagination logic in one place.
 *
 * Resolution flow mirrors Profile.jsx: fast-path the signed-in user's
 * local profile when the URL matches, otherwise hit Supabase via
 * getUserByUsername (username route) or getUserById (id route — most
 * real accounts never set a username, so without this fallback the
 * username-only lookup would resolve to nothing and every visit to a
 * usernameless user's Followers/Following list would render "User not
 * found."). We never crash on a missing user — we render an empty
 * list with a friendly message.
 *
 * Pagination is offset/limit based against followService. We keep an
 * `endReached` flag so the IntersectionObserver stops firing once the
 * server returns a short page.
 */
const PAGE_SIZE = 20

function FollowsListPage({ mode }) {
  const navigate = useNavigate()
  const { username, userId: paramUserId } = useParams()
  const { user: authUser } = useAuth()
  const currentUserId = authUser?.id || null

  // Resolved target user (the profile whose followers/following we're listing).
  const [targetUserId, setTargetUserId] = useState(null)
  const [resolvedUser, setResolvedUser] = useState(null)
  const [resolveError, setResolveError] = useState(false)

  // List state
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [endReached, setEndReached] = useState(false)
  const sentinelRef = useRef(null)

  // Per-row "am I following this user?" cache. Built lazily as rows
  // come in so each Follow button can render its initial state without
  // an N+1 spinner storm.
  const [followingMap, setFollowingMap] = useState({})

  // Find Friends user-search popup (replaces the old "go to Explore" CTA).
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)

  // Presence — dots for opted-in followees currently playing something.
  // usePresence filters to the signed-in user's follow graph, so we only
  // ever surface dots for people the current user already follows.
  const { playingNow } = usePresence()
  const liveSet = useMemo(
    () => new Set(playingNow.map((p) => p.userId)),
    [playingNow]
  )

  const decodedUsername = decodeURIComponent(username || '')
  const decodedUserId = decodeURIComponent(paramUserId || '')

  /* ── Resolve username|userId -> user_id ───────────────────── */

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      // /user/id/:userId route — resolve by UUID directly, no username
      // lookup involved. Most real accounts have no username set, so
      // this path is the common case, not just a fallback.
      if (decodedUserId) {
        if (currentUserId && decodedUserId === currentUserId) {
          const localProfile = getProfile()
          if (!cancelled) {
            setTargetUserId(currentUserId)
            setResolvedUser({
              id: currentUserId,
              username: localProfile?.username || '',
              display_name: localProfile?.displayName || '',
              avatar_url: null,
            })
            setResolveError(false)
          }
          return
        }
        try {
          const row = await getUserById(decodedUserId)
          if (cancelled) return
          if (row?.id) {
            setTargetUserId(row.id)
            setResolvedUser(row)
            setResolveError(false)
          } else {
            setResolveError(true)
            setLoading(false)
          }
        } catch (err) {
          console.error('[follows-page] user resolve (by id) failed:', err)
          if (!cancelled) {
            setResolveError(true)
            setLoading(false)
          }
        }
        return
      }

      const localProfile = getProfile()
      const localUsername =
        localProfile?.username || localProfile?.displayName || ''

      // Fast-path: own profile via local blob (avoids a round-trip).
      if (
        currentUserId &&
        decodedUsername &&
        localUsername &&
        decodedUsername.toLowerCase() === localUsername.toLowerCase()
      ) {
        if (!cancelled) {
          setTargetUserId(currentUserId)
          setResolvedUser({
            id: currentUserId,
            username: localProfile.username || '',
            display_name: localProfile.displayName || '',
            avatar_url: null,
          })
          setResolveError(false)
        }
        return
      }

      if (!decodedUsername) {
        if (!cancelled) {
          setResolveError(true)
          setLoading(false)
        }
        return
      }

      try {
        const row = await getUserByUsername(decodedUsername)
        if (cancelled) return
        if (row?.id) {
          setTargetUserId(row.id)
          setResolvedUser(row)
          setResolveError(false)
        } else {
          setResolveError(true)
          setLoading(false)
        }
      } catch (err) {
        console.error('[follows-page] user resolve failed:', err)
        if (!cancelled) {
          setResolveError(true)
          setLoading(false)
        }
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [decodedUsername, decodedUserId, currentUserId])

  /* ── Reset list when target / mode changes ────────────────── */

  useEffect(() => {
    setRows([])
    setPage(0)
    setEndReached(false)
    setFollowingMap({})
    if (targetUserId) {
      setLoading(true)
    }
  }, [targetUserId, mode])

  /* ── Fetch a page ─────────────────────────────────────────── */

  const fetchPage = useCallback(
    async (pageIdx) => {
      if (!targetUserId) return
      const offset = pageIdx * PAGE_SIZE
      const fetcher = mode === 'followers' ? getFollowers : getFollowing
      try {
        const data = await fetcher(targetUserId, PAGE_SIZE, offset)
        const normalized = data.map((row) => {
          const u = mode === 'followers' ? row.follower : row.followee
          return {
            id: u?.id || (mode === 'followers' ? row.follower_id : row.followee_id),
            username: u?.username || '',
            displayName: u?.display_name || '',
            avatarUrl: u?.avatar_url || null,
          }
        })
        setRows((prev) => (pageIdx === 0 ? normalized : [...prev, ...normalized]))
        if (normalized.length < PAGE_SIZE) {
          setEndReached(true)
        }

        // Hydrate the per-row follow state for the *current* user so
        // the Follow button on each row renders correctly. Skip rows
        // that represent the signed-in user themselves.
        if (currentUserId) {
          const ids = normalized
            .map((r) => r.id)
            .filter((id) => id && id !== currentUserId && !(id in followingMap))
          if (ids.length > 0) {
            const results = await Promise.all(ids.map((id) => fetchIsFollowing(id)))
            const nextMap = {}
            ids.forEach((id, i) => {
              nextMap[id] = results[i]
            })
            setFollowingMap((prev) => ({ ...prev, ...nextMap }))
          }
        }
      } catch (err) {
        console.error('[follows-page] page fetch failed:', err)
        setEndReached(true)
      } finally {
        setLoading(false)
      }
    },
    [targetUserId, mode, currentUserId, followingMap]
  )

  // First page on mount / mode-change.
  useEffect(() => {
    if (!targetUserId) return
    if (page !== 0) return
    fetchPage(0)
    // We deliberately don't include fetchPage in the deps to avoid
    // re-triggering when followingMap rebuilds. The intent is "fetch
    // the first page once after target/mode resolves" and
    // page-change-driven fetches are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId, mode])

  // Subsequent pages whenever `page` advances.
  useEffect(() => {
    if (!targetUserId) return
    if (page === 0) return
    fetchPage(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  /* ── Infinite-scroll sentinel ─────────────────────────────── */

  useEffect(() => {
    if (endReached || loading) return undefined
    const node = sentinelRef.current
    if (!node) return undefined
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1)
        }
      },
      { rootMargin: '400px' }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [endReached, loading])

  /* ── Cross-surface follow events ──────────────────────────── */

  // When a follow is toggled anywhere (Profile, Search, even a row on
  // this page), update our local map so every visible Follow button
  // stays consistent.
  useEffect(() => {
    function handleChange(e) {
      const { followeeId, following: newState } = e.detail || {}
      if (!followeeId) return
      setFollowingMap((prev) =>
        followeeId in prev ? { ...prev, [followeeId]: !!newState } : prev
      )
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    return () => {
      window.removeEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    }
  }, [])

  /* ── Per-row follow toggle ────────────────────────────────── */

  const toggleFollow = useCallback(
    async (rowUserId) => {
      if (!rowUserId || !currentUserId || rowUserId === currentUserId) return
      const wasFollowing = !!followingMap[rowUserId]
      setFollowingMap((prev) => ({ ...prev, [rowUserId]: !wasFollowing }))
      try {
        if (wasFollowing) {
          await unfollowUser(rowUserId)
        } else {
          await followUser(rowUserId)
        }
      } catch (err) {
        setFollowingMap((prev) => ({ ...prev, [rowUserId]: wasFollowing }))
        console.error('[follows-page] toggle failed:', err)
        showToast(
          "Couldn't update follow status. Tap to retry.",
          'error',
          4000,
          { label: 'Retry', onClick: () => toggleFollow(rowUserId) }
        )
      }
    },
    [currentUserId, followingMap]
  )

  /* ── Render ───────────────────────────────────────────────── */

  const titleHandle =
    resolvedUser?.username || resolvedUser?.display_name || decodedUsername || 'user'

  const isOwnProfile = currentUserId && targetUserId && currentUserId === targetUserId

  // Build the canonical route segment for the resolved profile. Prefer
  // the username route when one exists (nicer URL); fall back to the
  // /user/id/:userId route for the (common) case where the profile has
  // no username — using titleHandle here would silently 404 since
  // FollowsListPage/Profile only look users up by their real username.
  const profilePathSegment = resolvedUser?.username
    ? encodeURIComponent(resolvedUser.username)
    : targetUserId
      ? `id/${encodeURIComponent(targetUserId)}`
      : encodeURIComponent(decodedUsername || titleHandle)

  const handleShareProfile = async () => {
    const url = `${window.location.origin}/user/${profilePathSegment}`
    await shareContent({
      title: `${titleHandle} on GameTracker`,
      text: 'Check out my GameTracker profile!',
      url,
    })
  }

  const switchTab = (next) => {
    if (next === mode) return
    navigate(`/user/${profilePathSegment}/${next}`, {
      replace: true,
    })
  }

  return (
    <div className="follows-page">
      <header className="follows-page__header">
        <button
          type="button"
          className="follows-page__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="follows-page__title">{titleHandle}</h1>
        <button
          type="button"
          className="follows-page__find"
          onClick={() => setFindFriendsOpen(true)}
          aria-label="Find friends"
        >
          <UserPlus size={20} aria-hidden="true" />
        </button>
      </header>

      <div
        className="follows-page__tabs"
        role="tablist"
        aria-label="Followers and following"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'followers'}
          className={`follows-page__tab${
            mode === 'followers' ? ' follows-page__tab--active' : ''
          }`}
          onClick={() => switchTab('followers')}
        >
          Followers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'following'}
          className={`follows-page__tab${
            mode === 'following' ? ' follows-page__tab--active' : ''
          }`}
          onClick={() => switchTab('following')}
        >
          Following
        </button>
      </div>

      <div className="follows-page__body">
        {resolveError ? (
          <p className="follows-page__error">User not found.</p>
        ) : loading && rows.length === 0 ? (
          <>
            <span className="skeleton follows-page__loading-row" aria-hidden="true" />
            <span className="skeleton follows-page__loading-row" aria-hidden="true" />
            <span className="skeleton follows-page__loading-row" aria-hidden="true" />
          </>
        ) : rows.length === 0 ? (
          mode === 'followers' ? (
            <EmptyState
              icon={UserPlus}
              title="No followers yet."
              body={isOwnProfile ? 'Share your profile to start growing your audience.' : undefined}
              cta={isOwnProfile ? 'Share profile' : undefined}
              onCta={isOwnProfile ? handleShareProfile : undefined}
            />
          ) : (
            <EmptyState
              icon={UserMinus}
              title="Not following anyone yet."
              body={isOwnProfile ? 'Find people to follow and their activity will show up on your home feed.' : undefined}
              cta={isOwnProfile ? 'Find friends' : undefined}
              onCta={isOwnProfile ? () => setFindFriendsOpen(true) : undefined}
            />
          )
        ) : (
          <>
            {rows.map((row) => (
              <FollowRow
                key={row.id}
                row={row}
                currentUserId={currentUserId}
                following={!!followingMap[row.id]}
                live={liveSet.has(row.id)}
                onToggle={() => toggleFollow(row.id)}
                onTap={() => {
                  if (row.username) {
                    navigate(`/user/${encodeURIComponent(row.username)}`)
                  } else if (row.id) {
                    navigate(`/user/id/${encodeURIComponent(row.id)}`)
                  }
                }}
              />
            ))}
            {!endReached && (
              <div
                ref={sentinelRef}
                className="follows-page__sentinel"
                aria-hidden="true"
              />
            )}
          </>
        )}
      </div>

      <FindFriendsModal
        isOpen={findFriendsOpen}
        onClose={() => setFindFriendsOpen(false)}
        currentUserId={currentUserId}
      />
    </div>
  )
}

function FollowRow({ row, currentUserId, following, live = false, onToggle, onTap }) {
  const isSelf = currentUserId && row.id === currentUserId
  const fallback = generateDefaultAvatar(row.displayName || row.username || 'U')
  return (
    <div className="follow-row">
      <button type="button" className="follow-row__main" onClick={onTap}>
        <div className="follow-row__avatar-wrap">
          <div className="follow-row__avatar">
            {row.avatarUrl ? (
              <img src={row.avatarUrl} alt="" loading="lazy" />
            ) : (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  background: fallback.color,
                  color: 'white',
                  fontWeight: 700,
                  fontSize: 16,
                }}
                aria-hidden="true"
              >
                {fallback.initials}
              </span>
            )}
          </div>
          {live && (
            <PulseDot
              size="sm"
              live
              label="Playing now"
              className="follow-row__pulse"
            />
          )}
        </div>
        <div className="follow-row__text">
          <span className="follow-row__username">
            {row.username || row.displayName || 'Unknown'}
          </span>
          {row.displayName && row.username && (
            <span className="follow-row__display">{row.displayName}</span>
          )}
        </div>
      </button>
      {!isSelf && currentUserId && (
        <button
          type="button"
          className={`follow-row__follow${
            following ? ' follow-row__follow--following' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          aria-pressed={following}
          aria-label={
            following
              ? `Unfollow ${row.username || row.displayName}`
              : `Follow ${row.username || row.displayName}`
          }
        >
          {following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  )
}

export default FollowsListPage
