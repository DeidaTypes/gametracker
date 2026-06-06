import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiX } from 'react-icons/hi'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './LibraryGameCard.css'

function LibraryGameCard({ game, onDelete, listId, index = 0 }) {
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

  // Calculate stack offset - each card is slightly offset to the right
  const stackOffset = index * 4; // 4px offset per card (tighter spacing)
  const maxOffset = 24; // Maximum offset to prevent too much spread
  const offset = Math.min(stackOffset, maxOffset);

  return (
    <div 
      className="library-game-card"
      style={{ 
        '--stack-offset': `${offset}px`,
        '--card-index': index,
        zIndex: 100 - index // Higher index = lower z-index (behind)
      }}
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
            e.target.src = COVER_FALLBACK
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

