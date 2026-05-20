import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiX } from 'react-icons/hi'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useSearch } from '../hooks/useSearch'
import { useDebounce } from '../hooks/useDebounce'
import {
  addRecent,
  removeRecent,
  clearRecents,
  useRecents,
} from '../utils/recentSearches'
import { fetchBrowseCategories } from '../services/browseService'
import { searchReviewsByText } from '../services/reviewService'
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
import GenreTile from '../components/explore/GenreTile'
import CoverPlaceholder from '../components/explore/CoverPlaceholder'
import InlineErrorBanner from '../components/InlineErrorBanner'
import EmptyState from '../components/EmptyState'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { SearchResultSkeletonList } from '../components/skeletons/SearchResultRowSkeleton'
import ReviewCard from '../components/ReviewCard'
import './Search.css'

const TABS = [
  { id: 'games', label: 'Games' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'users', label: 'Users' },
  { id: 'lists', label: 'Lists' },
]

// Submit-on-pause window for the Reviews tab — adds to recents 1.5s after
// the user stops typing (per spec). Distinct from the 300ms search debounce.
const REVIEWS_SUBMIT_AFTER_MS = 1500

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

/* =============================================
   Helpers
   ============================================= */

/** Normalize a Supabase review row into the shape ReviewCard expects. */
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
      avatarUrl:
        row.users?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          row.users?.display_name || 'U'
        )}&background=152035&color=C8965A`,
    },
    game: {
      id: row.igdb_game_id,
      name: row.game_title || 'Untitled Game',
      developer: '',
      coverUrl: row.game_image || null,
    },
  }
}

function avatarFallback(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    name || 'U'
  )}&background=152035&color=C8965A`
}

/* =============================================
   Empty / recents row primitives
   ============================================= */

function RecentsHeader({ onClear }) {
  return (
    <div className="sp-recent-header">
      <h2
        className="sp-section-header sp-section-header--sm"
        style={{ margin: 0 }}
      >
        Recent Searches
      </h2>
      <button
        type="button"
        className="sp-recents-clear-x"
        onClick={onClear}
        aria-label="Clear all recent searches"
      >
        <HiX />
      </button>
    </div>
  )
}

function RemoveButton({ onClick, label }) {
  return (
    <button
      type="button"
      className="sp-recent-remove"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
    >
      <HiX />
    </button>
  )
}

/* =============================================
   GAMES TAB
   ============================================= */

function GamesTabEmpty({ recents, onClearAll, onTapGame }) {
  if (!recents || recents.length === 0) return null
  return (
    <section className="sp-section sp-section--carousel">
      <RecentsHeader onClear={onClearAll} />
      <div className="sp-recent-cover-row">
        {recents.map((item) => (
          <button
            key={item.id}
            type="button"
            className="sp-recent-cover"
            onClick={() => onTapGame(item)}
            aria-label={item.name || 'Recent game'}
          >
            {item.coverUrl ? (
              <SharedCover gameId={item.id} imageSrc={item.coverUrl}>
                <img
                  src={item.coverUrl}
                  alt=""
                  className="sp-recent-cover__img"
                  loading="lazy"
                />
              </SharedCover>
            ) : (
              <CoverPlaceholder
                title={item.name}
                className="sp-recent-cover__img"
              />
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

function GamesTabResults({
  query,
  results,
  isLoading,
  error,
  focusedIndex,
  onTapGame,
  onTapDev,
  onTapGenre,
  onRetry,
  noResults,
  onClearQuery,
  genres,
  gamesResultsRef,
}) {
  if (isLoading) return <SearchResultSkeletonList count={8} />
  if (error) {
    return (
      <div className="sp-section" style={{ marginTop: 16 }}>
        <InlineErrorBanner
          message="Search failed. Please try again."
          onRetry={onRetry}
        />
      </div>
    )
  }
  if (noResults) {
    return (
      <div className="sp-empty">
        <EmptyState
          variant="search"
          copy={`No results for "${query.trim()}" — try a different spelling or browse by genre`}
          cta="Browse genres"
          onCta={onClearQuery}
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
    )
  }

  return (
    <div className="sp-results" role="listbox" aria-label="Search results">
      {results.genres.length > 0 && (
        <div className="sp-result-category">
          <h3 className="sp-result-category__header">Genres</h3>
          <div className="sp-genre-pills">
            {results.genres.map((genre) => (
              <button
                key={genre.key}
                className="sp-genre-pill"
                onClick={() => onTapGenre(genre.key)}
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
                onClick={() => onTapGame(game)}
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

      {results.developers.length > 0 && (
        <div className="sp-result-category">
          <h3 className="sp-result-category__header">Developers</h3>
          {results.developers.map((dev) => (
            <button
              key={dev.name}
              className="sp-result-row sp-result-row--dev"
              onClick={() => onTapDev(dev.name)}
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
  )
}

/* =============================================
   REVIEWS TAB
   ============================================= */

function ReviewsTabEmpty({ recents, onClearAll, onTapChip, onRemoveChip }) {
  if (!recents || recents.length === 0) return null
  return (
    <section className="sp-section">
      <RecentsHeader onClear={onClearAll} />
      <div className="sp-recent-stack">
        {recents.map((item) => (
          <div key={item.id} className="sp-recent-chip-row">
            <button
              type="button"
              className="sp-recent-chip"
              onClick={() => onTapChip(item.query)}
            >
              {item.query}
            </button>
            <RemoveButton
              onClick={() => onRemoveChip(item.id)}
              label={`Remove "${item.query}" from recent searches`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function ReviewsTabResults({ rows, isLoading }) {
  if (isLoading) {
    return (
      <div className="sp-section">
        <SearchResultSkeletonList count={4} />
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="sp-section">
        <p className="sp-noresults-text">No reviews match this search yet.</p>
      </div>
    )
  }
  return (
    <div className="sp-section sp-reviews-results">
      {rows.map((row) => (
        <ReviewCard key={row.id} review={reviewRowToCard(row)} variant="compact" />
      ))}
    </div>
  )
}

/* =============================================
   USERS TAB
   ============================================= */

function UserAvatar({ url, name }) {
  return (
    <div className="sp-user-avatar">
      <img
        src={url || avatarFallback(name)}
        alt=""
        loading="lazy"
        onError={(e) => {
          if (!e.currentTarget.dataset.fallback) {
            e.currentTarget.dataset.fallback = '1'
            e.currentTarget.src = avatarFallback(name)
          }
        }}
      />
    </div>
  )
}

/**
 * Inline Follow / Following toggle used by the Users tab rows. Owns
 * its own `isFollowing` lookup on mount + listens to the global
 * FOLLOW_CHANGED_EVENT so a follow triggered from another surface
 * (eg. Profile screen) keeps these rows in sync.
 *
 * Optimistic update + toast rollback on failure mirrors the Profile
 * Follow button — same UX contract.
 */
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
      .then((value) => {
        if (!cancelled) setFollowing(value)
      })
      .finally(() => {
        if (!cancelled) setResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [targetUserId, currentUserId, isSelf])

  // Sync with cross-surface follow events so Profile <-> Search rows
  // stay consistent without prop drilling.
  useEffect(() => {
    function handleChange(e) {
      if (!e?.detail) return
      const { followeeId, following: newState } = e.detail
      if (followeeId === targetUserId) {
        setFollowing(!!newState)
      }
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    return () => {
      window.removeEventListener(FOLLOW_CHANGED_EVENT, handleChange)
    }
  }, [targetUserId])

  const handleClick = useCallback(
    async (e) => {
      e.stopPropagation()
      if (!targetUserId || !currentUserId || isSelf || pending) return
      const wasFollowing = following
      setFollowing(!wasFollowing)
      setPending(true)
      try {
        if (wasFollowing) {
          await unfollowUser(targetUserId)
        } else {
          await followUser(targetUserId)
        }
      } catch (err) {
        setFollowing(wasFollowing)
        console.error('[search] follow toggle failed:', err)
        showToast(
          "Couldn't update follow status. Tap to retry.",
          'error',
          4000,
          { label: 'Retry', onClick: () => handleClick(e) }
        )
      } finally {
        setPending(false)
      }
    },
    [targetUserId, currentUserId, isSelf, pending, following]
  )

  if (isSelf) return null

  return (
    <button
      type="button"
      className={`sp-user-row__follow${
        following ? ' sp-user-row__follow--following' : ''
      }`}
      onClick={handleClick}
      disabled={!resolved || pending || !currentUserId}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${targetLabel}` : `Follow ${targetLabel}`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

function UsersTabEmpty({ recents, onClearAll, onTapUser, onRemoveUser }) {
  if (!recents || recents.length === 0) return null
  return (
    <section className="sp-section">
      <RecentsHeader onClear={onClearAll} />
      <div className="sp-recent-stack">
        {recents.map((item) => (
          <div key={item.id} className="sp-user-row">
            <button
              type="button"
              className="sp-user-row__main"
              onClick={() => onTapUser(item)}
            >
              <UserAvatar url={item.avatarUrl} name={item.displayName || item.username} />
              <div className="sp-user-row__text">
                <span className="sp-user-row__username">@{item.username}</span>
                {item.displayName && (
                  <span className="sp-user-row__display">{item.displayName}</span>
                )}
              </div>
            </button>
            <RemoveButton
              onClick={() => onRemoveUser(item.id)}
              label={`Remove ${item.username} from recent searches`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function UsersTabResults({ rows, isLoading, onTapUser, currentUserId }) {
  if (isLoading) {
    return (
      <div className="sp-section">
        <SearchResultSkeletonList count={5} />
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="sp-section">
        <p className="sp-noresults-text">No users found.</p>
      </div>
    )
  }
  return (
    <div className="sp-section sp-recent-stack">
      {rows.map((u) => {
        const username = u.username || ''
        const displayName = u.display_name || ''
        return (
          <div key={u.id} className="sp-user-row">
            <button
              type="button"
              className="sp-user-row__main"
              onClick={() =>
                onTapUser({
                  id: username || u.id,
                  username,
                  displayName,
                  avatarUrl: u.avatar_url || null,
                })
              }
            >
              <UserAvatar url={u.avatar_url} name={displayName || username} />
              <div className="sp-user-row__text">
                <span className="sp-user-row__username">
                  {username ? `@${username}` : displayName || 'Unknown'}
                </span>
                {displayName && username && (
                  <span className="sp-user-row__display">{displayName}</span>
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

/* =============================================
   LISTS TAB
   ============================================= */

function ListMosaic({ games }) {
  const slots = Array.from({ length: 6 })
  return (
    <div className="sp-list-mosaic">
      {slots.map((_, idx) => {
        const game = games?.[idx]
        if (game?.image) {
          return (
            <div key={idx} className="sp-list-mosaic__cell">
              <img src={game.image} alt="" loading="lazy" />
            </div>
          )
        }
        return (
          <div
            key={idx}
            className="sp-list-mosaic__cell sp-list-mosaic__cell--empty"
            aria-hidden="true"
          />
        )
      })}
    </div>
  )
}

function ListRow({ list, onTap, onRemove, removeLabel }) {
  return (
    <article className="sp-list-row">
      <button
        type="button"
        className="sp-list-row__main"
        onClick={() => onTap(list)}
      >
        <ListMosaic games={list.previewGames || list.games} />
        <div className="sp-list-row__body">
          <h3 className="sp-list-row__title">{list.name}</h3>
          {list.description && (
            <p className="sp-list-row__desc">{list.description}</p>
          )}
          <div className="sp-list-row__author">
            <UserAvatar
              url={list.author?.avatarUrl}
              name={list.author?.displayName || list.author?.username}
            />
            <span className="sp-list-row__author-name">
              {list.author?.username
                ? `@${list.author.username}`
                : list.author?.displayName || 'Unknown'}
            </span>
          </div>
          <div className="sp-list-row__meta">
            <span className="sp-list-row__meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {list.likeCount ?? 0}
            </span>
            <span className="sp-list-row__meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {list.commentCount ?? 0}
            </span>
            <span className="sp-list-row__meta-item sp-list-row__share">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </div>
        </div>
      </button>
      {onRemove && (
        <RemoveButton onClick={onRemove} label={removeLabel} />
      )}
    </article>
  )
}

function ListsTabEmpty({ recents, onClearAll, onTapList, onRemoveList }) {
  if (!recents || recents.length === 0) return null
  return (
    <section className="sp-section">
      <RecentsHeader onClear={onClearAll} />
      <div className="sp-recent-stack">
        {recents.map((item) => (
          <ListRow
            key={item.id}
            list={item}
            onTap={onTapList}
            onRemove={() => onRemoveList(item.id)}
            removeLabel={`Remove ${item.name} from recent searches`}
          />
        ))}
      </div>
    </section>
  )
}

function ListsTabResults({ rows, isLoading, onTapList }) {
  if (isLoading) {
    return (
      <div className="sp-section">
        <SearchResultSkeletonList count={4} />
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="sp-section">
        <p className="sp-noresults-text">No lists found.</p>
      </div>
    )
  }
  return (
    <div className="sp-section sp-recent-stack">
      {rows.map((list) => (
        <ListRow
          key={list.id}
          list={{ ...list, previewGames: list.games }}
          onTap={onTapList}
        />
      ))}
    </div>
  )
}

/* =============================================
   MAIN COMPONENT
   ============================================= */

function Search() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const currentUserId = user?.id || null
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  const blurTimerRef = useRef(null)
  const reviewsSubmitTimerRef = useRef(null)
  const [activeTab, setActiveTab] = useState('games')
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const [gamesResultsRef] = useAutoAnimateMotion()

  const trimmedQuery = query.trim()
  const hasQuery = trimmedQuery.length > 0
  const debouncedQuery = useDebounce(trimmedQuery, 300)

  // Per-tab recents (live across this and any other Search-mounted view).
  const gamesRecents = useRecents('games')
  const reviewsRecents = useRecents('reviews')
  const usersRecents = useRecents('users')
  const listsRecents = useRecents('lists')

  // Games tab still uses the existing useSearch hook (preserves the
  // Sprint 1 P4 developer routing — devs only flow through here).
  const { results: gameResults, isLoading: gamesLoading, error: gamesError } =
    useSearch(activeTab === 'games' ? query : '')

  const totalGameResultCount =
    gameResults.games.length +
    gameResults.genres.length +
    gameResults.developers.length

  const noGameResults =
    activeTab === 'games' &&
    hasQuery &&
    !gamesLoading &&
    !gamesError &&
    totalGameResultCount === 0

  // Reviews / Users / Lists searches — async, simple debounce on the query.
  const [reviewsRows, setReviewsRows] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [usersRows, setUsersRows] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [listsRows, setListsRows] = useState([])
  const [listsLoading, setListsLoading] = useState(false)

  // Browse-by-genre fallback (kept identical to the previous Search page).
  const [genres, setGenres] = useState(null)
  const [, setGenresLoading] = useState(true)
  const [, setGenresError] = useState(null)
  const [genresRetry] = useState(0)

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

  // Reviews tab — debounced search.
  useEffect(() => {
    if (activeTab !== 'reviews') return
    if (!debouncedQuery) {
      setReviewsRows([])
      setReviewsLoading(false)
      return
    }
    let cancelled = false
    setReviewsLoading(true)
    searchReviewsByText(debouncedQuery, 20)
      .then((rows) => {
        if (!cancelled) setReviewsRows(rows)
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, debouncedQuery])

  // Users tab — debounced search.
  useEffect(() => {
    if (activeTab !== 'users') return
    if (!debouncedQuery) {
      setUsersRows([])
      setUsersLoading(false)
      return
    }
    let cancelled = false
    setUsersLoading(true)
    searchUsers(debouncedQuery, 20)
      .then((rows) => {
        if (!cancelled) setUsersRows(rows)
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, debouncedQuery])

  // Lists tab — debounced search.
  useEffect(() => {
    if (activeTab !== 'lists') return
    if (!debouncedQuery) {
      setListsRows([])
      setListsLoading(false)
      return
    }
    let cancelled = false
    setListsLoading(true)
    searchPublicLists(debouncedQuery, 20)
      .then((rows) => {
        if (!cancelled) setListsRows(rows)
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, debouncedQuery])

  // Reviews tab "submit on pause" — 1.5s after the user stops typing,
  // record the query as a recent. Independent of the 300ms search debounce.
  useEffect(() => {
    if (reviewsSubmitTimerRef.current) {
      clearTimeout(reviewsSubmitTimerRef.current)
      reviewsSubmitTimerRef.current = null
    }
    if (activeTab !== 'reviews') return
    const t = trimmedQuery
    if (!t) return
    reviewsSubmitTimerRef.current = setTimeout(() => {
      addRecent('reviews', { id: t.toLowerCase(), query: t })
    }, REVIEWS_SUBMIT_AFTER_MS)
    return () => {
      if (reviewsSubmitTimerRef.current) {
        clearTimeout(reviewsSubmitTimerRef.current)
        reviewsSubmitTimerRef.current = null
      }
    }
  }, [activeTab, trimmedQuery])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setHasScrolled(el.scrollTop > 0)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setFocusedIndex(-1)
  }, [query, activeTab])

  /* ── Action callbacks ───────────────────────────────────────── */

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault()
      const t = query.trim()
      if (!t) return
      // Reviews tab: Enter immediately commits the query as a recent.
      if (activeTab === 'reviews') {
        addRecent('reviews', { id: t.toLowerCase(), query: t })
      }
      inputRef.current?.blur()
    },
    [query, activeTab]
  )

  const handleGameTap = useCallback(
    (game) => {
      addRecent('games', {
        id: game.id,
        name: game.title,
        coverUrl: game.image || null,
      })
      navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
    },
    [navigate]
  )

  const handleGenreTap = useCallback(
    (genreKey) => {
      navigate(`/browse/${genreKey}`)
    },
    [navigate]
  )

  // Sprint 1 P4: developer rows MUST route to /developer/:name. Do not change.
  const handleDevTap = useCallback(
    (devName) => {
      navigate(`/developer/${encodeURIComponent(devName)}`)
    },
    [navigate]
  )

  const handleClear = useCallback(() => {
    if (query.length > 0) {
      setQuery('')
      inputRef.current?.focus()
    } else {
      inputRef.current?.blur()
    }
  }, [query])

  const handleCancel = useCallback(() => {
    setQuery('')
    inputRef.current?.blur()
  }, [])

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

  const flatGameResults = useMemo(
    () => [
      ...gameResults.games.map((g) => ({ type: 'game', data: g })),
      ...gameResults.genres.map((g) => ({ type: 'genre', data: g })),
      ...gameResults.developers.map((d) => ({ type: 'developer', data: d })),
    ],
    [gameResults]
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        setQuery('')
        inputRef.current?.blur()
        return
      }
      if (activeTab !== 'games') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev < flatGameResults.length - 1 ? prev + 1 : prev
        )
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1))
      }
      if (
        e.key === 'Enter' &&
        focusedIndex >= 0 &&
        focusedIndex < flatGameResults.length
      ) {
        e.preventDefault()
        const item = flatGameResults[focusedIndex]
        if (item.type === 'game') handleGameTap(item.data)
        else if (item.type === 'genre') handleGenreTap(item.data.key)
        else if (item.type === 'developer') handleDevTap(item.data.name)
      }
    },
    [activeTab, flatGameResults, focusedIndex, handleGameTap, handleGenreTap, handleDevTap]
  )

  const showCancelBtn = isFocused || query.length > 0

  // Reviews recents tap → re-run the search.
  const handleReviewChipTap = useCallback(
    (queryText) => {
      setQuery(queryText)
      inputRef.current?.focus()
      // Don't double-add — addRecent dedupes by query so re-tapping just
      // bumps it to the top, which is fine.
      addRecent('reviews', {
        id: queryText.toLowerCase(),
        query: queryText,
      })
    },
    []
  )

  const handleUserTap = useCallback(
    (item) => {
      addRecent('users', {
        id: item.username || item.id,
        username: item.username,
        displayName: item.displayName,
        avatarUrl: item.avatarUrl || null,
      })
      if (item.username) navigate(`/user/${item.username}`)
    },
    [navigate]
  )

  const handleListTap = useCallback(
    (list) => {
      addRecent('lists', {
        id: list.id,
        name: list.name,
        description: list.description || '',
        author: list.author || null,
        previewGames: (list.games || list.previewGames || []).slice(0, 6),
      })
      navigate(`/list/${list.id}`)
    },
    [navigate]
  )

  // Duplicate ids for SharedCover (avoid layoutId collisions when a
  // recent cover and a search result render the same game side by side).
  const duplicateIds = useMemo(
    () => findDuplicateGameIds(gamesRecents, gameResults.games),
    [gamesRecents, gameResults.games]
  )

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="search-page" ref={scrollRef}>
      {/* Sticky header — search input + cancel button (UNCHANGED structure). */}
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
              aria-label="Search"
              inputMode="search"
              enterKeyHint="search"
              placeholder={
                activeTab === 'games'
                  ? 'Search games, genres, developers...'
                  : activeTab === 'reviews'
                  ? 'Search reviews...'
                  : activeTab === 'users'
                  ? 'Search users...'
                  : 'Search lists...'
              }
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
            {query.length > 0 && (
              <button
                type="button"
                className="sp-clear-btn"
                onClick={handleClear}
                aria-label="Clear search"
              >
                <HiX />
              </button>
            )}
          </div>
          {showCancelBtn && (
            <button
              type="button"
              className="sp-cancel-btn"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
        </form>

        {/* Tab bar sits below the input, above the content. */}
        <div className="sp-tabs" role="tablist" aria-label="Search categories">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`sp-tab${activeTab === tab.id ? ' sp-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <SharedCoverScope duplicateIds={duplicateIds}>
        <div className="sp-tab-content">
          {/* GAMES TAB */}
          {activeTab === 'games' && (
            <>
              {!hasQuery && (
                <>
                  <GamesTabEmpty
                    recents={gamesRecents}
                    onClearAll={() => clearRecents('games')}
                    onTapGame={(item) => {
                      addRecent('games', item)
                      navigate(`/game/${item.id}`, {
                        state: { coverImage: item.coverUrl },
                      })
                    }}
                  />
                  {/* Browse by Genre — kept unchanged from prior build. */}
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
                </>
              )}
              {hasQuery && (
                <GamesTabResults
                  query={query}
                  results={gameResults}
                  isLoading={gamesLoading}
                  error={gamesError}
                  focusedIndex={focusedIndex}
                  onTapGame={handleGameTap}
                  onTapDev={handleDevTap}
                  onTapGenre={handleGenreTap}
                  onRetry={() => setQuery((q) => q + ' ')}
                  noResults={noGameResults}
                  onClearQuery={handleCancel}
                  genres={genres}
                  gamesResultsRef={gamesResultsRef}
                />
              )}
            </>
          )}

          {/* REVIEWS TAB */}
          {activeTab === 'reviews' && (
            <>
              {!hasQuery && (
                <ReviewsTabEmpty
                  recents={reviewsRecents}
                  onClearAll={() => clearRecents('reviews')}
                  onTapChip={handleReviewChipTap}
                  onRemoveChip={(id) => removeRecent('reviews', id)}
                />
              )}
              {hasQuery && (
                <ReviewsTabResults rows={reviewsRows} isLoading={reviewsLoading} />
              )}
            </>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <>
              {!hasQuery && (
                <UsersTabEmpty
                  recents={usersRecents}
                  onClearAll={() => clearRecents('users')}
                  onTapUser={handleUserTap}
                  onRemoveUser={(id) => removeRecent('users', id)}
                />
              )}
              {hasQuery && (
                <UsersTabResults
                  rows={usersRows}
                  isLoading={usersLoading}
                  onTapUser={handleUserTap}
                  currentUserId={currentUserId}
                />
              )}
            </>
          )}

          {/* LISTS TAB */}
          {activeTab === 'lists' && (
            <>
              {!hasQuery && (
                <ListsTabEmpty
                  recents={listsRecents}
                  onClearAll={() => clearRecents('lists')}
                  onTapList={handleListTap}
                  onRemoveList={(id) => removeRecent('lists', id)}
                />
              )}
              {hasQuery && (
                <ListsTabResults
                  rows={listsRows}
                  isLoading={listsLoading}
                  onTapList={handleListTap}
                />
              )}
            </>
          )}
        </div>
      </SharedCoverScope>
    </div>
  )
}

export default Search
