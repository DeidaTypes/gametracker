import React, { useState } from 'react'
import { searchGames } from '../services/igdb'
import './CreateListModal.css'

function CreateListModal({ isOpen, onClose, onCreate }) {
  const [listName, setListName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedGames, setSelectedGames] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

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
      setSearchResults(results)
    } catch (err) {
      console.error('Search error:', err)
      setSearchError('Failed to search games. Please try again.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleAddGame = (game) => {
    // Check if game is already selected
    if (selectedGames.find(g => g.id === game.id)) {
      return
    }
    setSelectedGames([...selectedGames, game])
    // Clear search after adding
    setSearchTerm('')
    setSearchResults([])
  }

  const handleRemoveGame = (gameId) => {
    setSelectedGames(selectedGames.filter(g => g.id !== gameId))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (listName.trim() && selectedGames.length > 0) {
      onCreate(listName.trim(), description.trim(), selectedGames)
      // Reset form
      setListName('')
      setDescription('')
      setSelectedGames([])
      setSearchTerm('')
      setSearchResults([])
      onClose()
    }
  }

  const handleCancel = () => {
    // Reset form
    setListName('')
    setDescription('')
    setSelectedGames([])
    setSearchTerm('')
    setSearchResults([])
    setSearchError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content create-list-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create New List</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="list-name">List Name *</label>
            <input
              id="list-name"
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="e.g., Best JRPGs of the 2010s"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="list-description">Description (Optional)</label>
            <textarea
              id="list-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description for this list..."
              rows="3"
            />
          </div>

          <div className="form-group">
            <label>Add Games *</label>
            <p className="form-hint">Select at least one game before saving</p>
            
            {/* Search form */}
            <form onSubmit={handleSearch} className="game-search-form">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search for games to add..."
                className="game-search-input"
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
                        onClick={() => !isSelected && handleAddGame(game)}
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
          </div>

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
                      onClick={() => handleRemoveGame(game.id)}
                      aria-label="Remove game"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
            <button 
              type="submit" 
              className="create-button" 
              disabled={!listName.trim() || selectedGames.length === 0}
            >
              Create List
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateListModal
