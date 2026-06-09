import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import { List } from 'lucide-react'
import CreateListModal from '../components/CreateListModal'
import EmptyState from '../components/EmptyState'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { showToast } from '../components/Toast'
import InlineErrorBanner from '../components/InlineErrorBanner'
import {
  initializeLibrary,
  getGamesFromList,
  getGameProgress,
} from '../services/libraryService'
import {
  getListsForUser,
  createList,
  addGameToList,
} from '../services/listService'
import { getTimeToBeat } from '../services/timeToBeatService'
import './Library.css'

// Mandatory tracker lists that live in localStorage (not Supabase). The
// order here is the canonical render order on the Library page.
const TRACKERS = [
  { id: 'currently-playing', name: 'Currently Playing' },
  { id: 'played', name: 'Played' },
  { id: 'want-to-play', name: 'Want to Play' },
]

// Fan offsets for the 3-cover stack on each tracker card. Matches the
// Sprint 1 Want to Play pattern (back-left → center → back-right).
const TRACKER_FAN = [
  { x: -22, r: -8, z: 1 },
  { x: 0, r: 0, z: 3 },
  { x: 22, r: 8, z: 2 },
]

// Returns the most-recent "touched" timestamp for a game across all known
// signals (addedAt, lastPlayedAt, playedFirstAt). Falls back to 0 so the
// sort is stable when nothing is recorded.
function getTouchedAt(game) {
  const progress = getGameProgress(game.id) || {}
  const candidates = [
    game.addedAt,
    progress.lastPlayedAt,
    progress.playedFirstAt,
  ]
    .filter(Boolean)
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n))
  return candidates.length ? Math.max(...candidates) : 0
}

function Library() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [trackerLists, setTrackerLists] = useState({})
  const [customLists, setCustomLists] = useState([])
  const [isLoadingCustom, setIsLoadingCustom] = useState(true)
  const [errorCustom, setErrorCustom] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  // Backlog hours: sum of main-story times for Want-to-Play games that have TTB data
  const [backlogHours, setBacklogHours] = useState({ totalHours: null, withoutEstimates: 0 })

  const [trackersRef] = useAutoAnimateMotion()
  const [customGridRef] = useAutoAnimateMotion()

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadTrackerLists = useCallback(() => {
    initializeLibrary()
    const snap = {}
    for (const { id } of TRACKERS) {
      snap[id] = { games: getGamesFromList(id) }
    }
    setTrackerLists(snap)
  }, [])

  const loadCustomLists = useCallback(async () => {
    if (!user?.id) {
      setCustomLists([])
      setIsLoadingCustom(false)
      setErrorCustom(false)
      return
    }
    setIsLoadingCustom(true)
    setErrorCustom(false)
    try {
      const lists = await getListsForUser(user.id)
      setCustomLists(lists)
    } catch (err) {
      console.error('[library] failed to load custom lists:', err)
      setErrorCustom(true)
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

  // Compute total backlog hours from TTB data for Want-to-Play games.
  // Runs whenever the want-to-play list changes. Fetches are parallelized
  // and hit the dual-layer cache so repeat visits are instant.
  useEffect(() => {
    const wantGames = trackerLists['want-to-play']?.games || []
    if (wantGames.length === 0) {
      setBacklogHours({ totalHours: null, withoutEstimates: 0 })
      return
    }
    let cancelled = false
    Promise.all(
      wantGames.map((g) => (g.id ? getTimeToBeat(g.id) : Promise.resolve(null)))
    ).then((results) => {
      if (cancelled) return
      let totalSeconds = 0
      let withoutEstimates = 0
      for (const ttb of results) {
        if (ttb?.normallySeconds != null && ttb.normallySeconds > 0) {
          totalSeconds += ttb.normallySeconds
        } else {
          withoutEstimates++
        }
      }
      setBacklogHours({
        totalHours: totalSeconds > 0 ? Math.round(totalSeconds / 3600) : null,
        withoutEstimates,
      })
    })
    return () => { cancelled = true }
  }, [trackerLists])

  // ── Derived data ──────────────────────────────────────────────────────────

  // Total games across all trackers. Status is mutually exclusive so games
  // are never double-counted across the three lists.
  const totalTracked = useMemo(() => {
    return TRACKERS.reduce(
      (sum, { id }) => sum + (trackerLists[id]?.games?.length || 0),
      0,
    )
  }, [trackerLists])

  // 5 most-recently-touched games for the hero strip. Dedupe by gameId
  // (defensive — status is mutually exclusive but a stale tracker entry
  // could otherwise duplicate).
  const recentlyTouched = useMemo(() => {
    const byId = new Map()
    for (const { id } of TRACKERS) {
      const games = trackerLists[id]?.games || []
      for (const g of games) {
        if (!g?.id) continue
        const touchedAt = getTouchedAt(g)
        const prev = byId.get(g.id)
        if (!prev || touchedAt > prev.touchedAt) {
          byId.set(g.id, { ...g, touchedAt })
        }
      }
    }
    return Array.from(byId.values())
      .sort((a, b) => b.touchedAt - a.touchedAt)
      .slice(0, 5)
  }, [trackerLists])

  // For each tracker card: the 3 most-recently-added covers. Tracker
  // localStorage doesn't track per-game lastPlayedAt the way the hero
  // strip does, so we sort by addedAt here — that's what "most recent in
  // this tracker" means.
  const trackerPreviews = useMemo(() => {
    const result = {}
    for (const { id } of TRACKERS) {
      const games = (trackerLists[id]?.games || [])
        .slice()
        .sort((a, b) => {
          const da = new Date(a.addedAt || 0).getTime()
          const db = new Date(b.addedAt || 0).getTime()
          return db - da
        })
      result[id] = {
        count: games.length,
        previews: games.slice(0, 3),
      }
    }
    return result
  }, [trackerLists])

  // Dedupe set for SharedCover so the same game appearing in multiple
  // visible mosaics / fans doesn't trigger a conflicting layoutId match.
  const duplicateIds = useMemo(() => {
    const all = []
    for (const { id } of TRACKERS) {
      all.push(trackerPreviews[id]?.previews || [])
    }
    for (const list of customLists) {
      all.push((list.games || []).slice(0, 4))
    }
    all.push(recentlyTouched)
    return findDuplicateGameIds(...all)
  }, [trackerPreviews, customLists, recentlyTouched])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateList = async (listName, description, initialGames) => {
    const listId = await createList({ name: listName, description, isPublic: true })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  const handleTrackerClick = (trackerId) => {
    navigate(`/list/${trackerId}`)
  }

  const handleCustomListClick = (listId) => {
    navigate(`/list/${listId}`)
  }

  const handleRecentCoverClick = (gameId) => {
    navigate(`/game/${gameId}`)
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderTrackerCard = ({ id, name }) => {
    const { count, previews } = trackerPreviews[id] || { count: 0, previews: [] }
    const isEmpty = previews.length === 0

    return (
      <button
        key={id}
        type="button"
        className={`lib-tracker-card${isEmpty ? ' lib-tracker-card--empty' : ''}`}
        onClick={() => handleTrackerClick(id)}
        aria-label={`Open ${name} (${count} ${count === 1 ? 'game' : 'games'})`}
      >
        <div className="lib-tracker-text">
          <h3 className="lib-tracker-title">{name}</h3>
          <p className="lib-tracker-count">
            {count} {count === 1 ? 'game' : 'games'}
          </p>
          {id === 'want-to-play' && backlogHours.totalHours !== null && (
            <p className="lib-tracker-backlog-hint">
              ~{backlogHours.totalHours.toLocaleString()} hrs
            </p>
          )}
        </div>

        <div className="lib-tracker-fan-wrap">
          {isEmpty ? (
            <div className="lib-tracker-empty">
              <div className="lib-tracker-empty-silhouette" aria-hidden="true" />
              <span className="lib-tracker-empty-copy">Nothing here yet</span>
            </div>
          ) : (
            <div className="lib-tracker-fan" aria-hidden="true">
              {previews.map((g, idx) => {
                const cfg = TRACKER_FAN[idx] || TRACKER_FAN[0]
                return (
                  <div
                    key={g.id}
                    className="lib-tracker-fan-card"
                    style={{
                      '--fan-x': `${cfg.x}px`,
                      '--fan-r': `${cfg.r}deg`,
                      zIndex: cfg.z,
                    }}
                  >
                    {g.image ? (
                      <SharedCover gameId={g.id} imageSrc={g.image}>
                        <img
                          src={g.image}
                          alt=""
                          className="lib-tracker-fan-img"
                          loading="lazy"
                          draggable={false}
                        />
                      </SharedCover>
                    ) : (
                      <div className="lib-tracker-fan-fallback">
                        {g.title?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </button>
    )
  }

  const renderCustomListCard = (list) => {
    const { id, name, games = [], gameCount = 0, coverImageUrl } = list
    const mosaic = games.slice(0, 4)
    const placeholders = Math.max(0, 4 - mosaic.length)

    const mosaicAlt = mosaic.length > 0
      ? `${name} — covers of ${mosaic.map((g) => g.title).filter(Boolean).join(', ')}`
      : `${name} cover`

    return (
      <button
        key={id}
        type="button"
        className="lib-list-card"
        onClick={() => handleCustomListClick(id)}
        aria-label={`Open list ${name} (${gameCount} ${gameCount === 1 ? 'game' : 'games'})`}
      >
        {coverImageUrl ? (
          <div className="lib-list-mosaic lib-list-mosaic--custom-cover">
            <img
              src={coverImageUrl}
              alt={`${name} cover`}
              className="lib-list-cover-img"
              loading="lazy"
              draggable={false}
            />
          </div>
        ) : (
          <div className="lib-list-mosaic" role="img" aria-label={mosaicAlt}>
            {mosaic.map((g) => (
              <div key={g.id} className="lib-list-mosaic-cell">
                {g.image ? (
                  <SharedCover gameId={g.id} imageSrc={g.image}>
                    <img
                      src={g.image}
                      alt=""
                      className="lib-list-mosaic-img"
                      loading="lazy"
                      draggable={false}
                    />
                  </SharedCover>
                ) : (
                  <div className="lib-list-mosaic-fallback">
                    {g.title?.charAt(0) || '?'}
                  </div>
                )}
              </div>
            ))}
            {Array.from({ length: placeholders }).map((_, i) => (
              <div
                key={`ph-${i}`}
                className="lib-list-mosaic-cell lib-list-mosaic-cell--empty"
              />
            ))}
          </div>
        )}
        <div className="lib-list-meta">
          <p className="lib-list-name">{name}</p>
          <p className="lib-list-count">
            {gameCount} {gameCount === 1 ? 'game' : 'games'}
          </p>
        </div>
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="library-page">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <header className="lib-hero">
          <div className="lib-hero-row">
            <div className="lib-hero-text">
              <h1 className="lib-hero-title">Library</h1>
              <p className="lib-hero-sub">
                {totalTracked} {totalTracked === 1 ? 'game' : 'games'} tracked
              </p>
              {backlogHours.totalHours !== null && (
                <p className="lib-hero-backlog">
                  ~{backlogHours.totalHours.toLocaleString()} hrs of backlog
                  {backlogHours.withoutEstimates > 0 && (
                    <span className="lib-hero-backlog-note">
                      {' '}· +{backlogHours.withoutEstimates} without estimates
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              className="lib-hero-newbtn"
              onClick={() => setShowCreateModal(true)}
            >
              + New list
            </button>
          </div>

          {recentlyTouched.length > 0 && (
            <div className="lib-hero-recents" aria-label="Recently touched games">
              {recentlyTouched.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  className="lib-hero-recent"
                  style={{ zIndex: recentlyTouched.length - i }}
                  onClick={() => handleRecentCoverClick(g.id)}
                  aria-label={g.title ? `Open ${g.title}` : 'Open game'}
                >
                  {g.image ? (
                    <SharedCover gameId={g.id} imageSrc={g.image}>
                      <img
                        src={g.image}
                        alt=""
                        className="lib-hero-recent-img"
                        loading="lazy"
                        draggable={false}
                      />
                    </SharedCover>
                  ) : (
                    <div className="lib-hero-recent-fallback">
                      {g.title?.charAt(0) || '?'}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* ── Trackers ───────────────────────────────────────────────── */}
        <section className="lib-section lib-section--trackers" aria-labelledby="lib-trackers-label">
          <p id="lib-trackers-label" className="lib-section-label">Trackers</p>
          <div className="lib-trackers" ref={trackersRef}>
            {TRACKERS.map(renderTrackerCard)}
          </div>
        </section>

        {/* ── Custom lists ───────────────────────────────────────────── */}
        <section className="lib-section lib-section--lists" aria-labelledby="lib-lists-label">
          <p id="lib-lists-label" className="lib-section-label">Your Lists</p>

          {isLoadingCustom ? (
            <div className="lib-lists-grid lib-lists-grid--skeleton" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="lib-list-card lib-list-card--skeleton">
                  <div className="skeleton lib-list-mosaic-skeleton" />
                  <div className="lib-list-meta">
                    <div className="skeleton lib-sk-name" />
                    <div className="skeleton lib-sk-count" />
                  </div>
                </div>
              ))}
            </div>
          ) : errorCustom ? (
            <InlineErrorBanner
              message="Couldn't load. Tap to retry."
              onRetry={loadCustomLists}
            />
          ) : customLists.length > 0 ? (
            <div className="lib-lists-grid content-fade-in" ref={customGridRef}>
              {customLists.map(renderCustomListCard)}
            </div>
          ) : (
            <div className="lib-lists-empty content-fade-in">
              <EmptyState
                icon={List}
                title="No lists yet."
                body="Create themed collections — cozy games, RPGs, anything."
                cta="Create a list"
                onCta={() => setShowCreateModal(true)}
              />
            </div>
          )}
        </section>

        <CreateListModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateList}
        />
      </div>
    </SharedCoverScope>
  )
}

export default Library
