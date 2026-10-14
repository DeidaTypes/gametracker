import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getProfile } from '../services/profileService'
import { getUserById, getUserByUsername } from '../services/userService'
import { getSWR, mutateSWR, peekSWR } from '../services/swrCache'

function handleCacheKey(username) {
  const decoded = decodeURIComponent(username || '').trim().toLowerCase()
  if (!decoded) return null
  return `profile:handle:${decoded}`
}

function peekHandle(username) {
  const key = handleCacheKey(username)
  if (!key) return undefined
  const row = peekSWR(key)
  return row?.id ? row : undefined
}

/**
 * Resolves the profile-scoped route params (`/user/:username/*` and
 * `/user/id/:userId/*`) into a concrete user id, mirroring the resolution
 * FollowsListPage does inline.
 *
 * Most accounts have no username set, so the `/user/id/:userId/*` shape is
 * the common case rather than a fallback — every profile-scoped page needs
 * to handle both, plus the own-profile fast path that answers from the
 * local profile blob without a round-trip.
 *
 * @returns {{
 *   userId: string|null,
 *   user: object|null,        raw users row, or a local-blob shim for self
 *   isOwnProfile: boolean,
 *   resolving: boolean,
 *   notFound: boolean,
 * }}
 */
export function useProfileRouteUser() {
  const { username, userId: paramUserId } = useParams()
  const { user: authUser } = useAuth()
  const currentUserId = authUser?.id || null

  const decodedUsername = decodeURIComponent(username || '')
  const decodedUserId = decodeURIComponent(paramUserId || '')

  const seeded = decodedUsername ? peekHandle(decodedUsername) : undefined
  const routeKey = decodedUserId
    ? `id:${decodedUserId}`
    : decodedUsername
      ? `username:${decodedUsername.toLowerCase()}`
      : 'self'

  const [routeKeySeen, setRouteKeySeen] = useState(routeKey)
  const [state, setState] = useState(() =>
    seeded
      ? { userId: seeded.id, user: seeded, resolving: false, notFound: false }
      : { userId: null, user: null, resolving: true, notFound: false }
  )

  if (routeKeySeen !== routeKey) {
    const next = decodedUsername ? peekHandle(decodedUsername) : undefined
    setRouteKeySeen(routeKey)
    setState(
      next
        ? { userId: next.id, user: next, resolving: false, notFound: false }
        : { userId: null, user: null, resolving: true, notFound: false }
    )
  }

  useEffect(() => {
    let cancelled = false
    const warm = decodedUsername ? peekHandle(decodedUsername) : undefined
    if (!warm) setState((s) => ({ ...s, resolving: true, notFound: false }))

    const selfShim = () => {
      const local = getProfile()
      return {
        id: currentUserId,
        username: local?.username || '',
        display_name: local?.displayName || '',
        avatar_url: null,
      }
    }

    const resolved = (row) => {
      if (cancelled) return
      setState({ userId: row.id, user: row, resolving: false, notFound: false })
    }
    const missing = () => {
      if (cancelled) return
      setState({ userId: null, user: null, resolving: false, notFound: true })
    }

    async function resolve() {
      if (decodedUserId) {
        if (currentUserId && decodedUserId === currentUserId) {
          resolved(selfShim())
          return
        }
        try {
          const row = await getUserById(decodedUserId)
          if (row?.id) {
            if (row.username) mutateSWR(handleCacheKey(row.username), row)
            resolved(row)
          } else missing()
        } catch (err) {
          console.error('[profile-route] resolve by id failed:', err)
          missing()
        }
        return
      }

      const local = getProfile()
      const localUsername = local?.username || local?.displayName || ''
      if (
        currentUserId &&
        decodedUsername &&
        localUsername &&
        decodedUsername.toLowerCase() === localUsername.toLowerCase()
      ) {
        resolved(selfShim())
        return
      }

      if (!decodedUsername) {
        // No params at all — the route is the signed-in user's own.
        if (currentUserId) resolved(selfShim())
        else missing()
        return
      }

      try {
        const row = await getSWR(
          handleCacheKey(decodedUsername),
          async () => {
            const found = await getUserByUsername(decodedUsername)
            if (!found?.id) {
              const missingRow = new Error('profile not found')
              missingRow.code = 'NOT_FOUND'
              throw missingRow
            }
            return found
          },
          { ttlMs: 60_000 }
        )
        if (row?.id) resolved(row)
        else if (!warm) missing()
      } catch (err) {
        if (warm) return
        console.error('[profile-route] resolve by username failed:', err)
        missing()
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [decodedUsername, decodedUserId, currentUserId])

  return {
    ...state,
    isOwnProfile: !!state.userId && state.userId === currentUserId,
  }
}

export default useProfileRouteUser
