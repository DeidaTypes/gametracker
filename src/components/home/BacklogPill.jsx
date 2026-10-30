import React, { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Check } from 'lucide-react'
import Pressable from '../Pressable'
import { addGameToBacklog, getGameStatus } from '../../services/libraryService'
import { showToast } from '../Toast'
import { hapticImpact } from '../../utils/haptics'
import './BacklogPill.css'

/**
 * Quick-add to Backlog (Want to Play) on someone else's game post.
 * Visible only when the game was not in the viewer's library at mount.
 */
export default function BacklogPill({ game, isOwn = false, className = '' }) {
  const gameId = game?.id
  const eligibleAtMount = useRef(
    !isOwn && gameId != null && getGameStatus(gameId) == null
  ).current
  const [addedHere, setAddedHere] = useState(false)
  const [hiddenElsewhere, setHiddenElsewhere] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!eligibleAtMount || addedHere || gameId == null) return undefined
    const onLibraryUpdated = () => {
      if (getGameStatus(gameId) != null) setHiddenElsewhere(true)
    }
    window.addEventListener('libraryUpdated', onLibraryUpdated)
    return () => window.removeEventListener('libraryUpdated', onLibraryUpdated)
  }, [addedHere, eligibleAtMount, gameId])

  if (!eligibleAtMount && !addedHere) return null
  if (hiddenElsewhere && !addedHere) return null
  if (isOwn || gameId == null) return null

  const inBacklog = addedHere

  const handleClick = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (saving || inBacklog) return
    setSaving(true)
    hapticImpact('Light')
    try {
      await addGameToBacklog({
        id: gameId,
        title: game.title,
        image: game.image,
      })
      if (getGameStatus(gameId) != null) {
        setAddedHere(true)
      } else {
        showToast("Couldn't add to Backlog", 'error', null, null, null, { sub: 'Try again' })
      }
    } catch {
      showToast("Couldn't add to Backlog", 'error', null, null, null, { sub: 'Try again' })
    } finally {
      setSaving(false)
    }
  }

  const rootClass = [
    'backlog-pill',
    inBacklog ? 'backlog-pill--on' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Pressable
      className={rootClass}
      onClick={handleClick}
      disabled={saving || inBacklog}
      aria-disabled={inBacklog || saving || undefined}
      aria-label={inBacklog ? `${game.title} in your Backlog` : `Add ${game.title} to Backlog`}
    >
      {inBacklog ? (
        <Check size={15} strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <BookmarkPlus size={15} strokeWidth={2.25} aria-hidden="true" />
      )}
      <span className="backlog-pill__label">{inBacklog ? 'In Backlog' : 'Backlog'}</span>
    </Pressable>
  )
}
