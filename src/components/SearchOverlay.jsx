import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ChevronLeft, Search, X, SearchX } from 'lucide-react'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import { useSearch } from '../hooks/useSearch'
import { useDebounce } from '../hooks/useDebounce'
import {
  addRecent,
  removeRecent,
  clearRecents,
  useRecents,
} from '../utils/recentSearches'
import { hapticImpact } from '../utils/haptics'
import { searchReviewsByText } from '../services/reviewService'
import { getSizedImageUrl } from '../services/imageUtils'
import { searchUsers } from '../services/userService'
import { searchPublicLists } from '../services/listService'
import {
  followUser,
  unfollowUser,
  isFollowing as fetchIsFollowing,
  FOLLOW_CHANGED_EVENT,
} from '../services/followService'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import CoverPlaceholder from '../components/explore/CoverPlaceholder'
import { SearchResultSkeletonList } from '../components/skeletons/SearchResultRowSkeleton'
import ReviewCard from '../components/ReviewCard'
import KeyboardAwareView from '../components/KeyboardAwareView'
import Avatar from '../components/Avatar'
import ListCoverCluster from './ListCoverCluster'
import EmptyState from './EmptyState'
import './SearchOverlay.css'

// ─── Static genre data ─────────────────────────────────────────────────────
// Matches the same tiles in Search.jsx so genre-tap destinations are identical.
const GENRE_CARDS = [
  { slug: 'rpg',       name: 'RPG',       gradient: 'linear-gradient(135deg, #3D1A6B 0%, var(--color-brand-primary) 100%)' },
  { slug: 'action',    name: 'Action',    gradient: 'linear-gradient(135deg, #8C2200 0%, #C84E0A 100%)' },
  { slug: 'strategy',  name: 'Strategy',  gradient: 'linear-gradient(135deg, #0B1E3D 0%, #1A7FA0 100%)' },
  { slug: 'adventure', name: 'Adventure', gradient: 'linear-gradient(135deg, #0D2E1A 0%, #4A8C62 100%)' },
  { slug: 'horror',    name: 'Horror',    gradient: 'linear-gradient(135deg, #6B0A14 0%, #0A0A0E 100%)' },
  { slug: 'sports',    name: 'Sports',    gradient: 'linear-gradient(135deg, #0A2860 0%, #1A5CAE 100%)' },
  { slug: 'puzzle',    name: 'Puzzle',    gradient: 'linear-gradient(135deg, #2A1A6B 0%, #4FA899 100%)' },
  { slug: 'shooter',   name: 'Shooter',   gradient: 'linear-gradient(135deg, #1C2A1C 0%, #506B38 100%)' },
]

const TABS = [
  { id: 'games',   label: 'Games' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'users',   label: 'Users' },
  { id: 'lists',   label: 'Lists' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function reviewRowToCard(row) {
  return {
    id: row.id,
    title: '',
    body: row.body || '',
    rating: parseFloat(row.rating) || 0,
    likeCount: 0,
    commentCount: 0,
    createdAt: row.created_at,
    author: {
      username: row.users?.username || row.users?.display_name || 'someone',
      displayName: row.users?.display_name || 'Someone',
      // No avatar_url? Leave it null — ReviewCard already renders its own
      // local initials fallback rather than fetching one over the network.
      avatarUrl: row.users?.avatar_url || null,
    },
    game: {
      id: row.igdb_game_id,
      name: row.game_title || 'Untitled Game',
      developer: '',
      coverUrl: row.game_image || null,
    },
  }
}

function HighlightMatch({ text, query }) {
  if (!query || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span className="so-text-dim">{text}</span>
  return (
    <>
      <span className="so-text-dim">{text.slice(0, idx)}</span>
      <span className="so-text-match">{text.slice(idx, idx + query.length)}</span>
      <span className="so-text-dim">{text.slice(idx + query.length)}</span>
    </>
  )
}

// ─── Empty-state sections ──────────────────────────────────────────────────

function RecentGamesSection({ recents, onTap, onClear }) {
  if (!recents || recents.length === 0) return null
  return (
    <section className="so-section">
      <div className="so-section-header">
        <h2 className="so-section-title">Recent Searches</h2>
        <button
          type="button"
          className="so-clear-all"
          onClick={onClear}
          aria-label="Clear all recent searches"
        >
          Clear all
        </button>
      </div>
      <div className="so-recent-covers">
        {recents.map((item) => (
          <button
            key={item.id}
            type="button"
            className="so-recent-cover"
            onClick={() => onTap(item)}
            aria-label={item.name || 'Recent game'}
          >
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="" className="so-recent-cover__img" loading="lazy" />
            ) : (
              <CoverPlaceholder title={item.name} className="so-recent-cover__img" />
            )}
            {item.name && (
              <span className="so-recent-cover__label">{item.name}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

function GenreGrid({ onNavigate }) {
  return (
    <section className="so-section">
      <h2 className="so-section-title">Browse by genre</h2>
      <div className="so-genre-grid">
        {GENRE_CARDS.map((genre) => (
          <button
            key={genre.slug}
            type="button"
            className="so-genre-card"
            style={{ background: genre.gradient }}
            onClick={() => onNavigate(`/browse/${genre.slug}`)}
          >
            <span className="so-genre-card__name">{genre.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Games tab ─────────────────────────────────────────────────────────────

function GamesResults({ query, results, isLoading, error, onTapGame, onTapDev, onTapGenre }) {
  if (isLoading) return <SearchResultSkeletonList count={8} />
  if (error) return <p className="so-error-text">Search failed. Please try again.</p>

  // This overlay is a compact dropdown, not the full Search page — cap each
  // category locally so it keeps its original size regardless of how many
  // results useSearch() returns for the dedicated Search page's tabs.
  const games = results.games.slice(0, 5)
  const developers = results.developers.slice(0, 3)

  const hasResults =
    games.length + results.genres.length + developers.length > 0

  if (!hasResults) {
    return (
      <EmptyState icon={SearchX} size="inline" body={`No games found for "${query.trim()}"`} />
    )
  }

  return (
    <div className="so-results" role="listbox" aria-label="Game results">
      {results.genres.length > 0 && (
        <div className="so-result-category">
          <h3 className="so-result-category__header">Genres</h3>
          <div className="so-genre-pills">
            {results.genres.map((genre) => (
              <button
                key={genre.key}
                type="button"
                className="so-genre-pill"
                onClick={() => onTapGenre(genre.key)}
                role="option"
                aria-selected={false}
              >
                <HighlightMatch text={genre.label} query={query.trim()} />
              </button>
            ))}
          </div>
        </div>
      )}
      {games.length > 0 && (
        <div className="so-result-category">
          <h3 className="so-result-category__header">Games</h3>
          {games.map((game) => (
            <button
              key={game.id}
              type="button"
              className="so-result-row"
              onClick={() => onTapGame(game)}
              role="option"
              aria-selected={false}
            >
              <div className="so-result-cover">
                {game.image ? (
                  <img
                    src={getSizedImageUrl(game.image, 58)}
                    alt=""
                    className="so-result-cover__img"
                    loading="lazy"
                  />
                ) : (
                  <CoverPlaceholder title={game.title} className="so-result-cover__img" />
                )}
              </div>
              <div className="so-result-info">
                <span className="so-result-title">
                  <HighlightMatch text={game.title} query={query.trim()} />
                </span>
                <span className="so-result-meta">
                  {[game.year, game.developer].filter(Boolean).join(' · ')}
                </span>
              </div>
              <svg className="so-result-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      )}
      {developers.length > 0 && (
        <div className="so-result-category">
          <h3 className="so-result-category__header">Developers</h3>
          {developers.map((dev) => (
            <button
              key={dev.name}
              type="button"
              className="so-result-row"
              onClick={() => onTapDev(dev.name)}
              role="option"
              aria-selected={false}
            >
              <div className="so-result-info">
                <span className="so-result-title">
                  <HighlightMatch text={dev.name} query={query.trim()} />
                </span>
                <span className="so-result-meta">
                  {dev.count} {dev.count === 1 ? 'result' : 'results'}
                </span>
              </div>
              <svg className="so-result-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Reviews tab ───────────────────────────────────────────────────────────

function ReviewsResults({ rows, isLoading }) {
  if (isLoading) return <SearchResultSkeletonList count={4} />
  if (!rows || rows.length === 0) {
    return <EmptyState size="inline" body="No reviews match this search yet." />
  }
  return (
    <div className="so-section so-reviews-results">
      {rows.map((row) => (
        <ReviewCard key={row.id} review={reviewRowToCard(row)} variant="compact" />
      ))}
    </div>
  )
}

// ─── Users tab ─────────────────────────────────────────────────────────────

function FollowButton({ targetUserId, targetLabel, currentUserId }) {
  const [following, setFollowing] = useState(false)
  const [pending, setPending] = useState(false)
  const [resolved, setResolved] = useState(false)
  const isSelf = currentUserId && targetUserId && currentUserId === targetUserId

  useEffect(() => {
    if (!targetUserId || !currentUserId || isSelf) {
      setFollowing(false)
      setResolved(true)
      return
    }
    let cancelled = false
    setResolved(false)
    fetchIsFollowing(targetUserId)
      .then((v) => { if (!cancelled) setFollowing(v) })
      .finally(() => { if (!cancelled) setResolved(true) })
    return () => { cancelled = true }
  }, [targetUserId, currentUserId, isSelf])

  useEffect(() => {
    function handleChange(e) {
      if (!e?.detail) return
      const { followeeId, following: newState } = e.detail
      if (followeeId === targetUserId) setFollowing(!!newState)
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(FOLLOW_CHANGED_EVENT, handleChange)
  }, [targetUserId])

  const handleClick = useCallback(async (e) => {
    e.stopPropagation()
    if (!targetUserId || !currentUserId || isSelf || pending) return
    const was = following
    hapticImpact('Light')
    setFollowing(!was)
    setPending(true)
    try {
      if (was) await unfollowUser(targetUserId)
      else await followUser(targetUserId)
    } catch (err) {
      setFollowing(was)
      showToast(err?.message || "Couldn't update follow status.", 'error', 4000)
    } finally {
      setPending(false)
    }
  }, [targetUserId, currentUserId, isSelf, pending, following])

  if (isSelf) return null

  return (
    <button
      type="button"
      className={`so-follow-btn${following ? ' so-follow-btn--following' : ''}`}
      onClick={handleClick}
      disabled={!resolved || pending || !currentUserId}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${targetLabel}` : `Follow ${targetLabel}`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

function UsersResults({ rows, isLoading, onTapUser, currentUserId }) {
  if (isLoading) return <SearchResultSkeletonList count={5} />
  if (!rows || rows.length === 0) {
    return <EmptyState size="inline" body="No users found." />
  }
  return (
    <div className="so-section so-user-list">
      {rows.map((u) => {
        const username = u.username || ''
        const displayName = u.display_name || ''
        return (
          <div key={u.id} className="so-user-row">
            <button
              type="button"
              className="so-user-row__main"
              onClick={() =>
                onTapUser({ id: username || u.id, username, displayName, avatarUrl: u.avatar_url || null })
              }
            >
              <Avatar
                avatarUrl={u.avatar_url}
                name={displayName || username}
                seed={u.id}
                size="md"
                className="so-user-avatar"
              />
              <div className="so-user-row__text">
                <span className="so-user-row__username">
                  {username || displayName || 'Unknown'}
                </span>
                {displayName && username && (
                  <span className="so-user-row__display">{displayName}</span>
                )}
              </div>
            </button>
            <FollowButton
              targetUserId={u.id}
              targetLabel={username || displayName || 'user'}
              currentUserId={currentUserId}
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── Lists tab ─────────────────────────────────────────────────────────────

function ListsResults({ rows, isLoading, onTapList }) {
  if (isLoading) return <SearchResultSkeletonList count={4} />
  if (!rows || rows.length === 0) {
    return <EmptyState size="inline" body="No lists found." />
  }
  return (
    <div className="so-section so-list-results">
      {rows.map((list) => (
        <button
          key={list.id}
          type="button"
          className="so-list-row"
          onClick={() => onTapList(list)}
        >
          <ListCoverCluster games={list.games} coverImageUrl={list.coverImageUrl} name={list.name} />
          <div className="so-list-row__body">
            <h3 className="so-list-row__title">{list.name}</h3>
            {list.description && (
              <p className="so-list-row__desc">{list.description}</p>
            )}
            {list.author && (
              <span className="so-list-row__author">
                {list.author.username || list.author.displayName}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Main overlay ──────────────────────────────────────────────────────────

function SearchOverlay() {
  const { close } = useSearchOverlay()
  const navigate = useNavigate()
  const { user } = useAuth()
  const reduced = useReducedMotion()
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('games')

  const trimmedQuery = query.trim()
  const hasQuery = trimmedQuery.length > 0
  const debouncedQuery = useDebounce(trimmedQuery, 300)

  // Recents (games tab is the default empty-state display)
  const gamesRecents = useRecents('games')

  // Games: uses useSearch which has its own internal 200ms debounce + abort
  const { results: gameResults, isLoading: gamesLoading, error: gamesError } =
    useSearch(activeTab === 'games' ? query : '')

  // Reviews / Users / Lists — async on debounced query
  const [reviewsRows, setReviewsRows] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [usersRows, setUsersRows] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [listsRows, setListsRows] = useState([])
  const [listsLoading, setListsLoading] = useState(false)

  useEffect(() => {
    if (activeTab !== 'reviews') return
    if (!debouncedQuery) { setReviewsRows([]); return }
    let cancelled = false
    setReviewsLoading(true)
    searchReviewsByText(debouncedQuery, 20)
      .then((rows) => { if (!cancelled) setReviewsRows(rows) })
      .finally(() => { if (!cancelled) setReviewsLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, debouncedQuery])

  useEffect(() => {
    if (activeTab !== 'users') return
    if (!debouncedQuery) { setUsersRows([]); return }
    let cancelled = false
    setUsersLoading(true)
    searchUsers(debouncedQuery, 20)
      .then((rows) => { if (!cancelled) setUsersRows(rows) })
      .finally(() => { if (!cancelled) setUsersLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, debouncedQuery])

  useEffect(() => {
    if (activeTab !== 'lists') return
    if (!debouncedQuery) { setListsRows([]); return }
    let cancelled = false
    setListsLoading(true)
    searchPublicLists(debouncedQuery, 20)
      .then((rows) => { if (!cancelled) setListsRows(rows) })
      .finally(() => { if (!cancelled) setListsLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, debouncedQuery])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  /* ── Handlers ──────────────────────────────────────────────── */

  const handleGameTap = useCallback(
    (game) => {
      addRecent('games', { id: game.id, name: game.title, coverUrl: game.image || null })
      close()
      navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
    },
    [close, navigate]
  )

  const handleDevTap = useCallback(
    (devName) => {
      close()
      navigate(`/developer/${encodeURIComponent(devName)}`)
    },
    [close, navigate]
  )

  const handleGenreTap = useCallback(
    (genreKey) => {
      close()
      navigate(`/browse/${genreKey}`)
    },
    [close, navigate]
  )

  const handleUserTap = useCallback(
    (item) => {
      addRecent('users', {
        id: item.username || item.id,
        username: item.username,
        displayName: item.displayName,
        avatarUrl: item.avatarUrl || null,
      })
      close()
      if (item.username) {
        navigate(`/user/${encodeURIComponent(item.username)}`)
      } else if (item.id) {
        navigate(`/user/id/${encodeURIComponent(item.id)}`)
      }
    },
    [close, navigate]
  )

  const handleListTap = useCallback(
    (list) => {
      addRecent('lists', {
        id: list.id,
        name: list.name,
        description: list.description || '',
        author: list.author || null,
        games: (list.games || []).slice(0, 4),
      })
      close()
      navigate(`/list/${list.id}`)
    },
    [close, navigate]
  )

  const handleNavigate = useCallback(
    (path) => {
      close()
      navigate(path)
    },
    [close, navigate]
  )

  /* ── Animation config ──────────────────────────────────────── */

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const contentTransition = reduced
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <>
      {/* Dim backdrop — tapping it closes the overlay */}
      <motion.div
        className="so-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={backdropTransition}
        onClick={close}
        aria-hidden="true"
      />

      {/* Overlay surface — full screen, slides up from y:24 */}
      <motion.div
        className="so-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        initial={reduced ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduced ? false : { y: 24, opacity: 0 }}
        transition={contentTransition}
      >
        {/* ── Top bar ─────────────────────────────────────────── */}
        <div className="so-top-bar">
          <button
            type="button"
            className="so-back-btn"
            onClick={close}
            aria-label="Close search"
          >
            <ChevronLeft size={24} />
          </button>

          {/*
            layoutId="search-bar" — Motion will animate this element from
            wherever the triggering entry point (Home pill / Discover icon)
            last was, morphing it into the input bar.
          */}
          <motion.div
            layoutId="search-bar"
            className="so-input-wrap"
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
          >
            <Search size={16} className="so-input-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              role="searchbox"
              aria-label="Search"
              inputMode="search"
              enterKeyHint="search"
              placeholder="Search games, devs, users..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="so-input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="so-input-clear"
                onClick={() => { setQuery(''); inputRef.current?.focus() }}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </motion.div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────── */}
        <KeyboardAwareView mode="scroll" reserveNav className="so-body">
          {!hasQuery ? (
            <>
              <RecentGamesSection
                recents={gamesRecents}
                onTap={(item) => {
                  addRecent('games', item)
                  close()
                  navigate(`/game/${item.id}`, { state: { coverImage: item.coverUrl } })
                }}
                onClear={() => clearRecents('games')}
              />
              <GenreGrid onNavigate={handleNavigate} />
            </>
          ) : (
            <>
              {/* Filter tabs — only shown when there's a query */}
              <div className="so-tabs" role="tablist" aria-label="Search categories">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`so-tab${activeTab === tab.id ? ' so-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Results for the active tab — horizontal slide on tab
                  switch, matching the Profile inline-tabs pattern. */}
              <div className="so-tab-content">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeTab}
                    initial={reduced ? false : { opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduced ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }
                    }
                  >
                    {activeTab === 'games' && (
                      <GamesResults
                        query={query}
                        results={gameResults}
                        isLoading={gamesLoading}
                        error={gamesError}
                        onTapGame={handleGameTap}
                        onTapDev={handleDevTap}
                        onTapGenre={handleGenreTap}
                      />
                    )}
                    {activeTab === 'reviews' && (
                      <ReviewsResults rows={reviewsRows} isLoading={reviewsLoading} />
                    )}
                    {activeTab === 'users' && (
                      <UsersResults
                        rows={usersRows}
                        isLoading={usersLoading}
                        onTapUser={handleUserTap}
                        currentUserId={user?.id || null}
                      />
                    )}
                    {activeTab === 'lists' && (
                      <ListsResults rows={listsRows} isLoading={listsLoading} onTapList={handleListTap} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          )}
        </KeyboardAwareView>
      </motion.div>
    </>
  )
}

export default SearchOverlay
