import React, { useState, useEffect, useCallback } from 'react'
import GameCard from '../components/GameCard'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Wishlist.css'

function Wishlist() {
  const [wishlistGames, setWishlistGames] = useState([])

  const loadWishlist = useCallback(() => {
    const savedWishlist = localStorage.getItem('gameWishlist')
    if (savedWishlist) {
      try {
        setWishlistGames(JSON.parse(savedWishlist))
      } catch (err) {
        console.error('Error loading wishlist:', err)
      }
    }
  }, [])

  useEffect(() => {
    loadWishlist()
    // Re-read on resume: localStorage can be written by another tab, and on
    // native the WebView isn't remounted so this never re-runs otherwise.
    window.addEventListener(APP_RESUMED_EVENT, loadWishlist)
    return () => window.removeEventListener(APP_RESUMED_EVENT, loadWishlist)
  }, [loadWishlist])

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
          <h2>Your wishlist is empty</h2>
          <p>Start adding games you want to play!</p>
        </div>
      ) : (
        <div className="wishlist-content">
          <div className="games-grid">
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

