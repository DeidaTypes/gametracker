import React, { useState } from 'react'
import { searchGames } from '../services/igdb'
import { addToSearchHistory } from '../services/userPreferences'
import GameCard from '../components/GameCard'
import './Search.css'

function Search() {
  const [searchTerm, setSearchTerm] = useState('')
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchTerm.trim()) return

    setLoading(true)
    setError(null)
    setHasSearched(true)

    try {
      const results = await searchGames(searchTerm, 50)
      setGames(results)
      // Track search in user preferences
      addToSearchHistory(searchTerm)
    } catch (err) {
      console.error('Search error:', err)
      setError('Failed to search games. Please check your IGDB API credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="search-page">
      <div className="search-header">
        <h1>Search Games</h1>
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Search for games..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-button" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Searching games...</p>
        </div>
      )}

      {error && (
        <div className="error-container">
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && hasSearched && games.length === 0 && (
        <div className="no-results">
          <p>No games found for "{searchTerm}"</p>
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="search-results">
          <h2 className="results-title">
            {games.length} {games.length === 1 ? 'game' : 'games'} found
          </h2>
          <div className="game-grid">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}

      {!hasSearched && (
        <div className="search-placeholder">
          <p>Enter a game name above to start searching</p>
        </div>
      )}
    </div>
  )
}

export default Search

