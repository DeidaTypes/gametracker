import React, { useState } from 'react'
import { searchGames } from '../services/igdb'
import { isGameInList } from '../services/libraryService'
import './AddGamesModal.css'

function AddGamesModal({ isOpen, onClose, listId, onAddGames }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selectedGames, setSelectedGames] = useState([])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchTerm.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    setSearchError(null)

    try {
      const results = await searchGames(searchTerm.trim(), 20)
      // Filter out games already in the list
      const availableResults = results.filter(game => !isGameInList(listId, game.id))
      setSearchResults(availableResults)
    } catch (err) {
      console.error('Search error:', err)
      setSearchError('Failed to search games. Please try again.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleToggleGame = (game) => {
    const isSelected = selectedGames.find(g => g.id === game.id)
    if (isSelected) {
      setSelectedGames(selectedGames.filter(g => g.id !== game.id))
    } else {
      setSelectedGames([...selectedGames, game])
    }
  }

  const handleAdd = () => {
    if (selectedGames.length > 0) {
      onAddGames(selectedGames)
      // Reset form
      setSearchTerm('')
      setSearchResults([])
      setSelectedGames([])
      setSearchError(null)
      onClose()
    }
  }

  const handleCancel = () => {
    // Reset form
    setSearchTerm('')
    setSearchResults([])
    setSelectedGames([])
    setSearchError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content add-games-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Games to List</h2>
        
        {/* Search form */}
        <form onSubmit={handleSearch} className="game-search-form">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search for games to add..."
            className="game-search-input"
            autoFocus
          />
          <button type="submit" className="search-button" disabled={isSearching}>
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {searchError && (
          <div className="search-error">{searchError}</div>
        )}

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="search-results-container">
            <div className="search-results-list">
              {searchResults.map((game) => {
                const isSelected = selectedGames.find(g => g.id === game.id)
                return (
                  <div
                    key={game.id}
                    className={`search-result-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleGame(game)}
                  >
                    {game.image && (
                      <img src={game.image} alt={game.title} className="result-game-image" />
                    )}
                    <div className="result-game-info">
                      <div className="result-game-title">{game.title}</div>
                      {game.year && (
                        <div className="result-game-year">{game.year}</div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="selected-indicator">✓</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Selected games preview */}
        {selectedGames.length > 0 && (
          <div className="selected-games-section">
            <label>Selected Games ({selectedGames.length})</label>
            <div className="selected-games-list">
              {selectedGames.map((game) => (
                <div key={game.id} className="selected-game-item">
                  {game.image && (
                    <img src={game.image} alt={game.title} className="selected-game-image" />
                  )}
                  <div className="selected-game-title">{game.title}</div>
                  <button
                    type="button"
                    className="remove-game-button"
                    onClick={() => handleToggleGame(game)}
                    aria-label="Remove game"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {searchResults.length === 0 && !isSearching && searchTerm && (
          <div className="no-results">
            <p>No games found. Try a different search term.</p>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={handleCancel} className="cancel-button">
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleAdd}
            className="add-button" 
            disabled={selectedGames.length === 0}
          >
            Add {selectedGames.length > 0 ? `(${selectedGames.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddGamesModal

