import React from 'react'
import GameCard from './GameCard'
import './GameSection.css'

function GameSection({ title, games }) {
  return (
    <div className="game-section">
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
        <a href="#" className="show-all">Show all</a>
      </div>
      <div className="game-grid">
        {games.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    </div>
  )
}

export default GameSection

