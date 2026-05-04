import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../services/imageUtils'
import SharedCover from './SharedCover'
import './GameCard.css'

function GameCard({ game }) {
  const navigate = useNavigate()

  const imageUrl = getBestImageUrl(game, 800) || game.image

  const handleClick = () => {
    // Pass the source cover URL through to GameDetail so the hero can
    // show it as the shared-element flight target before the higher-res
    // IGDB cover_big has loaded.
    navigate(`/game/${game.id}`, { state: { coverImage: imageUrl } })
  }

  return (
    <div className="game-card" onClick={handleClick}>
      <div className="game-card-image-container">
        <SharedCover gameId={game.id} imageSrc={imageUrl}>
          <img
            src={imageUrl}
            alt={game.title}
            className="game-card-image"
            onError={(e) => {
              if (e.target.src !== game.image) {
                e.target.src = game.image || 'https://via.placeholder.com/300x400/1a1a1a/ffffff?text=' + encodeURIComponent(game.title)
              } else {
                e.target.src = 'https://via.placeholder.com/300x400/1a1a1a/ffffff?text=' + encodeURIComponent(game.title)
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
    </div>
  )
}

export default GameCard

