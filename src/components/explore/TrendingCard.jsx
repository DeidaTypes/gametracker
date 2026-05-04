import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../../services/imageUtils'
import SharedCover from '../SharedCover'
import './TrendingCard.css'

const STATUS_VERB = {
  played: 'finished',
  currently: 'are playing',
  want: 'added',
}

function TrendingCard({ entry }) {
  const navigate = useNavigate()
  const { game, peopleCount, mostCommonStatus } = entry
  const verb = STATUS_VERB[mostCommonStatus] || 'logged'
  const fallback = `https://via.placeholder.com/300x450/1a1a1a/ffffff?text=${encodeURIComponent(game.title || 'Game')}`
  const img = getBestImageUrl(game, 600) || game.image

  return (
    <button
      type="button"
      className="trending-card"
      onClick={() =>
        navigate(`/game/${game.id}`, { state: { coverImage: img } })
      }
    >
      <div className="trending-card__cover">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img
            src={img}
            alt={game.title}
            loading="lazy"
            onError={(e) => { e.currentTarget.src = fallback }}
          />
        </SharedCover>
      </div>
      <div className="trending-card__meta">
        <h3 className="trending-card__title">{game.title}</h3>
        <span className="trending-card__badge">
          {peopleCount} {peopleCount === 1 ? 'person' : 'people'} {verb}
        </span>
      </div>
    </button>
  )
}

export default TrendingCard
