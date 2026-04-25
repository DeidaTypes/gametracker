import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearch } from '../hooks/useSearch'
import { useRecentSearches } from '../hooks/useRecentSearches'
import { fetchBrowseCategories } from '../services/browseService'
import GenreTile from '../components/explore/GenreTile'
import CoverPlaceholder from '../components/explore/CoverPlaceholder'
import InlineErrorBanner from '../components/InlineErrorBanner'
import './Search.css'

function HighlightMatch({ text, query }) {
  if (!query || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span className="sp-text-dim">{text}</span>
  return (
    <>
      <span className="sp-text-dim">{text.slice(0, idx)}</span>
      <span className="sp-text-match">{text.slice(idx, idx + query.length)}</span>
      <span className="sp-text-dim">{text.slice(idx + query.length)}</span>
    </>
  )
}

function Search() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  const blurTimerRef = useRef(null)
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const isSearchMode = isFocused || query.length > 0
  const { results, isLoading, error: searchError } = useSearch(query)
  const { searches: recentSearches, add: addRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches()
  const [genres, setGenres] = useState(null)
  const [genresLoading, setGenresLoading] = useState(true)
  const [genresError, setGenresError] = useState(null)
  const [genresRetry, setGenresRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setGenresLoading(true)
    setGenresError(null)

    fetchBrowseCategories()
      .then((categories) => {
        if (cancelled) return
        const tiles = categories
          .filter((c) => c.games && c.games.length > 0)
          .map((c) => ({
            key: c.key,
            label: c.label,
            count: c.games.length,
            image: c.coverImage || (c.games[0] ? c.games[0].image : null),
          }))
        if (tiles.length > 0) {
          setGenres(tiles)
        } else {
          setGenresError('Could not load categories')
        }
      })
      .catch((err) => {
        if (!cancelled) setGenresError(err.message || 'Failed to load categories')
      })
      .finally(() => {
        if (!cancelled) setGenresLoading(false)
      })

    return () => { cancelled = true }
  }, [genresRetry])

  const totalResultCount =
    results.games.length + results.genres.length + results.developers.length

  const flatResults = [
    ...results.games.map((g) => ({ type: 'game', data: g })),
    ...results.genres.map((g) => ({ type: 'genre', data: g })),
    ...results.developers.map((d) => ({ type: 'developer', data: d })),
  ]

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setHasScrolled(el.scrollTop > 0)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setFocusedIndex(-1)
  }, [query])

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      addRecent(trimmed)
      inputRef.current?.blur()
    },
    [query, addRecent]
  )

  const handleResultTap = useCallback(
    (game) => {
      if (query.trim()) addRecent(query.trim())
      navigate(`/game/${game.id}`)
    },
    [query, addRecent, navigate]
  )

  const handleGenreTap = useCallback(
    (genreKey) => {
      if (query.trim()) addRecent(query.trim())
      navigate(`/browse/${genreKey}`)
    },
    [query, addRecent, navigate]
  )

  const handleRecentTap = useCallback(
    (term) => {
      setQuery(term)
      addRecent(term)
    },
    [addRecent]
  )

  const handleClear = useCallback(() => {
    if (query.length > 0) {
      setQuery('')
      inputRef.current?.focus()
    } else {
      inputRef.current?.blur()
    }
  }, [query])

  const handleFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    setIsFocused(true)
  }, [])

  const handleBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null
      setIsFocused(false)
    }, 150)
  }, [])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        setQuery('')
        inputRef.current?.blur()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev < flatResults.length - 1 ? prev + 1 : prev
        )
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1))
      }
      if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < flatResults.length) {
        e.preventDefault()
        const item = flatResults[focusedIndex]
        if (item.type === 'game') handleResultTap(item.data)
        else if (item.type === 'genre') handleGenreTap(item.data.key)
      }
    },
    [flatResults, focusedIndex, handleResultTap, handleGenreTap]
  )

  const showClearBtn = isFocused || query.length > 0

  const hasQuery = query.trim().length > 0
  const noResults =
    hasQuery && !isLoading && !searchError && totalResultCount === 0

  return (
    <div className="search-page" ref={scrollRef}>
      {/* Sticky search input */}
      <div
        className={`sp-header${hasScrolled ? ' sp-header--bordered' : ''}`}
      >
        <form onSubmit={handleSubmit} className="sp-form" role="search">
          <div className="sp-input-wrap">
            <svg
              className="sp-input-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              role="searchbox"
              aria-label="Search games"
              inputMode="search"
              enterKeyHint="search"
              placeholder="Search games, genres, developers..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="sp-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {showClearBtn && (
              <button
                type="button"
                className="sp-clear-btn"
                onClick={handleClear}
                aria-label="Clear search"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Live region for screen readers */}
      <div aria-live="polite" className="sr-only">
        {hasQuery && !isLoading && totalResultCount > 0 &&
          `${totalResultCount} result${totalResultCount !== 1 ? 's' : ''} for ${query}`}
        {noResults && `No results for ${query}`}
      </div>

      {/* Mode container — cross-fade between browse and search */}
      <div className="sp-modes">
        {/* Mode A: Browse */}
        <div
          className={`sp-mode sp-mode-a${isSearchMode ? ' sp-mode--hidden' : ''}`}
          aria-hidden={isSearchMode}
        >
          {/* Genre error banner */}
          {genresError && (
            <div className="sp-section" style={{ marginTop: 16 }}>
              <InlineErrorBanner
                message="We couldn't load categories right now"
                onRetry={() => setGenresRetry((n) => n + 1)}
              />
            </div>
          )}

          {/* Browse by genre — real data from useGenres → browseService → RAWG */}
          {!genresError && (
            <section className="sp-section">
              <h2 className="sp-section-header">Browse by genre</h2>
              {genresLoading ? (
                <div className="sp-genre-grid">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="sp-genre-skeleton skeleton" />
                  ))}
                </div>
              ) : genres && genres.length > 0 ? (
                <div className="sp-genre-grid">
                  {genres.map((genre) => (
                    <GenreTile key={genre.key} genre={genre} />
                  ))}
                </div>
              ) : null}
            </section>
          )}
        </div>

        {/* Mode B: Active search */}
        <div
          className={`sp-mode sp-mode-b${!isSearchMode ? ' sp-mode--hidden' : ''}`}
          aria-hidden={!isSearchMode}
        >
          {/* Recent searches — only when focused but empty */}
          {!hasQuery && recentSearches.length > 0 && (
            <section className="sp-section">
              <div className="sp-recent-header">
                <h2 className="sp-section-header" style={{ margin: 0 }}>
                  Recent searches
                </h2>
                <button
                  className="sp-recent-clear"
                  onClick={clearRecent}
                  type="button"
                >
                  Clear all
                </button>
              </div>
              <div className="sp-recent-chips">
                {recentSearches.map((term) => (
                  <span key={term} className="sp-recent-chip">
                    <button
                      className="sp-recent-chip__label"
                      onClick={() => handleRecentTap(term)}
                      type="button"
                    >
                      {term}
                    </button>
                    <button
                      className="sp-recent-chip__remove"
                      onClick={() => removeRecent(term)}
                      type="button"
                      aria-label={`Remove ${term} from recent searches`}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Loading indicator */}
          {hasQuery && isLoading && (
            <div className="sp-loading">
              <div className="loading-spinner" />
            </div>
          )}

          {/* Search error */}
          {hasQuery && searchError && (
            <div className="sp-section" style={{ marginTop: 16 }}>
              <InlineErrorBanner
                message="Search failed. Please try again."
                onRetry={() => setQuery((q) => q + ' ')}
              />
            </div>
          )}

          {/* Results */}
          {hasQuery && !isLoading && !searchError && totalResultCount > 0 && (
            <div className="sp-results" role="listbox" aria-label="Search results">
              {/* Genres */}
              {results.genres.length > 0 && (
                <div className="sp-result-category">
                  <h3 className="sp-result-category__header">Genres</h3>
                  <div className="sp-genre-pills">
                    {results.genres.map((genre) => (
                      <button
                        key={genre.key}
                        className="sp-genre-pill"
                        onClick={() => handleGenreTap(genre.key)}
                        type="button"
                        role="option"
                        aria-selected={false}
                      >
                        <HighlightMatch text={genre.label} query={query.trim()} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Games */}
              {results.games.length > 0 && (
                <div className="sp-result-category">
                  <h3 className="sp-result-category__header">Games</h3>
                  {results.games.map((game, i) => (
                    <button
                      key={game.id}
                      className={`sp-result-row sp-result-row--game${
                        focusedIndex === i ? ' sp-result-row--focused' : ''
                      }`}
                      style={{ animationDelay: `${i * 30}ms` }}
                      onClick={() => handleResultTap(game)}
                      type="button"
                      role="option"
                      aria-selected={focusedIndex === i}
                    >
                      <div className="sp-result-cover">
                        {game.image ? (
                          <img
                            src={game.image}
                            alt=""
                            className="sp-result-cover__img"
                          />
                        ) : (
                          <CoverPlaceholder
                            title={game.title}
                            className="sp-result-cover__img"
                          />
                        )}
                      </div>
                      <div className="sp-result-info">
                        <span className="sp-result-title">
                          <HighlightMatch text={game.title} query={query.trim()} />
                        </span>
                        <span className="sp-result-meta">
                          {[game.year, game.developer].filter(Boolean).join(' \u00B7 ')}
                        </span>
                      </div>
                      <svg
                        className="sp-result-chevron"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}

              {/* Developers */}
              {results.developers.length > 0 && (
                <div className="sp-result-category">
                  <h3 className="sp-result-category__header">Developers</h3>
                  {results.developers.map((dev) => (
                    <div
                      key={dev.name}
                      className="sp-result-row sp-result-row--dev"
                      role="option"
                      aria-selected={false}
                    >
                      <div className="sp-result-info">
                        <span className="sp-result-title">
                          <HighlightMatch text={dev.name} query={query.trim()} />
                        </span>
                        <span className="sp-result-meta">
                          {dev.count} {dev.count === 1 ? 'result' : 'results'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty results */}
          {noResults && (
            <div className="sp-empty">
              <svg
                className="sp-empty__icon"
                viewBox="0 0 24 24"
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="8" x2="14" y2="14" />
                <line x1="14" y1="8" x2="8" y2="14" />
              </svg>
              <h3 className="sp-empty__title">
                No results for &ldquo;{query.trim()}&rdquo;
              </h3>
              <p className="sp-empty__sub">
                Try a different spelling or browse by genre below.
              </p>
              {/* Genre fallback */}
              {genres && genres.length > 0 && (
                <div className="sp-section" style={{ width: '100%' }}>
                  <div className="sp-genre-grid">
                    {genres.map((genre) => (
                      <GenreTile key={genre.key} genre={genre} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Search
