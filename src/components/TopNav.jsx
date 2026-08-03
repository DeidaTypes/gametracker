import React, { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { HiOutlineSearch } from 'react-icons/hi'
import { SearchX } from 'lucide-react'
import { searchGames } from '../services/searchService'
import { SearchResultSkeletonList } from '../components/skeletons/SearchResultRowSkeleton'
import EmptyState from './EmptyState'
import './TopNav.css'

function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchValue, setSearchValue] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchTimeoutRef = useRef(null)
  const suggestionsRef = useRef(null)

  // Debounced search for suggestions
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Only search if there are at least 2 characters
    if (searchValue.trim().length >= 2) {
      setIsLoadingSuggestions(true)
      
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          console.log('🔍 Fetching suggestions for:', searchValue)
          const results = await searchGames(searchValue.trim(), 8) // Get top 8 suggestions
          setSuggestions(results)
          setShowSuggestions(true)
          setSelectedIndex(-1)
        } catch (error) {
          console.error('Error fetching suggestions:', error)
          setSuggestions([])
        } finally {
          setIsLoadingSuggestions(false)
        }
      }, 300) // 300ms debounce delay
    } else {
      setSuggestions([])
      setShowSuggestions(false)
      setIsLoadingSuggestions(false)
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchValue])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchValue.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`)
      setSearchValue('')
      setShowSuggestions(false)
      setSuggestions([])
    }
  }

  const handleSuggestionClick = (gameName) => {
    setSearchValue(gameName)
    setShowSuggestions(false)
    setSuggestions([])
    navigate(`/search?q=${encodeURIComponent(gameName)}`)
  }

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          e.preventDefault()
          handleSuggestionClick(suggestions[selectedIndex].title)
        }
        break
      case 'Escape':
        setShowSuggestions(false)
        setSelectedIndex(-1)
        break
      default:
        break
    }
  }

  const handleBlur = () => {
    // Delay to allow click on suggestions
    setTimeout(() => {
      setIsSearchFocused(false)
      setShowSuggestions(false)
      setSelectedIndex(-1)
    }, 200)
  }

  // Don't show on onboarding page
  if (location.pathname === '/onboarding') {
    return null
  }

  return (
    <nav className="top-nav">
      <div className="top-nav-container">
        <NavLink to="/" className="top-nav-logo">
          <span className="logo-text">Checkpoint</span>
        </NavLink>

        <form className="top-nav-search" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            placeholder="Search Game"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className={`search-input ${isSearchFocused ? 'focused' : ''}`}
            autoComplete="off"
          />
          <button 
            type="submit" 
            className="search-icon-button"
            aria-label="Search"
          >
            <HiOutlineSearch className="search-icon" />
          </button>

          {/* Suggestions Dropdown */}
          {showSuggestions && (
            <div className="search-suggestions" ref={suggestionsRef}>
              {isLoadingSuggestions ? (
                <SearchResultSkeletonList count={4} />
              ) : suggestions.length > 0 ? (
                suggestions.map((game, index) => (
                  <div
                    key={game.id}
                    className={`suggestion-item ${selectedIndex === index ? 'selected' : ''}`}
                    onClick={() => handleSuggestionClick(game.title)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {game.image && (
                      <img 
                        src={game.image} 
                        alt={game.title}
                        className="suggestion-image"
                      />
                    )}
                    <div className="suggestion-info">
                      <div className="suggestion-title">{game.title}</div>
                      <div className="suggestion-meta">
                        {game.year && <span>{game.year}</span>}
                        {game.genre && <span>{game.genre.split(',')[0]}</span>}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState icon={SearchX} size="inline" body={`No games found for "${searchValue}"`} />
              )}
            </div>
          )}
        </form>

        <div className="top-nav-links">
          <NavLink 
            to="/library" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Library
          </NavLink>
          <NavLink 
            to="/profile" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Profile
          </NavLink>
        </div>
      </div>
    </nav>
  )
}

export default TopNav

