import React, { useState, useEffect } from 'react'
import LibraryGameCard from '../components/LibraryGameCard'
import CreateListModal from '../components/CreateListModal'
import AddGamesModal from '../components/AddGamesModal'
import { HiDotsVertical, HiPlus } from 'react-icons/hi'
import { 
  initializeLibrary, 
  getAllLists, 
  getGamesFromList, 
  createCustomList,
  getListInfo,
  deleteCustomList,
  addGameToList,
  removeGameFromList
} from '../services/libraryService'
import './Library.css'

function Library() {
  const [selectedListId, setSelectedListId] = useState(null)
  const [lists, setLists] = useState({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddGamesModal, setShowAddGamesModal] = useState(false)
  const [addGamesListId, setAddGamesListId] = useState(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(null) // Track which list's menu is open

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

  const handleCreateList = (listName, description, initialGames) => {
    const listId = createCustomList(listName, description, initialGames)
    loadLists()
    // Switch to the newly created list
    setSelectedListId(listId)
  }

  const handleListClick = (listId, e) => {
    // Don't toggle if clicking on action buttons
    if (e.target.closest('.list-item-actions')) {
      return
    }
    // Toggle: if clicking the same list, close it; otherwise open the clicked list
    setSelectedListId(selectedListId === listId ? null : listId)
  }

  const handleAddGamesClick = (listId, e) => {
    e.stopPropagation()
    setAddGamesListId(listId)
    setShowAddGamesModal(true)
    setShowDeleteMenu(null) // Close any open menu
  }

  const handleAddGames = (games) => {
    if (addGamesListId) {
      games.forEach(game => {
        addGameToList(addGamesListId, game)
      })
      loadLists()
      window.dispatchEvent(new Event('libraryUpdated'))
    }
  }

  const handleDeleteGame = (listId, gameId) => {
    removeGameFromList(listId, gameId)
    loadLists()
    window.dispatchEvent(new Event('libraryUpdated'))
  }

  const handleDeleteClick = (listId, e) => {
    e.stopPropagation()
    setShowDeleteMenu(null) // Close menu
    if (window.confirm('Are you sure you want to delete this list? This action cannot be undone.')) {
      const success = deleteCustomList(listId)
      if (success) {
        loadLists()
        if (selectedListId === listId) {
          setSelectedListId(null) // Close if it was open
        }
        window.dispatchEvent(new Event('libraryUpdated'))
      }
    }
  }

  const handleMenuClick = (listId, e) => {
    e.stopPropagation()
    setShowDeleteMenu(showDeleteMenu === listId ? null : listId)
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowDeleteMenu(null)
    }
    if (showDeleteMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showDeleteMenu])

  // Get mandatory lists
  const mandatoryLists = [
    { id: 'currently-playing', name: 'Currently Playing' },
    { id: 'played', name: 'Played' },
    { id: 'want-to-play', name: 'Want to Play' },
  ]

  // Get custom lists
  const customListIds = Object.keys(lists).filter(id => id.startsWith('custom-'))

  // Render list preview item
  const renderListPreview = (listId, listName) => {
    const games = getGamesFromList(listId)
    const listInfo = getListInfo(listId)
    const previewGames = games.slice(0, 8) // Show up to 8 games in preview
    const isSelected = selectedListId === listId
    const isCustom = listId.startsWith('custom-')
    const isMenuOpen = showDeleteMenu === listId

    return (
      <div 
        key={listId} 
        className={`library-list-item ${isSelected ? 'expanded' : ''}`}
      >
        <div 
          className="list-item-header"
          onClick={(e) => handleListClick(listId, e)}
        >
          <div className="list-item-info">
            <h3 className="list-item-name">{listName}</h3>
            {listInfo?.description && (
              <p className="list-item-description">{listInfo.description}</p>
            )}
            <p className="list-item-count">
              {games.length} {games.length === 1 ? 'game' : 'games'}
            </p>
          </div>
          <div className="list-item-preview">
            {previewGames.length > 0 ? (
              <div className="preview-covers">
                {previewGames.map((game) => (
                  <div key={game.id} className="preview-cover">
                    {game.image ? (
                      <img 
                        src={game.image} 
                        alt={game.title}
                        className="preview-cover-image"
                      />
                    ) : (
                      <div className="preview-cover-placeholder">
                        {game.title?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                ))}
                {games.length > 8 && (
                  <div className="preview-more-indicator">
                    +{games.length - 8}
                  </div>
                )}
              </div>
            ) : (
              <div className="preview-empty">No games yet</div>
            )}
          </div>
          <div className="list-item-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="add-games-button"
              onClick={(e) => handleAddGamesClick(listId, e)}
              title="Add games"
            >
              <HiPlus />
            </button>
            {isCustom && (
              <div className="menu-container">
                <button
                  className="menu-button"
                  onClick={(e) => handleMenuClick(listId, e)}
                  title="More options"
                >
                  <HiDotsVertical />
                </button>
                {isMenuOpen && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item delete-item"
                      onClick={(e) => handleDeleteClick(listId, e)}
                    >
                      Delete List
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expanded view - show all games */}
        {isSelected && games.length > 0 && (
          <div className="list-item-content">
            <div className="game-grid">
              {games.map((game) => (
                <LibraryGameCard 
                  key={game.id} 
                  game={game} 
                  listId={listId}
                  onDelete={handleDeleteGame}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state for expanded view */}
        {isSelected && games.length === 0 && (
          <div className="list-item-content">
            <div className="empty-list-expanded">
              <p>
                {listId === 'currently-playing' && 'Start tracking games you\'re currently playing!'}
                {listId === 'played' && 'Add games you\'ve completed or played!'}
                {listId === 'want-to-play' && 'Add games you want to play in the future!'}
                {listId.startsWith('custom-') && 'Add games to this list to get started!'}
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="library-page">
      <div className="library-header">
        <div className="library-header-top">
          <div>
            <h1>Your Library</h1>
            <p className="library-subtitle">
              Manage your game lists and trackers
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
      </div>

      <div className="library-lists-container">
        {/* Mandatory lists */}
        <div className="library-section">
          <h2 className="section-title">Trackers</h2>
          <div className="library-lists">
            {mandatoryLists.map(({ id, name }) => renderListPreview(id, name))}
          </div>
        </div>

        {/* Custom lists */}
        {customListIds.length > 0 && (
          <div className="library-section">
            <h2 className="section-title">Custom Lists</h2>
            <div className="library-lists">
              {customListIds.map(listId => {
                const info = getListInfo(listId)
                if (!info) return null
                return renderListPreview(listId, info.name)
              })}
            </div>
          </div>
        )}
      </div>

      <CreateListModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateList}
      />

      <AddGamesModal
        isOpen={showAddGamesModal}
        onClose={() => {
          setShowAddGamesModal(false)
          setAddGamesListId(null)
        }}
        listId={addGamesListId}
        onAddGames={handleAddGames}
      />
    </div>
  )
}

export default Library
