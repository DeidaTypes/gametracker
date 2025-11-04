import React, { useState, useEffect } from 'react'
import GameCard from '../components/GameCard'
import './Wishlist.css'

function Wishlist() {
  const [wishlistGames, setWishlistGames] = useState([])

  useEffect(() => {
    // Load games from localStorage
    const savedWishlist = localStorage.getItem('gameWishlist')
    if (savedWishlist) {
      try {
        setWishlistGames(JSON.parse(savedWishlist))
      } catch (err) {
        console.error('Error loading wishlist:', err)
      }
    }
  }, [])

  return (
    <div className="wishlist-page">
      <div className="wishlist-header">
        <h1>Wishlist</h1>
        <p className="wishlist-subtitle">
          {wishlistGames.length === 0
            ? 'Games you add to your wishlist will appear here'
            : `${wishlistGames.length} ${wishlistGames.length === 1 ? 'game' : 'games'} in your wishlist`}
        </p>
      </div>

      {wishlistGames.length === 0 ? (
        <div className="empty-wishlist">
          <div className="empty-icon">⭐</div>
          <h2>Your wishlist is empty</h2>
          <p>Start adding games you want to play!</p>
        </div>
      ) : (
        <div className="wishlist-content">
          <div className="game-grid">
            {wishlistGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Wishlist

