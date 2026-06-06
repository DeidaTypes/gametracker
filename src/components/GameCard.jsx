import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../services/imageUtils'
import SharedCover from './SharedCover'
import Pressable from './Pressable'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './GameCard.css'

function GameCard({ game }) {
  const navigate = useNavigate()

  const imageUrl = getBestImageUrl(game, 800) || game.image

  const handleClick = () => {
    navigate(`/game/${game.id}`, { state: { coverImage: imageUrl } })
  }

  return (
    <Pressable
      as="div"
      role="button"
      tabIndex={0}
      className="game-card"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      aria-label={`View ${game.title}`}
    >
      <div className="game-card-image-container">
        <SharedCover gameId={game.id} imageSrc={imageUrl}>
          <img
            src={imageUrl}
            alt={game.title}
            className="game-card-image"
            onError={(e) => {
              if (e.target.src !== game.image && game.image) {
                e.target.src = game.image
              } else {
                e.target.src = COVER_FALLBACK
              }
            }}
          />
        </SharedCover>
        <div className="game-card-gradient-overlay"></div>
        <div className="game-card-title-overlay">
          <h3 className="game-card-title">{game.title}</h3>
        </div>
        <div className="game-card-hover-overlay">
          <div className="play-indicator">View Details →</div>
        </div>
      </div>
    </Pressable>
  )
}

export default GameCard

