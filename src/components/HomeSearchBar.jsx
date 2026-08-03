import React, { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, SearchX } from 'lucide-react'
import { useSearch } from '../hooks/useSearch'
import { addRecent } from '../utils/recentSearches'
import { getSizedImageUrl } from '../services/imageUtils'
import CoverPlaceholder from './explore/CoverPlaceholder'
import EmptyState from './EmptyState'
import './HomeSearchBar.css'

/**
 * HomeSearchBar — the Home screen's INLINE search entry point.
 *
 * Unlike the Discover search button (which navigates to the full-screen
 * SearchOverlay), this bar searches in place: tapping the field focuses
 * it (the keyboard appears because the user deliberately tapped), the
 * user types, and live results drop down right here in context. Selecting
 * a result navigates straight to its destination.
 *
 * It deliberately does NOT open the SearchOverlay and carries no
 * layoutId — the morph-into-overlay animation belongs to Discover only.
 */
function HomeSearchBar() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')

  const trimmed = query.trim()
  const hasQuery = trimmed.length > 0

  const { results, isLoading, error } = useSearch(query)

  const reset = useCallback(() => {
    setQuery('')
  }, [])

  const handleGameTap = useCallback(
    (game) => {
      addRecent('games', {
        id: game.id,
        name: game.title,
        coverUrl: game.image || null,
      })
      reset()
      inputRef.current?.blur()
      navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
    },
    [navigate, reset]
  )

  const handleDevTap = useCallback(
    (devName) => {
      reset()
      inputRef.current?.blur()
      navigate(`/developer/${encodeURIComponent(devName)}`)
    },
    [navigate, reset]
  )

  const handleGenreTap = useCallback(
    (genreKey) => {
      reset()
      inputRef.current?.blur()
      navigate(`/browse/${genreKey}`)
    },
    [navigate, reset]
  )

  // Inline dropdown, not the full Search page — cap each category locally
  // so it keeps its original compact size regardless of how many results
  // useSearch() now returns for the dedicated Search page's Devs/All tabs.
  const games = results.games.slice(0, 5)
  const developers = results.developers.slice(0, 3)

  const hasResults =
    games.length + results.genres.length + developers.length > 0

  return (
    <div className="home-search">
      <div className="home-search-pill-inner">
        <Search className="home-search-pill-icon" size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search games, developers, genres"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Search games, developers, genres..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="home-search-input"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        {hasQuery && (
          <button
            type="button"
            className="home-search-clear"
            onClick={() => {
              reset()
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {hasQuery && (
        <div className="home-search-results" role="listbox" aria-label="Search results">
          {isLoading && (
            <p className="home-search-status">Searching…</p>
          )}

          {!isLoading && error && (
            <p className="home-search-status">Search failed. Please try again.</p>
          )}

          {!isLoading && !error && !hasResults && (
            <EmptyState icon={SearchX} size="inline" body={`No results for "${trimmed}"`} />
          )}

          {!isLoading && !error && results.genres.length > 0 && (
            <div className="home-search-group">
              <h3 className="home-search-group__header">Genres</h3>
              <div className="home-search-genres">
                {results.genres.map((genre) => (
                  <button
                    key={genre.key}
                    type="button"
                    className="home-search-genre-pill"
                    onClick={() => handleGenreTap(genre.key)}
                    role="option"
                    aria-selected={false}
                  >
                    {genre.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isLoading && !error && games.length > 0 && (
            <div className="home-search-group">
              <h3 className="home-search-group__header">Games</h3>
              {games.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="home-search-row"
                  onClick={() => handleGameTap(game)}
                  role="option"
                  aria-selected={false}
                >
                  <div className="home-search-cover">
                    {game.image ? (
                      <img
                        src={getSizedImageUrl(game.image, 53)}
                        alt=""
                        className="home-search-cover__img"
                        loading="lazy"
                      />
                    ) : (
                      <CoverPlaceholder title={game.title} className="home-search-cover__img" />
                    )}
                  </div>
                  <div className="home-search-info">
                    <span className="home-search-title">{game.title}</span>
                    <span className="home-search-meta">
                      {[game.year, game.developer].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!isLoading && !error && developers.length > 0 && (
            <div className="home-search-group">
              <h3 className="home-search-group__header">Developers</h3>
              {developers.map((dev) => (
                <button
                  key={dev.name}
                  type="button"
                  className="home-search-row"
                  onClick={() => handleDevTap(dev.name)}
                  role="option"
                  aria-selected={false}
                >
                  <div className="home-search-info">
                    <span className="home-search-title">{dev.name}</span>
                    <span className="home-search-meta">
                      {dev.count} {dev.count === 1 ? 'result' : 'results'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default HomeSearchBar
