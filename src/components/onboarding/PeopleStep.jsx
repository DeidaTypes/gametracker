import React, { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../Avatar'
import { showToast } from '../Toast'
import {
  FOLLOW_CHANGED_EVENT,
  followUser,
  getFollowingSet,
  unfollowUser,
} from '../../services/followService'
import { hapticImpact } from '../../utils/haptics'
import './PeopleStep.css'

/**
 * Step 5, "Find your people". One inset group. Rows are not links: the
 * only action is Follow, which becomes Following and toggles back.
 * Saving a follow happens on the tap, not on Let's play.
 */
export default function PeopleStep({ people }) {
  const [followingMap, setFollowingMap] = useState({})
  const [pendingIds, setPendingIds] = useState(() => new Set())
  const followingRef = useRef({})
  const pendingRef = useRef(new Set())

  const writeFollow = useCallback((id, value) => {
    followingRef.current = { ...followingRef.current, [id]: value }
    setFollowingMap(followingRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    const ids = (people || []).map((p) => p.id).filter(Boolean)
    if (ids.length === 0) return undefined
    getFollowingSet(ids).then((followed) => {
      if (cancelled) return
      setFollowingMap((prev) => {
        const next = { ...prev }
        let changed = false
        for (const id of ids) {
          if (pendingRef.current.has(id) || id in followingRef.current) continue
          next[id] = followed.has(id)
          changed = true
        }
        if (!changed) return prev
        followingRef.current = next
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [people])

  useEffect(() => {
    function onChange(event) {
      const { followeeId, following } = event.detail || {}
      if (!followeeId) return
      if (!(people || []).some((p) => p.id === followeeId)) return
      writeFollow(followeeId, !!following)
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(FOLLOW_CHANGED_EVENT, onChange)
  }, [people, writeFollow])

  const toggle = useCallback(
    async (person) => {
      const id = person?.id
      if (!id || pendingRef.current.has(id)) return
      const was = !!followingRef.current[id]
      pendingRef.current.add(id)
      setPendingIds(new Set(pendingRef.current))
      hapticImpact('Light')
      writeFollow(id, !was)
      try {
        if (was) await unfollowUser(id)
        else await followUser(id)
      } catch (err) {
        writeFollow(id, was)
        console.error('[Onboarding] follow toggle failed:', err)
        showToast("Couldn't update follow", 'error', 4000, null, null, {
          sub: err?.message || 'Try again',
        })
      } finally {
        pendingRef.current.delete(id)
        setPendingIds(new Set(pendingRef.current))
      }
    },
    [writeFollow]
  )

  if (!people?.length) return null

  return (
    <>
      <h1 className="ob-title text-display-l">Find your people</h1>
      <p className="ob-sub text-body">
        Players who love what you love. Follow a few and your Home fills up.
      </p>
      <ul className="ob-people__group">
        {people.map((person) => {
          const name = person.displayName || person.username
          const following = !!followingMap[person.id]
          const pending = pendingIds.has(person.id)
          return (
            <li key={person.id} className="ob-people__row">
              <Avatar
                user={{
                  id: person.id,
                  username: person.username,
                  displayName: person.displayName,
                  avatarUrl: person.avatarUrl,
                }}
                size="md"
              />
              <span className="ob-people__copy">
                <span className="ob-people__name text-body">{name}</span>
                <span className="ob-people__reason text-caption">{person.reason}</span>
              </span>
              <button
                type="button"
                className={`ob-people__follow${following ? ' ob-people__follow--on' : ''}`}
                aria-pressed={following}
                aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
                disabled={pending}
                onClick={() => toggle(person)}
              >
                {following ? 'Following' : 'Follow'}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
