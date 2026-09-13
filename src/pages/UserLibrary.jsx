import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Gamepad2, Lock, List, FilterX } from 'lucide-react'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import { getGameTrackersForUser } from '../services/statsService'
import { TRACKER_STATUS } from '../services/libraryService'
import { getGamesByIds } from '../services/igdb'
import { getListsForUser, getSaveCountsForLists } from '../services/listService'
import { getGameNavStub } from '../utils/gameNavStub'
import EmptyState from '../components/EmptyState'
import { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { STATUS_CELLS, LIBRARY_SORTS, LIBRARY_PAGE_SIZE, readLibraryView, writeLibraryView } from '../components/library/libraryConstants'
import LibraryAmbientWash from '../components/library/LibraryAmbientWash'
import LibraryHeader from '../components/library/LibraryHeader'
import LibraryTabs from '../components/library/LibraryTabs'
import LibraryStatBar from '../components/library/LibraryStatBar'
import LibrarySortRow from '../components/library/LibrarySortRow'
import LibrarySortSheet from '../components/library/LibrarySortSheet'
import LibraryGameGrid from '../components/library/LibraryGameGrid'
import LibraryListsPanel from '../components/library/LibraryListsPanel'
import {
  useLibrarySearch,
  LibrarySearchToggle,
  LibrarySearchPanel,
} from '../components/library/LibrarySearch'
import './Library.css'

// game_trackers.status speaks a different vocabulary than the app's local
// status keys (see TRACKER_STATUS in libraryService.js) — this is the
// inverse map, built once from the single source of truth rather than
// duplicating the ('want_to_play'|'playing'|'played'|'dropped') strings
// here.
const LOCAL_STATUS_FROM_DB = Object.fromEntries(
  Object.entries(TRACKER_STATUS).map(([local, db]) => [db, local])
)

const PAGE_SIZE = LIBRARY_PAGE_SIZE

/**
 * Another user's library — the destination behind the Games stat on a
 * visitor profile (`/user/:username/library` and `/user/id/:userId/library`).
 *
 * This is NOT Library.jsx and does not import from it: Library assembles
 * its grid from four localStorage buckets scoped to the signed-in device,
 * which cannot render another user's games. This screen instead reads
 * directly from `game_trackers`, filtered ONLY by the resolved profile
 * user's id (`useProfileRouteUser`), with no fallback to the viewer's own
 * id anywhere — a null/unresolved profile id renders an error state, never
 * a library. Visibility is enforced entirely by the existing
 * `trackers_select_visible` RLS policy; no privacy check is duplicated
 * here. Lists come from getListsForUser on that same profile id; RLS
 * `lists_select_public_or_own` means a visitor sees only PUBLIC lists.
 *
 * Own profile never lands here in normal use (ProfilePlayerCard routes the
 * Games stat to `/library` instead), but a direct/deep link to this route
 * for yourself is still possible, so it redirects to `/library` rather
 * than rendering a read-only copy of your own data.
 *
 * Search is a client-side title substring over THIS user's already-loaded
 * trackers. It never queries IGDB and never reads the viewer's library.
 */
function UserLibrary() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userId, user, resolving, notFound, isOwnProfile } = useProfileRouteUser()

  // Captured from the Games stat at the moment it was tapped (see
  // Profile.jsx's onGamesClick) — a snapshot from *before* this screen's
  // own fresh, RLS-gated query runs. If that earlier snapshot said the
  // user has games but this screen's query comes back empty, the gap is
  // a visibility change (block, or activity_privacy tightened), not the
  // user having zero games. A direct deep link with no hint falls back to
  // treating a zero-row result as genuinely empty, which is the safest
  // default with no other signal available.
  const gamesCountHint = location.state?.gamesCountHint ?? null

  const [rows, setRows] = useState([])
  const [customLists, setCustomLists] = useState([])
  const [saveCounts, setSaveCounts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [isLoadingLists, setIsLoadingLists] = useState(true)
  const [errorLists, setErrorLists] = useState(false)
  const [activeTab, setActiveTab] = useState('games')
  const [activeStatus, setActiveStatus] = useState(null)
  const [sortKey, setSortKey] = useState('recent')
  const [viewKey, setViewKey] = useState(readLibraryView)
  const [showSortSheet, setShowSortSheet] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const {
    open: searchOpen,
    query: searchQuery,
    setQuery: setSearchQuery,
    toggle: toggleSearch,
    clear: clearSearch,
    inputRef: searchInputRef,
  } = useLibrarySearch()

  const attemptedFallbackRef = useRef(new Set())

  // Never render this screen for the signed-in user's own profile — send
  // them to the real Library page instead. Gates the fetch below too, so
  // no game_trackers query for `userId === currentUserId` ever runs here.
  useEffect(() => {
    if (!resolving && isOwnProfile) {
      navigate('/library', { replace: true })
    }
  }, [resolving, isOwnProfile, navigate])

  // CRITICAL: fetch ONLY when the profile user id is a concrete value.
  // Never fall back to the viewer's auth.uid() — that would paint the
  // viewer's own library under someone else's name.
  useEffect(() => {
    if (resolving || isOwnProfile) return undefined
    if (!userId) {
      setRows([])
      setCustomLists([])
      setSaveCounts(new Map())
      setLoading(false)
      setIsLoadingLists(false)
      setErrorLists(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setIsLoadingLists(true)
    setErrorLists(false)

    getGameTrackersForUser(userId)
      .then((data) => {
        if (cancelled) return
        setRows(data)
      })
      .catch((err) => {
        console.error('[user-library] load failed:', err)
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    getListsForUser(userId)
      .then(async (lists) => {
        if (cancelled) return
        const counts = await getSaveCountsForLists(lists.map((l) => l.id))
        if (cancelled) return
        setCustomLists(lists)
        setSaveCounts(counts)
      })
      .catch((err) => {
        console.error('[user-library] lists load failed:', err)
        if (!cancelled) {
          setCustomLists([])
          setErrorLists(true)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLists(false)
      })

    return () => {
      cancelled = true
    }
  }, [userId, resolving, isOwnProfile])

  // Cover/title backfill — ONLY for rows whose game_trackers columns are
  // null, and only ever from IGDB by id (never a catalog-wide fetch).
  // Attempted ids are tracked so a game IGDB can't resolve (e.g. delisted)
  // doesn't get re-fetched on every render. Search never goes through here.
  useEffect(() => {
    const missing = rows.filter(
      (r) => (!r.title || !r.image) && !attemptedFallbackRef.current.has(r.igdbGameId)
    )
    if (missing.length === 0) return undefined
    const ids = missing.map((r) => r.igdbGameId)
    for (const id of ids) attemptedFallbackRef.current.add(id)

    let cancelled = false
    getGamesByIds(ids)
      .then((games) => {
        if (cancelled) return
        const byId = new Map(games.map((g) => [Number(g.id), g]))
        setRows((prev) =>
          prev.map((r) => {
            if (r.title && r.image) return r
            const fallback = byId.get(r.igdbGameId)
            if (!fallback) return r
            return {
              ...r,
              title: r.title || fallback.title || null,
              image: r.image || fallback.image || null,
            }
          })
        )
      })
      .catch((err) => {
        console.error('[user-library] igdb fallback failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [rows])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [activeTab, activeStatus, searchQuery, sortKey])

  // Reset chrome when the profile user changes so a previous search /
  // filter never leaks onto the next person.
  useEffect(() => {
    setActiveTab('games')
    setActiveStatus(null)
    clearSearch()
    setSortKey('recent')
  }, [userId, clearSearch])

  // Tracker rows → the same card shape LibraryGameGrid expects. Built
  // only from this profile user's game_trackers — never localStorage.
  const games = useMemo(
    () =>
      rows.map((r) => ({
        id: r.igdbGameId,
        title: r.title || '',
        image: r.image || null,
        addedAt: r.updatedAt || null,
        _status: LOCAL_STATUS_FROM_DB[r.status] || null,
      })),
    [rows]
  )

  const counts = useMemo(() => {
    const c = {}
    for (const cell of STATUS_CELLS) {
      c[cell.key] = games.filter((g) => g._status === cell.key).length
    }
    return c
  }, [games])

  // Title substring only, over THIS user's games, respecting the active
  // status filter. Never IGDB, never the viewer's library.
  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return games.filter((g) => {
      if (activeStatus && g._status !== activeStatus) return false
      if (q && !(g.title || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [games, activeStatus, searchQuery])

  const sortedGames = useMemo(() => {
    const list = filteredGames.slice()
    if (sortKey === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else {
      list.sort(
        (a, b) =>
          new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
      )
    }
    return list
  }, [filteredGames, sortKey])

  const visibleGames = sortedGames.slice(0, visibleCount)
  const hasMore = sortedGames.length > visibleGames.length
  const duplicateIds = useMemo(() => findDuplicateGameIds(visibleGames), [visibleGames])

  const pinnedLists = useMemo(
    () =>
      customLists
        .filter((l) => l.isPinned)
        .sort((a, b) => new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0)),
    [customLists]
  )

  const handleStatusTap = useCallback((key) => {
    setActiveStatus((current) => (current === key ? null : key))
  }, [])

  const showSkeleton = resolving || isOwnProfile || loading
  const displayName = user?.display_name || user?.username || ''
  const pageTitle = displayName || 'Library'
  const isGamesTab = activeTab === 'games'
  const sortLabel = LIBRARY_SORTS.find((s) => s.key === sortKey)?.label || 'Recent'

  // Missing profile id after resolve: error, never a library. This is
  // the catastrophic-bug guard — do not invent a user to fetch against.
  const missingProfileId = !resolving && !isOwnProfile && !userId

  const isBlocked =
    !showSkeleton &&
    !missingProfileId &&
    rows.length === 0 &&
    gamesCountHint != null &&
    gamesCountHint > 0

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="library-page library-page--visitor">
        <LibraryAmbientWash isGamesTab={isGamesTab} />

        <LibraryHeader
          title={pageTitle}
          onBack={() => navigate(-1)}
          actions={
            !notFound && !missingProfileId ? (
              <LibrarySearchToggle open={searchOpen} onToggle={toggleSearch} />
            ) : null
          }
        />
        <LibrarySearchPanel
          open={searchOpen}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClear={clearSearch}
          inputRef={searchInputRef}
        />

        {notFound || missingProfileId ? (
          <p className="lib-visitor-notice">
            {notFound
              ? "This user doesn't exist or has been removed."
              : "This library isn't available."}
          </p>
        ) : showSkeleton ? (
          <>
            <LibraryTabs
              activeTab="games"
              gamesCount={0}
              listsCount={0}
              onTabChange={() => {}}
            />
            <LibraryStatBar counts={{}} activeStatus={null} onStatusTap={() => {}} />
            <div className="lib-grid3" aria-busy="true" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="skeleton lib-cov" />
              ))}
            </div>
          </>
        ) : isBlocked ? (
          <EmptyState
            icon={Lock}
            size="compact"
            title="This library isn't visible to you"
            body={`${displayName || 'This player'}'s tracked games aren't visible from your account.`}
          />
        ) : (
          <>
            <LibraryTabs
              activeTab={activeTab}
              gamesCount={games.length}
              listsCount={customLists.length}
              onTabChange={setActiveTab}
            />

            {isGamesTab ? (
              <div id="lib-panel-games" role="tabpanel" aria-labelledby="lib-tab-games" className="lib-tabpanel">
                <LibraryStatBar
                  counts={counts}
                  activeStatus={activeStatus}
                  onStatusTap={handleStatusTap}
                />

                <LibrarySortRow
                  count={sortedGames.length}
                  sortLabel={sortLabel}
                  onSortClick={() => setShowSortSheet(true)}
                />

                <section className="lib-grid-section" aria-label={`${displayName || 'Player'}'s games`}>
                  {games.length === 0 ? (
                    <EmptyState
                      icon={Gamepad2}
                      size="compact"
                      body={`${displayName || 'This player'} hasn't tracked any games yet.`}
                    />
                  ) : sortedGames.length === 0 ? (
                    <EmptyState
                      icon={FilterX}
                      size="compact"
                      body="No games match this filter."
                      cta="Clear filter"
                      ctaVariant="secondary"
                      onCta={() => {
                        setActiveStatus(null)
                        clearSearch()
                      }}
                    />
                  ) : (
                    <LibraryGameGrid
                      games={visibleGames}
                      view={viewKey}
                      hasMore={hasMore}
                      onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      ariaLabel={`${displayName || 'Player'}'s games`}
                      onGameClick={(g) => navigate(`/game/${g.id}`, { state: getGameNavStub(g) })}
                    />
                  )}
                </section>
              </div>
            ) : (
              <div id="lib-panel-lists" role="tabpanel" aria-labelledby="lib-tab-lists" className="lib-lists-panel lib-tabpanel">
                <LibraryListsPanel
                  lists={customLists}
                  pinnedLists={pinnedLists}
                  saveCounts={saveCounts}
                  isLoading={isLoadingLists}
                  error={errorLists}
                  onRetry={() => {
                    if (!userId) return
                    setIsLoadingLists(true)
                    setErrorLists(false)
                    getListsForUser(userId)
                      .then(async (lists) => {
                        setCustomLists(lists)
                        setSaveCounts(await getSaveCountsForLists(lists.map((l) => l.id)))
                      })
                      .catch((err) => {
                        console.error('[user-library] lists retry failed:', err)
                        setCustomLists([])
                        setErrorLists(true)
                      })
                      .finally(() => setIsLoadingLists(false))
                  }}
                  onOpenList={(list) => navigate(`/list/${list.id}`)}
                  errorMessage="Couldn't load lists. Tap to retry."
                  empty={
                    <EmptyState
                      icon={List}
                      size="compact"
                      title="No public lists"
                      body={`${displayName || 'This player'} hasn't published any lists yet.`}
                    />
                  }
                />
              </div>
            )}
          </>
        )}

        <LibrarySortSheet
          isOpen={showSortSheet}
          onClose={() => setShowSortSheet(false)}
          sortKey={sortKey}
          onSelect={setSortKey}
          viewKey={viewKey}
          onViewSelect={(key) => {
            setViewKey(key)
            writeLibraryView(key)
          }}
        />
      </div>
    </SharedCoverScope>
  )
}

export default UserLibrary
