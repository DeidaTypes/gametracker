import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../../services/imageUtils'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './NewReleaseCard.css'

function formatReleaseDate(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const releaseDay = new Date(d)
  releaseDay.setHours(0, 0, 0, 0)
  const days = Math.round((releaseDay - today) / 86400000)
  if (days <= 0) return 'Out today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function NewReleaseCard({ game }) {
  const navigate = useNavigate()
  const fallback = COVER_FALLBACK
  const img = getBestImageUrl(game, 600) || game.image
  const releaseLabel = formatReleaseDate(game.releaseDate)

  return (
    <Pressable
      className="new-release-card"
      onClick={() =>
        navigate(`/game/${game.id}`, { state: { coverImage: img } })
      }
    >
      <div className="new-release-card__cover">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img
            src={img}
            alt={game.title}
            loading="lazy"
            onError={(e) => { e.currentTarget.src = fallback }}
          />
        </SharedCover>
      </div>
      <div className="new-release-card__meta">
        <h3 className="new-release-card__title">{game.title}</h3>
        {releaseLabel && (
          <span className="new-release-card__date">{releaseLabel}</span>
        )}
      </div>
    </Pressable>
  )
}

export default NewReleaseCard
