import React from 'react'
import { useNavigate } from 'react-router-dom'
import StarRating from '../StarRating'
import SharedCover from '../SharedCover'
import { getBestImageUrl } from '../../services/imageUtils'
import './JustFinishedCard.css'

function JustFinishedCard({ entry }) {
  const navigate = useNavigate()
  const { game, reviewer, rating } = entry
  const fallback = `https://via.placeholder.com/300x450/1a1a1a/ffffff?text=${encodeURIComponent(game.title || 'Game')}`
  const img = getBestImageUrl(game, 600) || game.image

  return (
    <button
      type="button"
      className="just-finished-card"
      onClick={() =>
        navigate(`/game/${game.id}`, { state: { coverImage: img } })
      }
    >
      <div className="just-finished-card__cover">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img
            src={img}
            alt={game.title}
            loading="lazy"
            onError={(e) => { e.currentTarget.src = fallback }}
          />
        </SharedCover>
      </div>
      <div className="just-finished-card__meta">
        <h3 className="just-finished-card__title">{game.title}</h3>
        <span className="just-finished-card__user">
          @{reviewer?.username || 'someone'}
        </span>
        {rating != null && rating > 0 ? (
          <div className="just-finished-card__rating">
            <StarRating rating={rating} size={12} />
          </div>
        ) : null}
      </div>
    </button>
  )
}

export default JustFinishedCard
