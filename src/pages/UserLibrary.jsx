import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Gamepad2, Lock } from 'lucide-react'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import { getGameTrackersForUser } from '../services/statsService'
import { TRACKER_STATUS } from '../services/libraryService'
import { getGamesByIds } from '../services/igdb'
import { STATUS_META } from '../components/StatusChip'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Pressable from '../components/Pressable'
import SharedCover from '../components/SharedCover'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './UserLibrary.css'

// game_trackers.status speaks a different vocabulary than the app's local
// status keys (see TRACKER_STATUS in libraryService.js) — this is the
// inverse map, built once from the single source of truth rather than
// duplicating the ('want_to_play'|'playing'|'played'|'dropped') strings
// here.
const LOCAL_STATUS_FROM_DB = Object.fromEntries(
  Object.entries(TRACKER_STATUS).map(([local, db]) => [db, local])
)

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'want', label: STATUS_META.want.label },
  { key: 'currently', label: STATUS_META.currently.label },
  { key: 'played', label: STATUS_META.played.label },
  { key: 'dropped', label: STATUS_META.dropped.label },
]

const PAGE_SIZE = 30

/**
 * Another user's tracked-games grid — the destination behind the Games
 * stat on a visitor profile (`/user/:username/library` and
 * `/user/id/:userId/library`).
 *
 * This is NOT Library.jsx and does not import from it: Library assembles
 * its grid from four localStorage buckets scoped to the signed-in device,
 * which cannot render another user's games. This screen instead reads
 * directly from `game_trackers`, filtered ONLY by the resolved profile
 * user's id (`useProfileRouteUser`), with no fallback to the viewer's own
 * id anywhere — a null/unresolved profile id renders an error state, never
 * a library. Visibility is enforced entirely by the existing
 * `trackers_select_visible` RLS policy; no privacy check is duplicated
 * here.
 *
 * Own profile never lands here in normal use (ProfilePlayerCard routes the
 * Games stat to `/library` instead), but a direct/deep link to this route
 * for yourself is still possible, so it redirects to `/library` rather
 * than rendering a read-only copy of your own data.
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
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const attemptedFallbackRef = useRef(new Set())

  // Never render this screen for the signed-in user's own profile — send
  // them to the real Library page instead. Gates the fetch below too, so
  // no game_trackers query for `userId === currentUserId` ever runs here.
  useEffect(() => {
    if (!resolving && isOwnProfile) {
      navigate('/library', { replace: true })
    }
  }, [resolving, isOwnProfile, navigate])

  useEffect(() => {
    if (resolving || !userId || isOwnProfile) return undefined
    let cancelled = false
    setLoading(true)
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
    return () => {
      cancelled = true
    }
  }, [userId, resolving, isOwnProfile])

  // Cover/title backfill — ONLY for rows whose game_trackers columns are
  // null, and only ever from IGDB by id (never a catalog-wide fetch).
  // Attempted ids are tracked so a game IGDB can't resolve (e.g. delisted)
  // doesn't get re-fetched on every render.
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

  // Reset pagination whenever the visible set could change shape.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [activeFilter])

  const counts = useMemo(() => {
    const c = { all: rows.length, want: 0, currently: 0, played: 0, dropped: 0 }
    for (const r of rows) {
      const local = LOCAL_STATUS_FROM_DB[r.status]
      if (local && c[local] != null) c[local] += 1
    }
    return c
  }, [rows])

  const filteredRows = useMemo(() => {
    if (activeFilter === 'all') return rows
    return rows.filter((r) => LOCAL_STATUS_FROM_DB[r.status] === activeFilter)
  }, [rows, activeFilter])

  const visibleRows = filteredRows.slice(0, visibleCount)
  const hasMore = filteredRows.length > visibleRows.length

  const showSkeleton = resolving || isOwnProfile || loading
  const displayName = user?.display_name || user?.username || ''

  // See gamesCountHint note above — this is the one place that heuristic
  // is applied. Zero rows + a nonzero earlier hint means "not visible to
  // you", not "no games yet".
  const isBlocked = !showSkeleton && rows.length === 0 && gamesCountHint != null && gamesCountHint > 0
  const isEmpty = !showSkeleton && rows.length === 0 && !isBlocked

  return (
    <div className="user-library">
      <header className="user-library__header">
        <button
          type="button"
          className="user-library__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="user-library__heading">
          <h1 className="user-library__title">{displayName || 'Library'}</h1>
          {!showSkeleton && !notFound && !isBlocked && (
            <p className="user-library__header-count">
              {rows.length} {rows.length === 1 ? 'game' : 'games'}
            </p>
          )}
        </div>
        <span className="user-library__spacer" aria-hidden="true" />
      </header>

      <div className="user-library__body">
        {notFound ? (
          <p className="user-library__notice">
            This user doesn&apos;t exist or has been removed.
          </p>
        ) : showSkeleton ? (
          <>
            <div className="user-library__chips" aria-hidden="true">
              {STATUS_FILTERS.map((f) => (
                <Skeleton key={f.key} variant="rect" width={f.key === 'all' ? 52 : 96} height={34} className="user-library__chip-skeleton" />
              ))}
            </div>
            <div className="user-library__grid" aria-busy="true">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="user-library__cover-skeleton" />
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
        ) : isEmpty ? (
          <EmptyState
            icon={Gamepad2}
            size="compact"
            body={`${displayName || 'This player'} hasn't tracked any games yet.`}
          />
        ) : (
          <>
            <div className="user-library__chips" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => {
                const active = activeFilter === f.key
                const count = counts[f.key] ?? 0
                const colorVar = f.key === 'all' ? null : STATUS_META[f.key]?.colorVar
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={`user-library__chip${active ? ' user-library__chip--active' : ''}`}
                    style={colorVar ? { '--ul-chip-color': `var(${colorVar})` } : undefined}
                    aria-pressed={active}
                    onClick={() => setActiveFilter(f.key)}
                  >
                    {f.label}
                    <span className="user-library__chip-count">{count}</span>
                  </button>
                )
              })}
            </div>

            {filteredRows.length === 0 ? (
              <EmptyState
                icon={Gamepad2}
                size="compact"
                body="No games match this filter."
              />
            ) : (
              <>
                <div className="user-library__grid" aria-label={`${displayName || 'Player'}'s games`}>
                  {visibleRows.map((g) => (
                    <Pressable
                      key={g.igdbGameId}
                      className="user-library__poster"
                      onClick={() =>
                        navigate(
                          `/game/${g.igdbGameId}`,
                          g.image ? { state: { coverImage: g.image } } : undefined
                        )
                      }
                      aria-label={g.title ? `Open ${g.title}` : 'Open game'}
                    >
                      <div className="user-library__cover">
                        <SharedCover gameId={g.igdbGameId} imageSrc={g.image || COVER_FALLBACK}>
                          <img
                            src={g.image || COVER_FALLBACK}
                            alt=""
                            className="user-library__cover-img"
                            loading="lazy"
                            draggable={false}
                            onError={(e) => { e.target.src = COVER_FALLBACK }}
                          />
                        </SharedCover>
                      </div>
                      {g.title ? (
                        <span className="user-library__poster-title">{g.title}</span>
                      ) : null}
                    </Pressable>
                  ))}
                </div>
                {hasMore && (
                  <button
                    type="button"
                    className="user-library__loadmore"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  >
                    Show more
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default UserLibrary
