import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getProfile } from '../services/profileService'
import { getUserById, getUserByUsername } from '../services/userService'

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

  const [state, setState] = useState({
    userId: null,
    user: null,
    resolving: true,
    notFound: false,
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, resolving: true, notFound: false }))

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
          if (row?.id) resolved(row)
          else missing()
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
        const row = await getUserByUsername(decodedUsername)
        if (row?.id) resolved(row)
        else missing()
      } catch (err) {
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
