import React, { useState, useEffect } from 'react'
import GameCard from '../components/GameCard'
import CreateListModal from '../components/CreateListModal'
import { 
  initializeLibrary, 
  getAllLists, 
  getGamesFromList, 
  createCustomList,
  getListInfo 
} from '../services/libraryService'
import './Library.css'

function Library() {
  const [activeTab, setActiveTab] = useState('currently-playing')
  const [lists, setLists] = useState({})
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => {
    // Initialize library if needed
    initializeLibrary()
    loadLists()

    // Listen for library updates
    const handleLibraryUpdate = () => {
      loadLists()
    }
    window.addEventListener('libraryUpdated', handleLibraryUpdate)

    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdate)
    }
  }, [])

  const loadLists = () => {
    const allLists = getAllLists()
    setLists(allLists)
  }

  const handleCreateList = (listName) => {
    const listId = createCustomList(listName)
    loadLists()
    // Switch to the newly created list
    setActiveTab(listId)
  }

  const currentGames = getGamesFromList(activeTab)
  const listInfo = getListInfo(activeTab)

  return (
    <div className="library-page">
      <div className="library-header">
        <div className="library-header-top">
          <div>
            <h1>Your Library</h1>
            <p className="library-subtitle">
              {currentGames.length} {currentGames.length === 1 ? 'game' : 'games'} in this list
            </p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="create-list-button"
            title="Create new list"
          >
            + Create List
          </button>
        </div>

        <div className="library-tabs">
          <button
            className={`library-tab ${activeTab === 'currently-playing' ? 'active' : ''}`}
            onClick={() => setActiveTab('currently-playing')}
          >
            <span className="tab-icon">🎮</span>
            <span>Currently Playing</span>
            <span className="tab-count">({getGamesFromList('currently-playing').length})</span>
          </button>
          <button
            className={`library-tab ${activeTab === 'played' ? 'active' : ''}`}
            onClick={() => setActiveTab('played')}
          >
            <span className="tab-icon">✅</span>
            <span>Played</span>
            <span className="tab-count">({getGamesFromList('played').length})</span>
          </button>
          <button
            className={`library-tab ${activeTab === 'want-to-play' ? 'active' : ''}`}
            onClick={() => setActiveTab('want-to-play')}
          >
            <span className="tab-icon">⭐</span>
            <span>Want to Play</span>
            <span className="tab-count">({getGamesFromList('want-to-play').length})</span>
          </button>
          
          {/* Custom lists */}
          {Object.keys(lists)
            .filter(listId => listId.startsWith('custom-'))
            .map(listId => {
              const info = getListInfo(listId)
              if (!info) return null
              return (
                <button
                  key={listId}
                  className={`library-tab ${activeTab === listId ? 'active' : ''}`}
                  onClick={() => setActiveTab(listId)}
                >
                  <span className="tab-icon">📋</span>
                  <span>{info.name}</span>
                  <span className="tab-count">({getGamesFromList(listId).length})</span>
                </button>
              )
            })}
        </div>
      </div>

      {currentGames.length === 0 ? (
        <div className="empty-library">
          <div className="empty-icon">
            {activeTab === 'currently-playing' && '🎮'}
            {activeTab === 'played' && '✅'}
            {activeTab === 'want-to-play' && '⭐'}
            {activeTab.startsWith('custom-') && '📋'}
          </div>
          <h2>
            {listInfo ? `No games in "${listInfo.name}"` : 'This list is empty'}
          </h2>
          <p>
            {activeTab === 'currently-playing' && 'Start tracking games you\'re currently playing!'}
            {activeTab === 'played' && 'Add games you\'ve completed or played!'}
            {activeTab === 'want-to-play' && 'Add games you want to play in the future!'}
            {activeTab.startsWith('custom-') && 'Add games to this list to get started!'}
          </p>
        </div>
      ) : (
        <div className="library-content">
          <div className="game-grid">
            {currentGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}

      <CreateListModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateList}
      />
    </div>
  )
}

export default Library

