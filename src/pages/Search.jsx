import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { HiX } from 'react-icons/hi'
import { SearchX } from 'lucide-react'
import {
  GiWizardStaff,
  GiBroadsword,
  GiChessKnight,
  GiCompass,
  GiPumpkinMask,
  GiSoccerBall,
} from 'react-icons/gi'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useSearch } from '../hooks/useSearch'
import { useDebounce } from '../hooks/useDebounce'
import {
  addRecent,
  removeRecent,
  clearRecents,
  useRecents,
} from '../utils/recentSearches'
import { shouldShowCount } from '../utils/formatSocialCount'
import { fetchBrowseCategories } from '../services/browseService'
import { fetchPopularThisWeek } from '../services/igdb'
import { getContinuePlayingGames } from '../services/libraryService'
import { getSizedImageUrl } from '../services/imageUtils'
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
import Avatar from '../components/Avatar'
import ListCoverCluster from '../components/ListCoverCluster'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Search.css'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'games', label: 'Games' },
  { id: 'devs', label: 'Devs' },
  { id: 'users', label: 'Users' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'lists', label: 'Lists' },
]

// Submit-on-pause window for the Reviews tab — adds to recents 1.5s after
// the user stops typing (per spec). Distinct from the 300ms search debounce.
const REVIEWS_SUBMIT_AFTER_MS = 1500

// Cobalt-system genre tiles — icon + name only, no cover photography or
// per-genre gradients. `accentVar` must be one of the three approved accent
// tokens (--accent / --accent-review / --accent-journal); no other hue may
// be introduced here, and orange/amber is retired app-wide.
const GENRE_CARDS = [
  { slug: 'rpg', name: 'RPG', Icon: GiWizardStaff, accentVar: '--accent-journal' },
  { slug: 'action', name: 'Action', Icon: GiBroadsword, accentVar: '--accent' },
  { slug: 'strategy', name: 'Strategy', Icon: GiChessKnight, accentVar: '--accent-review' },
  { slug: 'adventure', name: 'Adventure', Icon: GiCompass, accentVar: '--accent' },
  { slug: 'horror', name: 'Horror', Icon: GiPumpkinMask, accentVar: '--accent-journal' },
  { slug: 'sports', name: 'Sports', Icon: GiSoccerBall, accentVar: '--accent-review' },
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
   Shared "no results" state — Games / Devs / Users / All tabs
   ============================================= */

/**
 * Clean "no results" message + browse-by-genre nudge, shared by every
 * category tab so we never leave the user staring at a blank screen.
 */
function NoResultsState({ query, genres }) {
  return (
    <div className="sp-empty">
      <EmptyState
        icon={SearchX}
        title={`No results for "${query.trim()}".`}
        body="Check your spelling, or browse by genre below."
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

/* =============================================
   Shared result-row primitives — reused by their own tab AND by the
   "All" tab's categorized preview, so the two never drift apart.
   ============================================= */

function GameResultRow({ game, query, focused, onTap }) {
  return (
    <button
      className={`sp-result-row sp-result-row--game${
        focused ? ' sp-result-row--focused' : ''
      }`}
      onClick={() => onTap(game)}
      type="button"
      role="option"
      aria-selected={focused}
    >
      <div className="sp-result-cover">
        {game.image ? (
          <SharedCover gameId={game.id} imageSrc={game.image}>
            <img
              src={getSizedImageUrl(game.image, 52)}
              alt=""
              className="sp-result-cover__img"
              loading="lazy"
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
          <HighlightMatch text={game.title} query={query} />
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
  )
}

function DevIcon() {
  return (
    <div className="sp-dev-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M3 21h18" />
        <path d="M9 9h1M9 13h1M14 9h1M14 13h1" />
        <path d="M9 21v-4h6v4" />
      </svg>
    </div>
  )
}

function DevResultRow({ dev, query, onTap }) {
  return (
    <button
      className="sp-result-row sp-result-row--dev"
      onClick={() => onTap(dev.name)}
      type="button"
      role="option"
      aria-selected={false}
    >
      <DevIcon />
      <div className="sp-result-info">
        <span className="sp-result-title">
          <HighlightMatch text={dev.name} query={query} />
        </span>
        <span className="sp-result-meta">
          {dev.count} {dev.count === 1 ? 'game' : 'games'}
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
  )
}

function UserResultRow({ user, onTapUser, currentUserId }) {
  const username = user.username || ''
  const displayName = user.display_name || ''
  return (
    <div className="sp-user-row">
      <button
        type="button"
        className="sp-user-row__main"
        onClick={() =>
          onTapUser({
            id: username || user.id,
            username,
            displayName,
            avatarUrl: user.avatar_url || null,
          })
        }
      >
        <Avatar
          avatarUrl={user.avatar_url}
          name={displayName || username}
          seed={user.id}
          size="md"
          className="sp-user-avatar"
        />
        <div className="sp-user-row__text">
          <span className="sp-user-row__username">
            {username || displayName || 'Unknown'}
          </span>
          {displayName && username && (
            <span className="sp-user-row__display">{displayName}</span>
          )}
        </div>
      </button>
      <FollowButton
        targetUserId={user.id}
        targetLabel={username || displayName || 'user'}
        currentUserId={currentUserId}
      />
    </div>
  )
}

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
   ALL TAB — categorized preview (Games / Devs / Users) shown under
   section headers. Reuses the exact same query results the dedicated
   Games/Devs/Users tabs use (see useSearch + searchUsers calls in the
   main component below) — typing once never fires duplicate requests.
   No empty-state of its own: with no query it falls back to the same
   Games-tab landing content (Continue/Trending/Recents + genre browse).
   ============================================= */

function AllTabResults({
  query,
  gameResults,
  gamesLoading,
  gamesError,
  usersRows,
  usersLoading,
  onTapGame,
  onTapDev,
  onTapUser,
  onRetry,
  currentUserId,
  genres,
}) {
  if (gamesError) {
    return (
      <div className="sp-section" style={{ marginTop: 16 }}>
        <InlineErrorBanner
          message="Search failed. Please try again."
          onRetry={onRetry}
        />
      </div>
    )
  }

  const previewGames = gameResults.games.slice(0, 3)
  const previewDevs = gameResults.developers.slice(0, 3)
  const previewUsers = usersRows.slice(0, 3)

  const noResults =
    !gamesLoading &&
    !usersLoading &&
    previewGames.length === 0 &&
    previewDevs.length === 0 &&
    previewUsers.length === 0

  if (noResults) {
    return <NoResultsState query={query} genres={genres} />
  }

  return (
    <div className="sp-results" role="listbox" aria-label="Search results">
      {(gamesLoading || previewGames.length > 0) && (
        <div className="sp-result-category">
          <h3 className="sp-result-category__header">Games</h3>
          {gamesLoading ? (
            <SearchResultSkeletonList count={3} />
          ) : (
            previewGames.map((game) => (
              <GameResultRow
                key={game.id}
                game={game}
                query={query.trim()}
                focused={false}
                onTap={onTapGame}
              />
            ))
          )}
        </div>
      )}

      {(gamesLoading || previewDevs.length > 0) && (
        <div className="sp-result-category">
          <h3 className="sp-result-category__header">Developers</h3>
          {gamesLoading ? (
            <SearchResultSkeletonList count={2} />
          ) : (
            previewDevs.map((dev) => (
              <DevResultRow key={dev.name} dev={dev} query={query.trim()} onTap={onTapDev} />
            ))
          )}
        </div>
      )}

      {(usersLoading || previewUsers.length > 0) && (
        <div className="sp-result-category">
          <h3 className="sp-result-category__header">Users</h3>
          {usersLoading ? (
            <SearchResultSkeletonList count={3} />
          ) : (
            previewUsers.map((u) => (
              <UserResultRow key={u.id} user={u} onTapUser={onTapUser} currentUserId={currentUserId} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* =============================================
   GAMES TAB
   ============================================= */

function GamesTabEmpty({ recents, onClearAll, onTapGame, continuePlaying, trendingGames, trendingLoading }) {
  const hasContinue = continuePlaying && continuePlaying.length > 0
  const hasTrending = trendingGames && trendingGames.length > 0
  const hasRecents  = recents && recents.length > 0

  if (!hasContinue && !hasTrending && !hasRecents) return null

  return (
    <>
      {hasContinue && (
        <section className="sp-section sp-section--carousel">
          <h2 className="sp-section-header">Continue where you left off</h2>
          <div className="sp-recent-cover-row">
            {continuePlaying.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sp-recent-cover sp-recent-cover--labeled"
                onClick={() => onTapGame({ id: item.id, title: item.title ?? item.name, image: item.image ?? item.coverUrl ?? null })}
                aria-label={item.title ?? item.name ?? 'Game'}
              >
                {(item.image || item.coverUrl) ? (
                  <img
                    src={item.image ?? item.coverUrl}
                    alt=""
                    className="sp-recent-cover__img"
                    loading="lazy"
                  />
                ) : (
                  <CoverPlaceholder
                    title={item.title ?? item.name}
                    className="sp-recent-cover__img"
                  />
                )}
                <span className="sp-recent-cover__title">{item.title ?? item.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(hasTrending || trendingLoading) && (
        <section className="sp-section sp-section--carousel">
          <h2 className="sp-section-header">Trending this week</h2>
          {trendingLoading ? (
            <div className="sp-recent-cover-row">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="sp-recent-cover sp-recent-cover--skeleton" aria-hidden="true" />
              ))}
            </div>
          ) : (
            <div className="sp-recent-cover-row">
              {trendingGames.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="sp-recent-cover sp-recent-cover--labeled"
                  onClick={() => onTapGame(item)}
                  aria-label={item.title ?? item.name ?? 'Trending game'}
                >
                  {(item.image || item.coverUrl) ? (
                    <SharedCover gameId={item.id} imageSrc={item.image ?? item.coverUrl}>
                      <img
                        src={item.image ?? item.coverUrl}
                        alt=""
                        className="sp-recent-cover__img"
                        loading="lazy"
                      />
                    </SharedCover>
                  ) : (
                    <CoverPlaceholder
                      title={item.title ?? item.name}
                      className="sp-recent-cover__img"
                    />
                  )}
                  <span className="sp-recent-cover__title">{item.title ?? item.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {hasRecents && (
        <section className="sp-section sp-section--carousel">
          <RecentsHeader onClear={onClearAll} />
          <div className="sp-recent-cover-row sp-recent-cover-row--recents">
            {recents.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sp-recent-cover sp-recent-cover--labeled"
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
                <span className="sp-recent-cover__title">{item.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/**
 * Shared "no query yet" landing content for both the All and Games tabs —
 * Continue/Trending/Recents + Browse by genre. All is the new default tab,
 * but its empty state intentionally reuses this pre-existing content rather
 * than introducing a new design (empty-state styling is out of scope here).
 */
function SearchLandingEmpty({
  recents,
  onClearAll,
  onTapGame,
  continuePlaying,
  trendingGames,
  trendingLoading,
  onTapGenreCard,
}) {
  return (
    <>
      <GamesTabEmpty
        recents={recents}
        onClearAll={onClearAll}
        onTapGame={onTapGame}
        continuePlaying={continuePlaying}
        trendingGames={trendingGames}
        trendingLoading={trendingLoading}
      />
      {/* Browse by Genre — Cobalt surfaces + icon, no gradients. */}
      <section className="sp-section">
        <h2 className="sp-section-header">Browse by genre</h2>
        <div className="sp-genre-grid">
          {GENRE_CARDS.map((genre) => (
            <button
              key={genre.slug}
              className="sp-genre-tile"
              style={{ '--genre-tile-accent': `var(${genre.accentVar})` }}
              onClick={() => onTapGenreCard(genre.slug)}
              type="button"
            >
              <span className="sp-genre-tile__icon">
                <genre.Icon aria-hidden="true" />
              </span>
              <span className="sp-genre-tile__name">{genre.name}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

function GamesTabResults({
  query,
  results,
  isLoading,
  error,
  focusedIndex,
  onTapGame,
  onTapGenre,
  onRetry,
  noResults,
  genres,
  gamesResultsRef,
  parsedFilters,
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
    return <NoResultsState query={query} genres={genres} />
  }

  return (
    <div className="sp-results" role="listbox" aria-label="Search results">
      {parsedFilters && parsedFilters.length > 0 && (
        <div className="sp-active-filters" aria-label="Active filters">
          {parsedFilters.map((label) => (
            <span key={label} className="sp-filter-chip">{label}</span>
          ))}
        </div>
      )}

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
              <GameResultRow
                key={game.id}
                game={game}
                query={query.trim()}
                focused={focusedIndex === i}
                onTap={onTapGame}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* =============================================
   DEVS TAB
   ============================================= */

function DevsTabEmpty({ recents, onClearAll, onTapDev, onRemoveDev }) {
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
              onClick={() => onTapDev(item.name)}
            >
              <DevIcon />
              <div className="sp-user-row__text">
                <span className="sp-user-row__username">{item.name}</span>
              </div>
            </button>
            <RemoveButton
              onClick={() => onRemoveDev(item.id)}
              label={`Remove ${item.name} from recent searches`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function DevsTabResults({ query, developers, isLoading, error, onTapDev, onRetry, noResults, genres }) {
  if (isLoading) return <SearchResultSkeletonList count={6} />
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
    return <NoResultsState query={query} genres={genres} />
  }
  return (
    <div className="sp-results" role="listbox" aria-label="Developer results">
      <div className="sp-result-category">
        {developers.map((dev) => (
          <DevResultRow key={dev.name} dev={dev} query={query.trim()} onTap={onTapDev} />
        ))}
      </div>
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
        <EmptyState
          icon={SearchX}
          size="compact"
          title="No reviews match this search."
          body="Try a different search term."
        />
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
          err?.message || "Couldn't update follow status. Tap to retry.",
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
              <Avatar
                avatarUrl={item.avatarUrl}
                name={item.displayName || item.username}
                seed={item.id}
                size="md"
                className="sp-user-avatar"
              />
              <div className="sp-user-row__text">
                <span className="sp-user-row__username">{item.username}</span>
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

function UsersTabResults({ query, rows, isLoading, onTapUser, currentUserId, genres }) {
  if (isLoading) {
    return (
      <div className="sp-section">
        <SearchResultSkeletonList count={5} />
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return <NoResultsState query={query} genres={genres} />
  }
  return (
    <div className="sp-section sp-recent-stack">
      {rows.map((u) => (
        <UserResultRow key={u.id} user={u} onTapUser={onTapUser} currentUserId={currentUserId} />
      ))}
    </div>
  )
}

/* =============================================
   LISTS TAB
   ============================================= */

function ListRow({ list, onTap, onRemove, removeLabel }) {
  return (
    <article className="sp-list-row">
      <button
        type="button"
        className="sp-list-row__main"
        onClick={() => onTap(list)}
      >
        <ListCoverCluster
          games={list.previewGames || list.games}
          coverImageUrl={list.coverImageUrl}
          name={list.name}
          size="lg"
        />
        <div className="sp-list-row__body">
          <h3 className="sp-list-row__title">{list.name}</h3>
          {list.description && (
            <p className="sp-list-row__desc">{list.description}</p>
          )}
          <div className="sp-list-row__author">
            <Avatar
              avatarUrl={list.author?.avatarUrl}
              name={list.author?.displayName || list.author?.username}
              seed={list.author?.id}
              size="xs"
            />
            <span className="sp-list-row__author-name">
              {list.author?.username ||
                list.author?.displayName ||
                'Unknown'}
            </span>
          </div>
          <div className="sp-list-row__meta">
            <span className="sp-list-row__meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {shouldShowCount(list.likeCount) && list.likeCount}
            </span>
            <span className="sp-list-row__meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {shouldShowCount(list.commentCount) && list.commentCount}
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
        <EmptyState icon={SearchX} size="compact" title="No lists found." body="Try a different search term." />
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
  const [activeTab, setActiveTab] = useState('all')
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
  const devsRecents = useRecents('devs')
  const reviewsRecents = useRecents('reviews')
  const usersRecents = useRecents('users')
  const listsRecents = useRecents('lists')

  // Games/Devs/All all read from the same useSearch call (one IGDB request
  // per query, not three) — Sprint 1 P4's developer routing still flows
  // through here, just surfaced on its own tab now instead of inline.
  const gameSearchActive = activeTab === 'all' || activeTab === 'games' || activeTab === 'devs'
  const { results: gameResults, isLoading: gamesLoading, error: gamesError, parsedFilters } =
    useSearch(gameSearchActive ? query : '')

  // Pre-type suggestions: "continue" from local library + trending from IGDB.
  const [continuePlaying, setContinuePlaying] = useState([])
  const [trendingGames, setTrendingGames] = useState([])
  const [trendingLoading, setTrendingLoading] = useState(true)

  // Bumped on resume and threaded through the dependency array of every fetch
  // on this page. The WebView isn't remounted when the app returns to the
  // foreground, so these effects are the only thing standing between the user
  // and the suggestions/results they left behind — including a request that was
  // still in flight when the OS tore the socket down.
  const [resumeKey, setResumeKey] = useState(0)
  useEffect(() => {
    const onResume = () => setResumeKey((k) => k + 1)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])

  // Load once on mount — both are cheap (library = sync, trending = single IGDB call).
  useEffect(() => {
    setContinuePlaying(getContinuePlayingGames(5))
  }, [resumeKey])

  useEffect(() => {
    let cancelled = false
    setTrendingLoading(true)
    fetchPopularThisWeek()
      .then((games) => {
        if (!cancelled) setTrendingGames(games)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTrendingLoading(false)
      })
    return () => { cancelled = true }
  }, [resumeKey])

  // Games tab now shows only games + genre pills (developers moved to
  // their own tab), so "no results" for Games no longer factors devs in.
  const noGameResults =
    activeTab === 'games' &&
    hasQuery &&
    !gamesLoading &&
    !gamesError &&
    gameResults.games.length === 0 &&
    gameResults.genres.length === 0

  const noDevResults =
    activeTab === 'devs' &&
    hasQuery &&
    !gamesLoading &&
    !gamesError &&
    gameResults.developers.length === 0

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
  }, [genresRetry, resumeKey])

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
  }, [activeTab, debouncedQuery, resumeKey])

  // Users tab — debounced search. Also runs for the All tab so its
  // Users preview section shares this one query instead of firing a
  // second lookup when the user switches from All to Users.
  useEffect(() => {
    if (activeTab !== 'users' && activeTab !== 'all') return
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
  }, [activeTab, debouncedQuery, resumeKey])

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
  }, [activeTab, debouncedQuery, resumeKey])

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
      addRecent('devs', { id: devName.toLowerCase(), name: devName })
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

  // Developers are no longer rendered inline on the Games tab (they have
  // their own tab now), so keyboard nav here only walks games + genres.
  const flatGameResults = useMemo(
    () => [
      ...gameResults.games.map((g) => ({ type: 'game', data: g })),
      ...gameResults.genres.map((g) => ({ type: 'genre', data: g })),
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
      }
    },
    [activeTab, flatGameResults, focusedIndex, handleGameTap, handleGenreTap]
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
      if (item.username) {
        navigate(`/user/${encodeURIComponent(item.username)}`)
      } else if (item.id) {
        navigate(`/user/id/${encodeURIComponent(item.id)}`)
      }
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
                activeTab === 'all'
                  ? 'Search games, developers, users...'
                  : activeTab === 'games'
                  ? 'Search games or genres...'
                  : activeTab === 'devs'
                  ? 'Search developers...'
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
          {/* ALL TAB — default landing tab; empty state reuses the Games
              tab's existing landing content (out of scope to redesign). */}
          {activeTab === 'all' && (
            <>
              {!hasQuery && (
                <SearchLandingEmpty
                  recents={gamesRecents}
                  onClearAll={() => clearRecents('games')}
                  onTapGame={(item) => {
                    addRecent('games', item)
                    navigate(`/game/${item.id}`, {
                      state: { coverImage: item.image ?? item.coverUrl },
                    })
                  }}
                  continuePlaying={continuePlaying}
                  trendingGames={trendingGames}
                  trendingLoading={trendingLoading}
                  onTapGenreCard={(slug) => navigate(`/browse/${slug}`)}
                />
              )}
              {hasQuery && (
                <AllTabResults
                  query={query}
                  gameResults={gameResults}
                  gamesLoading={gamesLoading}
                  gamesError={gamesError}
                  usersRows={usersRows}
                  usersLoading={usersLoading}
                  onTapGame={handleGameTap}
                  onTapDev={handleDevTap}
                  onTapUser={handleUserTap}
                  onRetry={() => setQuery((q) => q + ' ')}
                  currentUserId={currentUserId}
                  genres={genres}
                />
              )}
            </>
          )}

          {/* GAMES TAB */}
          {activeTab === 'games' && (
            <>
              {!hasQuery && (
                <SearchLandingEmpty
                  recents={gamesRecents}
                  onClearAll={() => clearRecents('games')}
                  onTapGame={(item) => {
                    addRecent('games', item)
                    navigate(`/game/${item.id}`, {
                      state: { coverImage: item.image ?? item.coverUrl },
                    })
                  }}
                  continuePlaying={continuePlaying}
                  trendingGames={trendingGames}
                  trendingLoading={trendingLoading}
                  onTapGenreCard={(slug) => navigate(`/browse/${slug}`)}
                />
              )}
              {hasQuery && (
                <GamesTabResults
                  query={query}
                  results={gameResults}
                  isLoading={gamesLoading}
                  error={gamesError}
                  focusedIndex={focusedIndex}
                  onTapGame={handleGameTap}
                  onTapGenre={handleGenreTap}
                  onRetry={() => setQuery((q) => q + ' ')}
                  noResults={noGameResults}
                  genres={genres}
                  gamesResultsRef={gamesResultsRef}
                  parsedFilters={parsedFilters}
                />
              )}
            </>
          )}

          {/* DEVS TAB */}
          {activeTab === 'devs' && (
            <>
              {!hasQuery && (
                <DevsTabEmpty
                  recents={devsRecents}
                  onClearAll={() => clearRecents('devs')}
                  onTapDev={handleDevTap}
                  onRemoveDev={(id) => removeRecent('devs', id)}
                />
              )}
              {hasQuery && (
                <DevsTabResults
                  query={query}
                  developers={gameResults.developers}
                  isLoading={gamesLoading}
                  error={gamesError}
                  onTapDev={handleDevTap}
                  onRetry={() => setQuery((q) => q + ' ')}
                  noResults={noDevResults}
                  genres={genres}
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
                  query={query}
                  rows={usersRows}
                  isLoading={usersLoading}
                  onTapUser={handleUserTap}
                  currentUserId={currentUserId}
                  genres={genres}
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
