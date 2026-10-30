import React, { useState, useEffect, useCallback } from 'react'
import { Heart } from 'lucide-react'
import GameCard from '../components/GameCard'
import EmptyState from '../components/EmptyState'
import { APP_RESUMED_EVENT, isLongAbsence } from '../hooks/useAppResume'
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
    // Re-read on a long absence: localStorage can be written by another tab,
    // and on native the WebView isn't remounted so this never re-runs otherwise.
    const onResume = (e) => {
      if (!isLongAbsence(e)) return
      loadWishlist()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
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
        <EmptyState
          icon={Heart}
          title="Your wishlist is empty"
          body="Start adding games to your wishlist!"
        />
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

