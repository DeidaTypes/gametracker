import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiX } from 'react-icons/hi'
import './LibraryGameCard.css'

function LibraryGameCard({ game, onDelete, listId }) {
  const navigate = useNavigate()
  const [showDelete, setShowDelete] = useState(false)

  const handleClick = (e) => {
    // Don't navigate if clicking delete button
    if (e.target.closest('.delete-game-button')) {
      return
    }
    navigate(`/game/${game.id}`)
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    if (window.confirm(`Remove "${game.title}" from this list?`)) {
      onDelete(listId, game.id)
    }
  }

  return (
    <div 
      className="library-game-card"
      onClick={handleClick}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <div className="library-game-card-image-container">
        <img 
          src={game.image} 
          alt={game.title}
          className="library-game-card-image"
          onError={(e) => {
            e.target.src = 'https://via.placeholder.com/300x400/1a1a1a/ffffff?text=' + encodeURIComponent(game.title)
          }}
        />
        <div className="library-game-card-gradient-overlay"></div>
        <div className="library-game-card-title-overlay">
          <h3 className="library-game-card-title">{game.title}</h3>
        </div>
        {showDelete && onDelete && (
          <button
            className="delete-game-button"
            onClick={handleDelete}
            aria-label={`Remove ${game.title}`}
            title="Remove from list"
          >
            <HiX />
          </button>
        )}
      </div>
    </div>
  )
}

export default LibraryGameCard

