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

const STALE_MS = 180 * 24 * 60 * 60 * 1000
import {
  getListsForUser,
  createList,
  addGameToList,
} from '../services/listService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { useCollectionStats } from '../hooks/useCollectionStats'
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

  // Collection-level stats: total hours, favorite genre, longest beaten,
  // per-game CP progress, and on-a-roll IDs from the F1 activity_events feed.
  const collectionStats = useCollectionStats(user?.id)

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

  // ── Smart sections (currently-playing games grouped by signal) ──────────
  //
  // "On a roll"   — had a F1 'played' activity_event in the last 7 days
  // "Almost done" — progress ≥ 70 % (progress_override or hours/TTB)
  // "Untouched"   — 0 hours logged and not in on-a-roll set
  //
  // A game can appear in multiple sections (e.g., 90 % AND on a roll).
  // Sections with 0 games are hidden via conditional rendering.
  const cpGames = trackerLists['currently-playing']?.games || []

  const smartSections = useMemo(() => {
    const { cpProgress, onARollIds } = collectionStats
    const onARoll = []
    const almostDone = []
    const untouched = []

    for (const g of cpGames) {
      if (!g?.id) continue
      const key = String(g.id)
      const prog = cpProgress[key] || { hours: 0, percent: null }

      if (onARollIds.has(key)) {
        onARoll.push({ ...g, _hours: prog.hours, _percent: prog.percent })
      }
      if (prog.percent !== null && prog.percent >= 70) {
        almostDone.push({ ...g, _hours: prog.hours, _percent: prog.percent })
      }
      if (prog.hours === 0 && !onARollIds.has(key)) {
        untouched.push({ ...g, _hours: 0, _percent: null })
      }
    }

    return { onARoll, almostDone, untouched }
  }, [cpGames, collectionStats])

  // Count of Want-to-Play games whose addedAt is > 6 months ago.
  const staleWantCount = useMemo(() => {
    const now = Date.now()
    return (trackerLists['want-to-play']?.games || []).filter(
      (g) => g.addedAt && now - new Date(g.addedAt).getTime() > STALE_MS,
    ).length
  }, [trackerLists])

  // Total hours logged across all CP games (for the tracker card subtitle)
  const cpTotalHours = useMemo(() => {
    const { trackerRows } = collectionStats
    return cpGames.reduce((sum, g) => {
      if (!g?.id) return sum
      return sum + (trackerRows[String(g.id)]?.hours || 0)
    }, 0)
  }, [cpGames, collectionStats])

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

    // For "Currently Playing" — show total hours logged across all CP games
    const cpHoursHint =
      id === 'currently-playing' && cpTotalHours > 0
        ? `${cpTotalHours % 1 === 0 ? cpTotalHours : cpTotalHours.toFixed(1)}h logged`
        : null

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
          {cpHoursHint && (
            <p className="lib-tracker-backlog-hint">{cpHoursHint}</p>
          )}
          {id === 'want-to-play' && backlogHours.totalHours !== null && (
            <p className="lib-tracker-backlog-hint">
              ~{backlogHours.totalHours.toLocaleString()} hrs
            </p>
          )}
          {id === 'want-to-play' && staleWantCount > 0 && (
            <p className="lib-tracker-stale-hint">
              {staleWantCount} waiting 6+ mo
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

  // ── Smart section render helper ───────────────────────────────────────────

  const renderSmartGroup = (label, games, variant) => {
    if (games.length === 0) return null
    return (
      <div className="lib-smart-group" key={label}>
        <p className="lib-smart-group-label">{label}</p>
        <div className="lib-smart-scroll" role="list">
          {games.map((g) => {
            const percent = g._percent
            const hours = g._hours
            const hintParts = [
              hours > 0
                ? `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`
                : null,
              percent !== null ? `${percent}%` : null,
            ].filter(Boolean)

            return (
              <button
                key={g.id}
                type="button"
                role="listitem"
                className="lib-smart-card"
                onClick={() => navigate(`/game/${g.id}`)}
                aria-label={
                  g.title
                    ? `${g.title}${hintParts.length ? ` — ${hintParts.join(', ')}` : ''}`
                    : 'Open game'
                }
              >
                <div
                  className={`lib-smart-cover-wrap${variant === 'untouched' ? ' lib-smart-cover-wrap--muted' : ''}`}
                >
                  {g.image ? (
                    <img
                      src={g.image}
                      alt=""
                      className="lib-smart-cover-img"
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className="lib-smart-cover-fallback">
                      {g.title?.charAt(0) || '?'}
                    </div>
                  )}
                  {/* Progress bar at cover bottom for "almost done" */}
                  {percent !== null && (
                    <div className="lib-smart-progress" aria-hidden="true">
                      <div
                        className="lib-smart-progress-fill"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                  {/* "On a roll" pulse dot */}
                  {variant === 'on-a-roll' && (
                    <span className="lib-smart-roll-dot" aria-hidden="true" />
                  )}
                </div>
                <p className="lib-smart-title">{g.title || '—'}</p>
                {hintParts.length > 0 && (
                  <p className="lib-smart-hint">{hintParts.join(' · ')}</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
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
              {/* Collection identity stat line — shown once real data loads */}
              {!collectionStats.loading && (
                collectionStats.favoriteGenre ||
                collectionStats.totalHours > 0 ||
                collectionStats.longestBeaten
              ) && (
                <p className="lib-hero-identity">
                  {[
                    collectionStats.favoriteGenre
                      ? `${collectionStats.favoriteGenre} person`
                      : null,
                    collectionStats.totalHours > 0
                      ? `${collectionStats.totalHours.toLocaleString()}h total`
                      : null,
                    collectionStats.longestBeaten
                      ? `longest: ${collectionStats.longestBeaten.title} (${Math.round(collectionStats.longestBeaten.hours)}h)`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
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

        {/* ── Smart sections (on a roll / almost done / untouched) ───── */}
        {cpGames.length > 0 &&
          (smartSections.onARoll.length > 0 ||
            smartSections.almostDone.length > 0 ||
            smartSections.untouched.length > 0) && (
            <section
              className="lib-section lib-section--smart"
              aria-label="Currently playing signals"
            >
              {renderSmartGroup('On a roll', smartSections.onARoll, 'on-a-roll')}
              {renderSmartGroup('Almost done', smartSections.almostDone, 'almost-done')}
              {renderSmartGroup('Untouched', smartSections.untouched, 'untouched')}
            </section>
          )}

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
