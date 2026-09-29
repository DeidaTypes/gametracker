import React, { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import { getActivityLikers, getReviewLikers } from '../services/communityService'
import './LikedBy.css'

const EMPTY = { total: 0, likers: [] }

function likedFlag(likeKey) {
  return String(likeKey || '').split(':')[0] === 'true'
}

/**
 * Fetch who liked a review or activity once on mount, then again whenever
 * the viewer likes / unlikes (`likeKey` changes). Never exposes a loading
 * placeholder — the previous row stays up until the new payload arrives,
 * and total 0 renders nothing.
 *
 * `likeKey` is `${liked}:${count}` from useLikeState / useReactions. The
 * first value for an id is treated as hydration (no optimistic edit). Later
 * flips apply an optimistic row so the caption updates with the pill, then
 * a silent refetch confirms.
 *
 * @param {'review'|'activity'} kind
 * @param {string} id
 * @param {string} likeKey
 * @param {{ id?: string, username?: string, avatarUrl?: string }|null} [viewer]
 */
export function useLikedBy(kind, id, likeKey, viewer) {
  const [data, setData] = useState(EMPTY)
  const hydratedRef = useRef(false)
  const prevLikedRef = useRef(null)
  const viewerId = viewer?.id || null
  const viewerUsername = viewer?.username || null
  const viewerAvatar = viewer?.avatarUrl || null

  useEffect(() => {
    setData(EMPTY)
    hydratedRef.current = false
    prevLikedRef.current = null
  }, [id])

  useEffect(() => {
    if (!id || (kind !== 'review' && kind !== 'activity')) return undefined
    let cancelled = false
    const fetchFn = kind === 'activity' ? getActivityLikers : getReviewLikers
    const isFirst = !hydratedRef.current
    const timer = window.setTimeout(() => {
      fetchFn(id).then((result) => {
        if (cancelled) return
        setData(result || EMPTY)
        hydratedRef.current = true
        prevLikedRef.current = likedFlag(likeKey)
      })
    }, isFirst ? 0 : 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [kind, id, likeKey])

  useEffect(() => {
    if (!hydratedRef.current) {
      prevLikedRef.current = likedFlag(likeKey)
      return
    }
    const nowLiked = likedFlag(likeKey)
    if (prevLikedRef.current === nowLiked) return
    prevLikedRef.current = nowLiked
    setData((prev) => {
      const already = viewerId
        ? prev.likers.some((l) => l.userId === viewerId)
        : false
      if (nowLiked) {
        if (already) return prev
        return {
          total: prev.total + 1,
          likers: [
            {
              userId: viewerId || 'me',
              username: viewerUsername,
              avatarUrl: viewerAvatar,
            },
            ...prev.likers,
          ].slice(0, 3),
        }
      }
      return {
        total: Math.max(0, prev.total - 1),
        likers: viewerId
          ? prev.likers.filter((l) => l.userId !== viewerId)
          : prev.likers,
      }
    })
  }, [likeKey, viewerId, viewerUsername, viewerAvatar])

  return data
}

function likerName(liker) {
  return liker?.username || null
}

/**
 * "Liked by" social-proof row. Renders nothing when total is 0.
 * Not tappable — there is no full liker list yet.
 *
 *   total 1 → "Liked by X"
 *   total 2 → "Liked by X and Y"
 *   total ≥3 → "Liked by X and N others" (N = total − 1)
 */
export default function LikedBy({ total, likers }) {
  const n = Number(total) || 0
  if (n <= 0) return null

  const shown = (likers || []).slice(0, 3)
  const names = shown.map(likerName).filter(Boolean)
  const first = names[0]
  const second = names[1]

  let text
  if (n === 1) {
    text = first ? (
      <>
        Liked by <span className="liked-by__name">{first}</span>
      </>
    ) : (
      'Liked by 1'
    )
  } else if (n === 2) {
    text = first && second ? (
      <>
        Liked by <span className="liked-by__name">{first}</span>
        {' and '}
        <span className="liked-by__name">{second}</span>
      </>
    ) : first ? (
      <>
        Liked by <span className="liked-by__name">{first}</span>
        {' and 1 other'}
      </>
    ) : (
      'Liked by 2'
    )
  } else if (first) {
    text = (
      <>
        Liked by <span className="liked-by__name">{first}</span>
        {` and ${n - 1} others`}
      </>
    )
  } else {
    text = `Liked by ${n}`
  }

  return (
    <div className="liked-by">
      {shown.length > 0 && (
        <div className="liked-by__stack" aria-hidden="true">
          {shown.map((liker, i) => (
            <Avatar
              key={liker.userId || liker.username || i}
              user={{
                userId: liker.userId,
                username: liker.username,
                avatarUrl: liker.avatarUrl,
              }}
              size="xs"
              className="liked-by__avatar"
            />
          ))}
        </div>
      )}
      <p className="liked-by__text">{text}</p>
    </div>
  )
}
