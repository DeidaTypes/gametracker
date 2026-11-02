import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useAuth } from '../../contexts/AuthContext'
import { usePresence } from '../../hooks/usePresence'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { getGameStatus } from '../../services/libraryService'
import {
  BLOCK_CHANGED_EVENT,
  getBlockedIdsArraySync,
} from '../../services/blockService'
import { supabase } from '../../services/supabase'
import { contentSwap } from '../../motion/xMotion'
import Avatar from '../Avatar'
import PulseDot from '../PulseDot'
import './PlayingNowStrip.css'

async function fetchProfiles(userIds) {
  if (!userIds.length) return {}
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds)
  if (error) {
    console.error('[playing-now] fetchProfiles failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((u) => [u.id, u]))
}

function displayLabel(profile) {
  return profile?.display_name || profile?.username || ''
}

export default function PlayingNowStrip() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { playingNow } = usePresence()
  const { reduced } = useMotionPreference()
  const [profiles, setProfiles] = useState({})
  const [profilesReady, setProfilesReady] = useState(true)
  const [blockTick, setBlockTick] = useState(0)

  useEffect(() => {
    const onBlock = () => setBlockTick((n) => n + 1)
    window.addEventListener(BLOCK_CHANGED_EVENT, onBlock)
    return () => window.removeEventListener(BLOCK_CHANGED_EVENT, onBlock)
  }, [])

  const candidates = useMemo(() => {
    void blockTick
    const blocked = new Set(getBlockedIdsArraySync())
    const filtered = playingNow.filter((p) => {
      if (p.userId === user?.id) return false
      if (blocked.has(p.userId)) return false
      return true
    })
    filtered.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return tb - ta
    })
    return filtered.slice(0, 12)
  }, [playingNow, user?.id, blockTick])

  const candidateIdsKey = useMemo(
    () =>
      candidates
        .map((u) => u.userId)
        .sort()
        .join(','),
    [candidates]
  )

  useEffect(() => {
    const ids = candidates.map((u) => u.userId)
    if (!ids.length) {
      setProfiles({})
      setProfilesReady(true)
      return undefined
    }
    setProfilesReady(false)
    let cancelled = false
    fetchProfiles(ids).then((map) => {
      if (!cancelled) {
        setProfiles(map)
        setProfilesReady(true)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIdsKey])

  const visiblePeople = useMemo(() => {
    if (!profilesReady) return []
    return candidates.filter((p) => profiles[p.userId])
  }, [candidates, profiles, profilesReady])

  const openProfile = (profile) => {
    if (profile?.username) navigate(`/user/${encodeURIComponent(profile.username)}`)
    else if (profile?.id) navigate(`/user/id/${encodeURIComponent(profile.id)}`)
  }

  return (
    <AnimatePresence initial={false}>
      {visiblePeople.length > 0 && (
      <motion.section
        key="playing-now-strip"
        className="playing-now-strip"
        aria-label="Playing now"
        {...contentSwap(reduced)}
      >
        <div className="playing-now-strip__label">
          <PulseDot live size="sm" />
          <span>Playing now</span>
        </div>
        <div className="playing-now-strip__row" role="list">
          {visiblePeople.map((entry) => {
            const profile = profiles[entry.userId]
            const yourGame = getGameStatus(entry.gameId) === 'currently'
            return (
              <button
                key={entry.userId}
                type="button"
                className={`playing-now-strip__person${yourGame ? ' playing-now-strip__person--yours' : ''}`}
                role="listitem"
                onClick={() => openProfile(profile)}
              >
                <span className="playing-now-strip__avatar-wrap">
                  <Avatar
                    user={profile}
                    userId={entry.userId}
                    size="lg"
                    className="playing-now-strip__avatar"
                  />
                  {entry.gameImage ? (
                    <img
                      className="playing-now-strip__cover"
                      src={entry.gameImage}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="playing-now-strip__cover playing-now-strip__cover--fallback" aria-hidden="true" />
                  )}
                </span>
                <span className="playing-now-strip__name">{displayLabel(profile)}</span>
                <span className="playing-now-strip__game">
                  {yourGame ? 'Your game' : entry.gameTitle || 'Playing'}
                </span>
              </button>
            )
          })}
        </div>
      </motion.section>
      )}
    </AnimatePresence>
  )
}
