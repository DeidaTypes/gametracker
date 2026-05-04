import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import CreateListModal from '../components/CreateListModal'
import AddGamesModal from '../components/AddGamesModal'
import EmptyState from '../components/EmptyState'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { showToast } from '../components/Toast'
import { HiDotsVertical, HiPlus } from 'react-icons/hi'
import {
  initializeLibrary,
  getGamesFromList,
  addGameToList as lsAddGameToList,
} from '../services/libraryService'
import {
  getListsForUser,
  createList,
  addGameToList,
  deleteList,
} from '../services/listService'
import './Library.css'

// Mandatory tracker lists that live in localStorage (not Supabase)
const MANDATORY_LISTS = [
  { id: 'currently-playing', name: 'Currently Playing' },
  { id: 'played', name: 'Played' },
  { id: 'want-to-play', name: 'Want to Play' },
]

function Library() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [trackerLists, setTrackerLists] = useState({})
  const [customLists, setCustomLists] = useState([])
  const [isLoadingCustom, setIsLoadingCustom] = useState(true)
  const [trackersRef] = useAutoAnimateMotion()
  const [customListsRef] = useAutoAnimateMotion()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddGamesModal, setShowAddGamesModal] = useState(false)
  const [addGamesListId, setAddGamesListId] = useState(null)
  const [addGamesListName, setAddGamesListName] = useState('')
  const [showDeleteMenu, setShowDeleteMenu] = useState(null)

  // Load tracker lists from localStorage
  const loadTrackerLists = useCallback(() => {
    initializeLibrary()
    const snap = {}
    for (const { id } of MANDATORY_LISTS) {
      snap[id] = { games: getGamesFromList(id) }
    }
    setTrackerLists(snap)
  }, [])

  // Load custom lists from Supabase
  const loadCustomLists = useCallback(async () => {
    if (!user?.id) {
      setCustomLists([])
      setIsLoadingCustom(false)
      return
    }
    setIsLoadingCustom(true)
    try {
      const lists = await getListsForUser(user.id)
      setCustomLists(lists)
    } catch (err) {
      console.error('[library] failed to load custom lists:', err)
      setCustomLists([])
    } finally {
      setIsLoadingCustom(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadTrackerLists()
    loadCustomLists()

    const handleUpdate = () => {
      loadTrackerLists()
      loadCustomLists()
    }
    window.addEventListener('libraryUpdated', handleUpdate)
    return () => window.removeEventListener('libraryUpdated', handleUpdate)
  }, [loadTrackerLists, loadCustomLists])

  // Create list → Supabase, then add initial games, then navigate
  const handleCreateList = async (listName, description, initialGames) => {
    const listId = await createList({ name: listName, description, isPublic: true })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  const handleListClick = (listId, e) => {
    if (e.target.closest('.list-item-actions')) return
    navigate(`/list/${listId}`)
  }

  const handleAddGamesClick = (listId, listName, e) => {
    e.stopPropagation()
    setAddGamesListId(listId)
    setAddGamesListName(listName || '')
    setShowAddGamesModal(true)
    setShowDeleteMenu(null)
  }

  const handleDeleteClick = async (listId, e) => {
    e.stopPropagation()
    setShowDeleteMenu(null)
    if (!window.confirm('Delete this list? This cannot be undone.')) return
    try {
      await deleteList(listId)
      setCustomLists((prev) => prev.filter((l) => l.id !== listId))
      window.dispatchEvent(new Event('libraryUpdated'))
    } catch {
      showToast('Failed to delete list', 'error')
    }
  }

  const handleMenuClick = (listId, e) => {
    e.stopPropagation()
    setShowDeleteMenu(showDeleteMenu === listId ? null : listId)
  }

  useEffect(() => {
    if (!showDeleteMenu) return
    const close = () => setShowDeleteMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showDeleteMenu])

  // Compute duplicate game ids for SharedCover so the same game cover in
  // two different visible list previews doesn't trigger a conflicting
  // shared-element animation.
  const duplicateIds = useMemo(() => {
    const visiblePreviews = []
    for (const { id } of MANDATORY_LISTS) {
      const games = trackerLists[id]?.games || []
      visiblePreviews.push(games.length > 5 ? games.slice(0, 4) : games.slice(0, 5))
    }
    for (const list of customLists) {
      const games = list.games || []
      visiblePreviews.push(games.length > 5 ? games.slice(0, 4) : games.slice(0, 5))
    }
    return findDuplicateGameIds(...visiblePreviews)
  }, [trackerLists, customLists])

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderTrackerPreview = ({ id, name }) => {
    const games = getGamesFromList(id)
    const hasPill = games.length > 5
    const visibleGames = hasPill ? games.slice(0, 4) : games.slice(0, 5)
    const pillCount = games.length - 4

    return (
      <div key={id} className="library-list-item">
        <div className="list-item-inner">
          <div
            className="list-item-header"
            onClick={(e) => handleListClick(id, e)}
          >
            <div className="list-item-title-col">
              <h3 className="list-item-name">{name}</h3>
              <p className="list-item-count">
                {games.length} {games.length === 1 ? 'game' : 'games'}
              </p>
            </div>
            <div className="list-item-preview">
              {visibleGames.length > 0 ? (
                <div className="preview-covers">
                  {visibleGames.map((game, idx) => (
                    <div
                      key={game.id}
                      className={`preview-cover${idx === 0 ? ' preview-cover--first' : ''}`}
                    >
                      {game.image ? (
                        <SharedCover gameId={game.id} imageSrc={game.image}>
                          <img src={game.image} alt={game.title} className="preview-cover-image" />
                        </SharedCover>
                      ) : (
                        <div className="preview-cover-placeholder">
                          {game.title?.charAt(0) || '?'}
                        </div>
                      )}
                    </div>
                  ))}
                  {hasPill && (
                    <div className="preview-more-indicator">+{pillCount}</div>
                  )}
                </div>
              ) : (
                <div className="preview-empty">No games yet</div>
              )}
            </div>
          </div>
          <div className="list-item-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="add-games-button"
              onClick={(e) => handleAddGamesClick(id, name, e)}
              title="Add games"
            >
              <HiPlus />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderCustomListPreview = (list) => {
    const { id, name, description, games = [], gameCount } = list
    const hasPill = gameCount > 5
    const visibleGames = hasPill ? games.slice(0, 4) : games.slice(0, 5)
    const pillCount = gameCount - 4
    const isMenuOpen = showDeleteMenu === id

    return (
      <div key={id} className="library-list-item">
        <div className="list-item-inner">
          <div
            className="list-item-header"
            onClick={(e) => handleListClick(id, e)}
          >
            <div className="list-item-title-col list-item-title-col--custom">
              <h3 className="list-item-name">{name}</h3>
              {description && (
                <p className="list-item-description">{description}</p>
              )}
              <p className="list-item-count">
                {gameCount} {gameCount === 1 ? 'game' : 'games'}
              </p>
            </div>
            <div className="list-item-preview">
              {visibleGames.length > 0 ? (
                <div className="preview-covers">
                  {visibleGames.map((game, idx) => (
                    <div
                      key={game.id}
                      className={`preview-cover${idx === 0 ? ' preview-cover--first' : ''}`}
                    >
                      {game.image ? (
                        <SharedCover gameId={game.id} imageSrc={game.image}>
                          <img src={game.image} alt={game.title} className="preview-cover-image" />
                        </SharedCover>
                      ) : (
                        <div className="preview-cover-placeholder">
                          {game.title?.charAt(0) || '?'}
                        </div>
                      )}
                    </div>
                  ))}
                  {hasPill && (
                    <div className="preview-more-indicator">+{pillCount}</div>
                  )}
                </div>
              ) : (
                <div className="preview-empty">No games yet</div>
              )}
            </div>
          </div>

          <div className="list-item-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="add-games-button"
              onClick={(e) => handleAddGamesClick(id, name, e)}
              title="Add games"
            >
              <HiPlus />
            </button>
            <div className="menu-container">
              <button
                className="menu-button"
                onClick={(e) => handleMenuClick(id, e)}
                title="More options"
              >
                <HiDotsVertical />
              </button>
              {isMenuOpen && (
                <div className="menu-dropdown">
                  <button
                    className="menu-item delete-item"
                    onClick={(e) => handleDeleteClick(id, e)}
                  >
                    Delete List
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="library-page">
        <div className="library-header">
          <div className="library-header-top">
            <div>
              <h1>Your Library</h1>
              <p className="library-subtitle">Manage your game lists and trackers</p>
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
          {/* Tracker lists (localStorage) */}
          <div className="library-section">
            <h2 className="section-title">Trackers</h2>
            <div className="library-lists" ref={trackersRef}>
              {MANDATORY_LISTS.map(renderTrackerPreview)}
            </div>
          </div>

          {/* Custom lists (Supabase) */}
          <div className="library-section">
            <h2 className="section-title">Custom Lists</h2>
            {isLoadingCustom ? (
              <div className="library-loading">Loading…</div>
            ) : customLists.length > 0 ? (
              <div className="library-lists" ref={customListsRef}>
                {customLists.map(renderCustomListPreview)}
              </div>
            ) : (
              <EmptyState
                variant="lists"
                copy={user ? 'No custom lists yet — create one to organise your games' : 'Sign in to create and save lists'}
                cta={user ? 'Create a list' : undefined}
                onCta={user ? () => setShowCreateModal(true) : undefined}
              />
            )}
          </div>
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
            setAddGamesListName('')
          }}
          listId={addGamesListId}
          listName={addGamesListName}
          onAddGames={(games) => {
            // Tracker list batch-save (libraryService still handles these)
            if (addGamesListId && games?.length) {
              games.forEach((g) => lsAddGameToList(addGamesListId, g))
              window.dispatchEvent(new Event('libraryUpdated'))
            }
          }}
        />
      </div>
    </SharedCoverScope>
  )
}

export default Library
