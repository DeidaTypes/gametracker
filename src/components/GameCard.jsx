import React from 'react'
import { useNavigate } from 'react-router-dom'
import './GameCard.css'

function GameCard({ game }) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/game/${game.id}`)
  }

  return (
    <div className="game-card" onClick={handleClick}>
      <div className="game-card-image-container">
        <img 
          src={game.image} 
          alt={game.title}
          className="game-card-image"
          onError={(e) => {
            e.target.src = 'https://via.placeholder.com/300x400/1a1a1a/ffffff?text=' + encodeURIComponent(game.title)
          }}
        />
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

