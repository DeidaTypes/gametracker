import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useSearch } from '../hooks/useSearch'
import { useRecentSearches } from '../hooks/useRecentSearches'
import { fetchBrowseCategories } from '../services/browseService'
import { getContinuePlayingGames } from '../services/libraryService'
import GenreTile from '../components/explore/GenreTile'
import CoverPlaceholder from '../components/explore/CoverPlaceholder'
import InlineErrorBanner from '../components/InlineErrorBanner'
import EmptyState from '../components/EmptyState'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { SearchResultSkeletonList } from '../components/skeletons/SearchResultRowSkeleton'
import './Search.css'

const TRENDING_SEARCHES = [
  'Elden Ring',
  "Baldur's Gate 3",
  'Hades II',
  'Final Fantasy VII Rebirth',
  'Hollow Knight',
]

const GENRE_CARDS = [
  {
    slug: 'rpg',
    name: 'RPG',
    gradient: 'linear-gradient(135deg, #3D1A6B 0%, #C8965A 100%)',
  },
  {
    slug: 'action',
    name: 'Action',
    gradient: 'linear-gradient(135deg, #8C2200 0%, #C84E0A 100%)',
  },
  {
    slug: 'strategy',
    name: 'Strategy',
    gradient: 'linear-gradient(135deg, #0B1E3D 0%, #1A7FA0 100%)',
  },
  {
    slug: 'adventure',
    name: 'Adventure',
    gradient: 'linear-gradient(135deg, #0D2E1A 0%, #4A8C62 100%)',
  },
  {
    slug: 'horror',
    name: 'Horror',
    gradient: 'linear-gradient(135deg, #6B0A14 0%, #0A0A0E 100%)',
  },
  {
    slug: 'sports',
    name: 'Sports',
    gradient: 'linear-gradient(135deg, #0A2860 0%, #1A5CAE 100%)',
  },
  {
    slug: 'puzzle',
    name: 'Puzzle',
    gradient: 'linear-gradient(135deg, #2A1A6B 0%, #4FA899 100%)',
  },
  {
    slug: 'shooter',
    name: 'Shooter',
    gradient: 'linear-gradient(135deg, #1C2A1C 0%, #506B38 100%)',
  },
]

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
  const [currentlyPlaying, setCurrentlyPlaying] = useState(() =>
    getContinuePlayingGames(5)
  )

  const [recentChipsRef] = useAutoAnimateMotion()
  const [gamesResultsRef] = useAutoAnimateMotion()

  const hasQuery = query.trim().length > 0
  const { results, isLoading, error: searchError } = useSearch(query)
  const {
    searches: recentSearches,
    add: addRecent,
    remove: removeRecent,
    clear: clearRecent,
  } = useRecentSearches()
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

    return () => {
      cancelled = true
    }
  }, [genresRetry])

  useEffect(() => {
    const onLibraryUpdate = () => setCurrentlyPlaying(getContinuePlayingGames(5))
    window.addEventListener('libraryUpdated', onLibraryUpdate)
    return () => window.removeEventListener('libraryUpdated', onLibraryUpdate)
  }, [])

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
      navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
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

  const handleDevTap = useCallback(
    (devName) => {
      if (query.trim()) addRecent(query.trim())
      navigate(`/developer/${encodeURIComponent(devName)}`)
    },
    [query, addRecent, navigate]
  )

  const handleRecentTap = useCallback(
    (term) => {
      setQuery(term)
      addRecent(term)
      inputRef.current?.focus()
    },
    [addRecent]
  )

  const handleTrendingTap = useCallback(
    (term) => {
      setQuery(term)
      addRecent(term)
      inputRef.current?.focus()
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
      if (
        e.key === 'Enter' &&
        focusedIndex >= 0 &&
        focusedIndex < flatResults.length
      ) {
        e.preventDefault()
        const item = flatResults[focusedIndex]
        if (item.type === 'game') handleResultTap(item.data)
        else if (item.type === 'genre') handleGenreTap(item.data.key)
        else if (item.type === 'developer') handleDevTap(item.data.name)
      }
    },
    [flatResults, focusedIndex, handleResultTap, handleGenreTap, handleDevTap]
  )

  const showClearBtn = isFocused || query.length > 0
  const noResults =
    hasQuery && !isLoading && !searchError && totalResultCount === 0

  // The same game can appear in both the discovery "Pick up where you left
  // off" carousel and in the active search results. When it does, drop the
  // shared layoutId on duplicates so Motion never has an ambiguous match.
  const duplicateIds = findDuplicateGameIds(currentlyPlaying, results.games)

  return (
    <div className="search-page" ref={scrollRef}>
      {/* Sticky search bar */}
      <div className={`sp-header${hasScrolled ? ' sp-header--bordered' : ''}`}>
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
        {hasQuery &&
          !isLoading &&
          totalResultCount > 0 &&
          `${totalResultCount} result${totalResultCount !== 1 ? 's' : ''} for ${query}`}
        {noResults && `No results for ${query}`}
      </div>

      {/* Mode container — cross-fade between discovery and search.
          Wrapped in a SharedCoverScope so duplicate gameIds (same game in
          the "Pick up where you left off" carousel AND in active results)
          fall back to a plain wrapper instead of fighting over layoutId. */}
      <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="sp-modes">
        {/* Mode A: Discovery / Empty state */}
        <div
          className={`sp-mode sp-mode-a${hasQuery ? ' sp-mode--hidden' : ''}`}
          aria-hidden={hasQuery}
        >
          {/* 1. Recent searches — hidden when empty */}
          {recentSearches.length > 0 && (
            <section className="sp-section">
              <div className="sp-recent-header">
                <h2 className="sp-section-header sp-section-header--sm" style={{ margin: 0 }}>
                  Recent
                </h2>
                <button
                  className="sp-recent-clear"
                  onClick={clearRecent}
                  type="button"
                >
                  Clear all
                </button>
              </div>
              <div className="sp-chips" ref={recentChipsRef}>
                {recentSearches.map((term) => (
                  <span key={term} className="sp-chip">
                    <button
                      className="sp-chip__label"
                      onClick={() => handleRecentTap(term)}
                      type="button"
                    >
                      {term}
                    </button>
                    <button
                      className="sp-chip__remove"
                      onClick={() => removeRecent(term)}
                      type="button"
                      aria-label={`Remove ${term} from recent searches`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* 2. Trending searches */}
          <section className="sp-section">
            <h2 className="sp-section-header sp-section-header--sm">Trending</h2>
            <div className="sp-chips">
              {TRENDING_SEARCHES.map((term) => (
                <button
                  key={term}
                  className="sp-chip sp-chip--pill"
                  onClick={() => handleTrendingTap(term)}
                  type="button"
                >
                  {term}
                </button>
              ))}
            </div>
          </section>

          {/* 3. Browse by genre — gradient cards */}
          <section className="sp-section">
            <h2 className="sp-section-header">Browse by genre</h2>
            <div className="sp-genre-grid">
              {GENRE_CARDS.map((genre) => (
                <button
                  key={genre.slug}
                  className="sp-genre-card"
                  style={{ background: genre.gradient }}
                  onClick={() => navigate(`/browse/${genre.slug}`)}
                  type="button"
                >
                  <span className="sp-genre-card__name">{genre.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* 4. Currently playing carousel — only when user has games */}
          {currentlyPlaying.length > 0 && (
            <section className="sp-section sp-section--carousel">
              <h2 className="sp-section-header">Pick up where you left off</h2>
              <div className="sp-library-carousel">
                {currentlyPlaying.map((game) => (
                  <button
                    key={game.id}
                    className="sp-library-cover"
                    onClick={() =>
                      navigate(`/game/${game.id}`, {
                        state: { coverImage: game.image },
                      })
                    }
                    type="button"
                    aria-label={game.title}
                  >
                    {game.image ? (
                      <SharedCover gameId={game.id} imageSrc={game.image}>
                        <img
                          src={game.image}
                          alt=""
                          className="sp-library-cover__img"
                        />
                      </SharedCover>
                    ) : (
                      <CoverPlaceholder
                        title={game.title}
                        className="sp-library-cover__img"
                      />
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Mode B: Active search results */}
        <div
          className={`sp-mode sp-mode-b${!hasQuery ? ' sp-mode--hidden' : ''}`}
          aria-hidden={!hasQuery}
        >
          {/* Search skeleton */}
          {hasQuery && isLoading && (
            <SearchResultSkeletonList count={8} />
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
                  <div ref={gamesResultsRef}>
                  {results.games.map((game, i) => (
                    <button
                      key={game.id}
                      className={`sp-result-row sp-result-row--game${
                        focusedIndex === i ? ' sp-result-row--focused' : ''
                      }`}
                      onClick={() => handleResultTap(game)}
                      type="button"
                      role="option"
                      aria-selected={focusedIndex === i}
                    >
                      <div className="sp-result-cover">
                        {game.image ? (
                          <SharedCover gameId={game.id} imageSrc={game.image}>
                            <img
                              src={game.image}
                              alt=""
                              className="sp-result-cover__img"
                            />
                          </SharedCover>
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
                </div>
              )}

              {/* Developers */}
              {results.developers.length > 0 && (
                <div className="sp-result-category">
                  <h3 className="sp-result-category__header">Developers</h3>
                  {results.developers.map((dev) => (
                    <button
                      key={dev.name}
                      className="sp-result-row sp-result-row--dev"
                      onClick={() => handleDevTap(dev.name)}
                      type="button"
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
            </div>
          )}

          {/* Empty results */}
          {noResults && (
            <div className="sp-empty">
              <EmptyState
                variant="search"
                copy={`No results for "${query.trim()}" — try a different spelling or browse by genre`}
                cta="Browse genres"
                onCta={() => {
                  setQuery('')
                  inputRef.current?.blur()
                }}
              />
              {genres && genres.length > 0 && (
                <div className="sp-section sp-empty-genres">
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
      </SharedCoverScope>
    </div>
  )
}

export default Search
