import React, { useState, useEffect } from 'react'
import { getAllLists, addGameToList, isGameInList, getListInfo } from '../services/libraryService'
import './AddToListButton.css'

function AddToListButton({ game }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [lists, setLists] = useState({})
  const [gameInLists, setGameInLists] = useState({})

  useEffect(() => {
    loadLists()
    checkGameInLists()
  }, [game])

  const loadLists = () => {
    const allLists = getAllLists()
    setLists(allLists)
  }

  const checkGameInLists = () => {
    const allLists = getAllLists()
    const inLists = {}
    Object.keys(allLists).forEach(listId => {
      inLists[listId] = isGameInList(listId, game.id)
    })
    setGameInLists(inLists)
  }

  const handleAddToList = (listId) => {
    const success = addGameToList(listId, game)
    if (success) {
      checkGameInLists()
      // Dispatch event to update library page if open
      window.dispatchEvent(new Event('libraryUpdated'))
    }
    setShowDropdown(false)
  }

  const handleToggleDropdown = () => {
    setShowDropdown(!showDropdown)
  }

  if (!game) return null

  return (
    <div className="add-to-list-container">
      <button 
        onClick={handleToggleDropdown}
        className="add-to-list-button"
      >
        + Add to List
      </button>
      
      {showDropdown && (
        <>
          <div 
            className="dropdown-overlay" 
            onClick={() => setShowDropdown(false)}
          />
          <div className="add-to-list-dropdown">
            <div className="dropdown-header">
              <h3>Add to List</h3>
            </div>
            <div className="dropdown-content">
              {/* Default lists */}
              <div className="list-section">
                <div className="section-title">Trackers</div>
                <button
                  className={`list-item ${gameInLists['currently-playing'] ? 'in-list' : ''}`}
                  onClick={() => handleAddToList('currently-playing')}
                  disabled={gameInLists['currently-playing']}
                >
                  <span className="list-icon">🎮</span>
                  <span>Currently Playing</span>
                  {gameInLists['currently-playing'] && <span className="check-mark">✓</span>}
                </button>
                <button
                  className={`list-item ${gameInLists['played'] ? 'in-list' : ''}`}
                  onClick={() => handleAddToList('played')}
                  disabled={gameInLists['played']}
                >
                  <span className="list-icon">✅</span>
                  <span>Played</span>
                  {gameInLists['played'] && <span className="check-mark">✓</span>}
                </button>
                <button
                  className={`list-item ${gameInLists['want-to-play'] ? 'in-list' : ''}`}
                  onClick={() => handleAddToList('want-to-play')}
                  disabled={gameInLists['want-to-play']}
                >
                  <span className="list-icon">⭐</span>
                  <span>Want to Play</span>
                  {gameInLists['want-to-play'] && <span className="check-mark">✓</span>}
                </button>
              </div>

              {/* Custom lists */}
              {Object.keys(lists)
                .filter(listId => listId.startsWith('custom-'))
                .length > 0 && (
                <div className="list-section">
                  <div className="section-title">Custom Lists</div>
                  {Object.keys(lists)
                    .filter(listId => listId.startsWith('custom-'))
                    .map(listId => {
                      const info = getListInfo(listId)
                      if (!info) return null
                      return (
                        <button
                          key={listId}
                          className={`list-item ${gameInLists[listId] ? 'in-list' : ''}`}
                          onClick={() => handleAddToList(listId)}
                          disabled={gameInLists[listId]}
                        >
                          <span className="list-icon">📋</span>
                          <span>{info.name}</span>
                          {gameInLists[listId] && <span className="check-mark">✓</span>}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AddToListButton

