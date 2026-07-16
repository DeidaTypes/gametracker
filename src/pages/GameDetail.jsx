import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { getGameById } from '../services/igdb'
import { getDominantColor, getGameSwatches } from '../services/colorExtract'
import { useGameColor } from '../contexts/GameColorContext'
import ReviewCard from '../components/ReviewCard'
import AddToListButton, { STATUS_TILES } from '../components/AddToListButton'
import SharedCover, { getRecentCoverImage } from '../components/SharedCover'
import CommunityRatingCard from '../components/CommunityRatingCard'
import SimilarGamesRow from '../components/SimilarGamesRow'
import { getReviewsForGame, getRatingDistributionForGame } from '../services/reviewService'
import { getCirclePulseForGame, getFollowedRatingsForGame } from '../services/communityService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import { addViewedGame } from '../services/userPreferences'
import { getGameStatus, setGameStatus } from '../services/libraryService'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getTimeToBeat } from '../services/timeToBeatService'
import LogSessionModal from '../components/LogSessionModal'
import { logManualSession, getManualSessionsForGame, deleteManualSession } from '../services/sessionService'
import ActionSheet from '../components/ActionSheet'
import JournalEntryModal from '../components/JournalEntryModal'
import DmShareSheet from '../components/DmShareSheet'
import './GameDetail.css'

// Display-only, shorter labels for the status tile grid below the title.
// STATUS_TILES.label itself is left untouched — it still drives the fuller
// wording used inside AddToListButton's bottom sheet.
const GD_STATUS_LABELS = {
  want: 'Backlog',
  currently: 'Playing',
  played: 'Played',
  dropped: 'Dropped',
}

// ── Dominant-color helpers ──────────────────────────────────────────────────
// Relative luminance per WCAG 2.1 (linearised sRGB)
function getLuminance(r, g, b) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// If the extracted swatch is near-black (dark game covers like XCOM 2) use a
// slightly-lifted navy so the gradient doesn't disappear into the background.
function getEffectiveColor(color) {
  if (!color) return null
  const { r, g, b } = color
  if (getLuminance(r, g, b) < 0.15) {
    // ~6% lightness lift over --color-bg-primary (#0C1322 ≈ HSL 220,57%,9%)
    return { r: 24, g: 42, b: 70 }
  }
  return { r, g, b }
}

// Builds the "{name}, {name} and {N} others you follow rated this — avg
// {X.X}★" sentence (with the shorter 1/2-follower phrasings) from
// getFollowedRatingsForGame's `followers` array. Names are bolded inline
// so no separate template strings are needed per count.
function buildFollowSentence(followers, average) {
  const names = followers.map((f) => f.displayName)
  let namePart
  if (names.length === 1) {
    namePart = <strong>{names[0]}</strong>
  } else if (names.length === 2) {
    namePart = (
      <>
        <strong>{names[0]}</strong> and <strong>{names[1]}</strong>
      </>
    )
  } else {
    const othersCount = names.length - 2
    namePart = (
      <>
        <strong>{names[0]}</strong>, <strong>{names[1]}</strong> and{' '}
        <strong>{othersCount} other{othersCount === 1 ? '' : 's'}</strong>
      </>
    )
  }
  return (
    <>
      {namePart} you follow rated this — avg <strong>{average.toFixed(1)}</strong>★
    </>
  )
}

function genreToSlug(genre) {
  return genre.toLowerCase().replace(/\s*\(.*?\)/g, '').trim().replace(/\s+/g, '-')
}

// Weekend read — derived from IGDB `normally` (main-story) seconds.
// Returns null when there is no TTB data so the badge is silently omitted.
function weekendReadBadge(ttb) {
  if (!ttb?.normallySeconds) return null
  const h = ttb.normallySeconds / 3600
  if (h <= 15) return { text: 'Fits a weekend', variant: 'yes' }
  if (h <= 25) return { text: 'Tight — push it', variant: 'maybe' }
  return { text: 'Needs more time', variant: 'long' }
}

// ── Review shape adapter ───────────────────────────────────────────────────
// Maps a raw Supabase review row (joined with users) into the canonical
// ReviewCard prop shape expected by src/components/ReviewCard.jsx.
function toReviewCardShape(row, game, likeCounts, commentCounts) {
  return {
    id: row.id,
    // Keep user_id on the shape so callers can derive isOwn without
    // additional lookups.
    userId: row.user_id,
    game: {
      id: String(row.igdb_game_id || game?.id || ''),
      name: row.game_title || game?.title || 'Unknown Game',
      coverUrl: row.game_image || game?.image || '',
      developer: game?.developers?.[0] || '',
    },
    author: {
      username: row.users?.username || null,
      displayName: row.users?.display_name || 'Anonymous',
      userId: row.user_id,
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
    hoursPlayed: Number(row.hours_played) || 0,
    liked: !!row.liked,
    hasSpoilers: !!row.has_spoilers,
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
    likeCount: likeCounts?.get(row.id) || 0,
    commentCount: commentCounts?.get(row.id) || 0,
    createdAt: row.created_at,
  }
}

function GameDetail() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const targetReviewId = searchParams.get('review')
  const { user } = useAuth()
  // Source cover image for the shared-element flight. Comes either from
  // the navigation state (if the caller passed it) or from a small
  // module-level cache of the most recently rendered cover for this
  // gameId. Used as the hero img src until the higher-res IGDB
  // cover_big has loaded — keeps the flight target from being empty.
  const placeholderCover =
    location.state?.coverImage || getRecentCoverImage(gameId)
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviews, setReviews] = useState([])
  // Sprint 6 P0 — Map<reviewId, count> for the visible reviews. Drives
  // the Top Reviews sort and the count rendered on each card.
  const [reviewLikeCounts, setReviewLikeCounts] = useState(() => new Map())
  // Sprint 6 P1 — real comment counts per review id, fetched once per
  // refresh. The ReviewCard badge consumes these via toReviewCardShape.
  const [reviewCommentCounts, setReviewCommentCounts] = useState(() => new Map())
  // Whole-game rating distribution (avg + per-star counts) for the
  // community rating card — independent of `reviews` above, which is
  // capped to the 20 most recent rows for the Top Reviews list.
  const [ratingDist, setRatingDist] = useState(null)
  const [status, setStatus] = useState(null)
  const [dominantColor, setDominantColor] = useState(null)
  const { setSwatches: setGlobalSwatches } = useGameColor()
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [circlePulse, setCirclePulse] = useState(null)
  // "From people you follow" row — followed users who rated this game.
  // Hidden entirely when count is 0 (no one followed has rated it).
  const [followedRatings, setFollowedRatings] = useState(null)
  const statusChangeInFlight = useRef(false)
  const reviewScrollAttempted = useRef(false)

  const [ttb, setTtb] = useState(null)

  const refreshFromStore = useCallback(() => {
    setStatus(getGameStatus(gameId))
  }, [gameId])

  const refreshReviews = useCallback(async () => {
    try {
      const rows = await getReviewsForGame(gameId)
      setReviews(rows)
      // Seed the in-process useLikeState cache and grab the count
      // Map for the Top Reviews sort below. Batched alongside the
      // comment-count fetch so we only round-trip once for both.
      try {
        const ids = rows.map((r) => r.id)
        const [counts, cCounts] = await Promise.all([
          prefetchLikeStatesForReviews(ids),
          getCommentCountsForReviews(ids),
        ])
        setReviewLikeCounts(counts)
        setReviewCommentCounts(cCounts)
      } catch (err) {
        console.error('[gameDetail] like/comment count prefetch failed:', err)
        setReviewLikeCounts(new Map())
        setReviewCommentCounts(new Map())
      }
    } catch (err) {
      console.error('[gameDetail] failed to load reviews:', err)
      setReviews([])
      setReviewLikeCounts(new Map())
      setReviewCommentCounts(new Map())
    }
  }, [gameId])

  const refreshFollowedRatings = useCallback(async () => {
    try {
      const result = await getFollowedRatingsForGame(gameId)
      setFollowedRatings(result)
    } catch (err) {
      console.error('[gameDetail] failed to load followed ratings:', err)
      setFollowedRatings({ average: null, count: 0, followers: [] })
    }
  }, [gameId])

  const refreshRatingDistribution = useCallback(async () => {
    // getRatingDistributionForGame never throws — it catches its own
    // Supabase errors and resolves to a distinct `{ error: true }` shape
    // rather than a fake "zero ratings" result (see reviewService.js).
    // This try/catch only guards against something upstream of that
    // (e.g. gameId itself blowing up) and mirrors the same failure shape
    // so a thrown error can't get silently reinterpreted as "no ratings".
    try {
      const dist = await getRatingDistributionForGame(gameId)
      setRatingDist(dist)
    } catch (err) {
      console.error('[gameDetail] failed to load rating distribution:', err)
      setRatingDist({ average: null, totalCount: 0, counts: null, error: true })
    }
  }, [gameId])

  useEffect(() => {
    async function fetchGame() {
      try {
        setLoading(true)
        setError(null)
        setRatingDist(null)
        const gameData = await getGameById(gameId)
        setGame(gameData)

        addViewedGame(gameId, gameData.title, gameData.image)
        refreshFromStore()

        // Kick off all post-load work in parallel — none of these block
        // the main content from rendering.
        Promise.all([
          refreshReviews(),
          refreshRatingDistribution(),
          getDominantColor(gameData.image)
            .then(color => setDominantColor(color))
            .catch(() => {}),
          getGameSwatches(gameData.image, gameId)
            .then(sw => setGlobalSwatches(sw))
            .catch(() => {}),
          // Fetch TTB for ALL games (not just library games) so the Time to
          // Beat averages section is visible even before a game is tracked.
          // timeToBeatService caches results, so the TTB/sessions effect
          // below will be a cache hit for the same gameId.
          getTimeToBeat(gameId)
            .then(b => setTtb(b))
            .catch(() => {}),
          // Community Pulse — circle-scoped signals; hides when empty.
          getCirclePulseForGame(gameId)
            .then(p => setCirclePulse(p))
            .catch(() => {}),
          // From People You Follow — hides when no followed user rated it.
          refreshFollowedRatings(),
        ])
      } catch (err) {
        console.error('Error fetching game:', err)
        setError('Failed to load game details.')
      } finally {
        setLoading(false)
      }
    }

    if (gameId) {
      fetchGame()
    }
  }, [gameId])

  useEffect(() => {
    const handleLibraryUpdate = () => {
      if (!statusChangeInFlight.current) {
        refreshFromStore()
      }
    }
    // Refresh the in-page review list after the composer posts a review and
    // navigates back. ReviewNew (the single composer) dispatches this event.
    const handleReviewAdded = () => {
      refreshReviews()
      refreshFromStore()
      refreshRatingDistribution()
      refreshFollowedRatings()
    }
    window.addEventListener('libraryUpdated', handleLibraryUpdate)
    window.addEventListener('storage', handleLibraryUpdate)
    window.addEventListener('reviewAdded', handleReviewAdded)
    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdate)
      window.removeEventListener('storage', handleLibraryUpdate)
      window.removeEventListener('reviewAdded', handleReviewAdded)
    }
  }, [refreshFromStore, refreshReviews, refreshRatingDistribution, refreshFollowedRatings])

  // Fetch Time to Beat + manual sessions for every game, regardless of
  // library status. Re-runs when the gameId changes (new game).
  useEffect(() => {
    let cancelled = false

    async function loadTtbAndSessions() {
      const [b, s] = await Promise.all([
        getTimeToBeat(gameId).catch(() => null),
        getManualSessionsForGame(gameId).catch(() => []),
      ])
      if (cancelled) return
      setTtb(b)
      setSessions(s)
    }

    loadTtbAndSessions()
    return () => { cancelled = true }
  }, [gameId])

  // Revert chrome tint when navigating away from this page.
  useEffect(() => {
    return () => {
      setGlobalSwatches(null)
    }
  }, [setGlobalSwatches])

  // Best-effort scroll to a deep-linked review (e.g. from the Explore feed).
  // If the review id isn't present locally (e.g. it was a mock community
  // review), we silently no-op and just leave the user on the game detail
  // page. We try once after reviews have rendered.
  useEffect(() => {
    if (!targetReviewId || reviewScrollAttempted.current) return
    if (loading || reviews.length === 0) return

    reviewScrollAttempted.current = true
    // Defer a frame so the review nodes are mounted before we measure.
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById(`review-${targetReviewId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('gd-review-card--highlight')
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [targetReviewId, loading, reviews])

  // ── Log session state ─────────────────────────────────────────────────────
  const [logSessionOpen, setLogSessionOpen] = useState(false)
  const [logSaving, setLogSaving] = useState(false)
  const [sessions, setSessions] = useState([])

  const [composeSheetOpen, setComposeSheetOpen] = useState(false)
  const [journalModalOpen, setJournalModalOpen] = useState(false)
  const [statusSheetOpen, setStatusSheetOpen] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)

  // ── Session helpers ───────────────────────────────────────────────────────
  function formatDuration(mins) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h > 0 && m > 0) return `${h}h ${m}m`
    if (h > 0) return `${h}h`
    return `${m}m`
  }

  function formatPlayedOn(dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number)
    return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  const refreshSessions = useCallback(async () => {
    const data = await getManualSessionsForGame(gameId).catch(() => [])
    setSessions(data)
  }, [gameId])

  const handleLogSession = useCallback(async ({ totalMinutes, playedOn }) => {
    setLogSaving(true)
    try {
      const result = await logManualSession(gameId, totalMinutes, playedOn, {
        gameTitle: game?.title,
        gameImage: game?.image,
      })
      if (result) {
        await refreshSessions()
        setLogSessionOpen(false)
      } else {
        console.error('[gameDetail] failed to log session')
      }
    } finally {
      setLogSaving(false)
    }
  }, [gameId, game, refreshSessions])

  const handleDeleteSession = useCallback(async (sessionId, mins) => {
    const result = await deleteManualSession(sessionId, gameId, mins)
    if (result) {
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } else {
      console.error('[gameDetail] failed to delete session')
    }
  }, [gameId])

  const openReviewComposer = useCallback((reviewShape) => {
    navigate(`/review/new?gameId=${gameId}`, {
      state: { game, editReview: reviewShape || null },
    })
  }, [navigate, gameId, game])

  const openJournalComposer = useCallback(() => {
    setJournalModalOpen(true)
  }, [])

  // Mirrors AddToListButton's internal handleStatusTap exactly — same
  // store call + same libraryUpdated dispatch — so the inline pills and
  // the sheet stay in sync via the one unchanged status store.
  const handleStatusPillTap = useCallback((statusKey) => {
    if (!game || status === statusKey) return
    setGameStatus(game.id, statusKey, game)
    refreshFromStore()
    window.dispatchEvent(new Event('libraryUpdated'))
  }, [game, status, refreshFromStore])

  const handleShare = () => {
    setDmShareOpen(true)
  }

  if (loading) {
    // If we know the cover image from the navigation source (state or
    // recent-cover cache), render a real hero with the shared layoutId
    // so the cover-to-hero flight has somewhere to land. The detail
    // metadata (title, description, etc.) is still skeletoned underneath
    // until the IGDB request resolves. If no placeholder is available
    // (deep-link from outside the app) we fall back to the original
    // all-skeleton state.
    if (placeholderCover) {
      return (
        <div className="game-detail margins-style" aria-busy="true">
          <motion.div
            className="gd-color-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.28 }}
          />
          <div className="gd-hero">
            <div className="gd-hero-topbar">
              <button
                className="gd-glass-btn"
                onClick={() => navigate(-1)}
                aria-label="Go back"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
            <div className="gd-hero-cover-wrapper">
              <div className="gd-hero-cover">
                <SharedCover gameId={gameId} imageSrc={placeholderCover}>
                  <img src={placeholderCover} alt="" />
                </SharedCover>
              </div>
            </div>
          </div>
          <div className="gd-sk-body">
            <div className="gd-sk-title skeleton" />
            <div className="gd-sk-subtitle skeleton" />
            <div className="gd-sk-meta">
              <div className="gd-sk-pill skeleton" />
              <div className="gd-sk-pill skeleton" />
              <div className="gd-sk-pill skeleton" />
            </div>
            <div className="gd-sk-desc skeleton" />
            <div className="gd-sk-desc gd-sk-desc--short skeleton" />
          </div>
        </div>
      )
    }

    return (
      <div className="game-detail margins-style" aria-hidden="true">
        <div className="gd-sk-hero skeleton" />
        <div className="gd-sk-body">
          <div className="gd-sk-cover skeleton" />
          <div className="gd-sk-title skeleton" />
          <div className="gd-sk-subtitle skeleton" />
          <div className="gd-sk-meta">
            <div className="gd-sk-pill skeleton" />
            <div className="gd-sk-pill skeleton" />
            <div className="gd-sk-pill skeleton" />
          </div>
          <div className="gd-sk-desc skeleton" />
          <div className="gd-sk-desc gd-sk-desc--short skeleton" />
        </div>
      </div>
    )
  }

  if (error || !game) {
    return (
      <div className="game-detail margins-style">
        <div className="error-container">
          <p>{error || 'Game not found'}</p>
          <button onClick={() => navigate('/')} className="back-button">
            Go Back Home
          </button>
        </div>
      </div>
    )
  }

  const fallbackCover = COVER_FALLBACK

  // Decision helper — vibe tags: atmospheric themes only, deduped and capped
  // at 6. Genres are intentionally excluded here since they already render
  // as their own tappable chips in the About section — including them here
  // duplicated every genre chip on the page.
  const _vibeSet = new Set()
  const vibeTags = [...(game.themes || [])]
    .filter(t => {
      const k = t.toLowerCase()
      if (_vibeSet.has(k)) return false
      _vibeSet.add(k)
      return true
    })
    .slice(0, 6)

  // Weekend read badge — null when normallySeconds is absent (omit, don't guess)
  const weekendBadge = weekendReadBadge(ttb)

  const effectiveColor = getEffectiveColor(dominantColor)

  // Small poster glow — radial bloom directly behind the cover art
  const glowStyle = effectiveColor
    ? { background: `radial-gradient(ellipse 180px 240px at center, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.30) 0%, transparent 80%)` }
    : {}

  // Full-bleed backdrop: two gradient layers stacked.
  //   Layer A (color, on top): continuous linear fade 0 → 100% of the 640px height
  //   Layer B (radial vignette): soft bloom centered on the poster at 28% opacity
  // Both fade to transparent so the body's fixed navy gradient shows through with no seam.
  const backdropStyle = effectiveColor ? {
    background: [
      `radial-gradient(ellipse at 50% 200px, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.28) 0%, transparent 60%)`,
      `linear-gradient(180deg, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.55) 0%, transparent 100%)`,
    ].join(', '),
  } : {}

  return (
    <div className="game-detail margins-style">

      {/* ── Color gradient backdrop ── Absolutely positioned 0→640px. Two
           stacked layers: dominant color fading out + radial vignette centred
           on the poster. Fades to transparent so the body's fixed navy
           gradient shows through with no seam. pointer-events: none so it
           never blocks taps.

           Wrapped in motion.div with a 280ms opacity fade so the
           dominant-color glow blooms in WHILE the cover-to-hero
           layoutId flight is still in motion (per spec). */}
      <motion.div
        className="gd-color-backdrop"
        style={backdropStyle}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.28 }}
      />

      {/* ── Hero Section ── */}
      <div className="gd-hero">
        <div
          className="gd-hero-blur"
          style={{ backgroundImage: `url(${game.image || ''})` }}
        />
        <div className="gd-hero-overlay" />

        <div className="gd-hero-topbar">
          <button className="gd-glass-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="gd-glass-btn"
            onClick={() => setStatusSheetOpen(true)}
            aria-label="More status options: log play, add to a custom list"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
          <button className="gd-glass-btn" onClick={handleShare} aria-label="Share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Poster (in hero above) + Title ── */}
      <div className="gd-title-section">
        <div className="gd-hero-cover-wrapper">
          {/* Poster glow — radial dominant-color bloom behind the cover art */}
          <div className="gd-poster-glow" style={glowStyle} aria-hidden="true" />
          <div className="gd-hero-cover">
            <SharedCover gameId={gameId} imageSrc={game.image}>
              <img
                src={game.image || fallbackCover}
                alt={game.title}
                onError={(e) => { e.target.src = fallbackCover }}
              />
            </SharedCover>
          </div>
        </div>
        <div className="gd-title-text">
          <h1 className="gd-title">{game.title}</h1>
          {(game.year || game.developers.length > 0) && (
            <p className="gd-subtitle">
              {[game.year, game.developers.join(', ')].filter(Boolean).join(' · ')}
            </p>
          )}
          {game.publishers.length > 0 && (
            <p className="gd-publisher">{game.publishers.join(', ')}</p>
          )}
        </div>
      </div>

      {/* ── Status tiles — the existing four-way, mutually-exclusive status
           control. Same STATUS_TILES data and the same setGameStatus /
           getGameStatus store AddToListButton's sheet uses (imported, not
           duplicated) — UNCHANGED logic, just rendered as a square-tile
           grid (instead of scrolling pills) directly under the title,
           above the fold. GD_STATUS_LABELS below is a display-only label
           override for this compact layout; STATUS_TILES.label (used by
           AddToListButton's sheet) is untouched. ── */}
      <div className="gd-status-row" role="group" aria-label="Game status">
        <div className="gd-status-grid">
          {STATUS_TILES.map((tile) => {
            const active = status === tile.key
            return (
              <button
                key={tile.key}
                className={`gd-status-tile${active ? ' gd-status-tile--active' : ''}`}
                onClick={() => handleStatusPillTap(tile.key)}
                aria-pressed={active}
              >
                <span className="gd-status-tile-icon">{tile.icon}</span>
                <span className="gd-status-tile-label">{GD_STATUS_LABELS[tile.key] || tile.label}</span>
              </button>
            )
          })}
        </div>
        {/* Hidden sheet — same unchanged 4-status picker, plus Log play and
             custom lists, still reachable via the overflow button in the
             hero topbar above. */}
        <AddToListButton
          game={game}
          variant="hidden"
          forceOpen={statusSheetOpen}
          onForceClose={() => setStatusSheetOpen(false)}
          onLogPlay={() => setLogSessionOpen(true)}
        />
      </div>

      {/* ── Rating card — numeric average + whole-star histogram, built
           from every community rating for this game (not just the 20
           most recent shown in Top Reviews below). Renders whenever
           totalCount > 0. Hides on a genuine zero-rating game (confirmed
           by a successful query) OR on a failed query — but a failed
           query is logged loudly in getRatingDistributionForGame rather
           than silently masqueraded as "no ratings"; ratingDist.error
           carries that distinction for any future caller that needs it. ── */}
      {ratingDist && ratingDist.totalCount > 0 && (
        <div className="gd-rating-card">
          <CommunityRatingCard
            average={ratingDist.average}
            totalCount={ratingDist.totalCount}
            counts={ratingDist.counts}
          />
        </div>
      )}

      {/* ── Add a Review / Journal Entry quick-action buttons ── */}
      <div className="gd-action-pair">
        <button
          className="gd-action-pair-btn gd-action-pair-btn--review"
          onClick={() => openReviewComposer()}
          aria-label="Add a review"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>Add a Review</span>
        </button>
        <button
          className="gd-action-pair-btn gd-action-pair-btn--journal"
          onClick={openJournalComposer}
          aria-label="Journal entry"
        >
          {/* Lucide Book — closed notebook glyph */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
          </svg>
          <span>Journal Entry</span>
        </button>
      </div>


      {/* Logged Sessions — tidy list below the card; hidden when empty */}
      {sessions.length > 0 && (
        <div className="gd-session-history">
          <p className="gd-session-history-label">Logged Sessions</p>
          <div className="gd-session-history-list">
            {sessions.map(s => (
              <div key={s.id} className="gd-session-item">
                <span className="gd-session-item-date">{formatPlayedOn(s.playedOn)}</span>
                <span className="gd-session-item-duration">{formatDuration(s.minutes)}</span>
                <button
                  className="gd-session-delete-btn"
                  onClick={() => handleDeleteSession(s.id, s.minutes)}
                  aria-label={`Delete session from ${s.playedOn}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── At a Glance ── decision helper card.
           Shows up when any of the three sub-rows has real IGDB data.
           Each sub-row is individually hidden when its data is absent —
           nothing is guessed or fabricated. ── */}
      {(ttb && (ttb.hastilySeconds != null || ttb.normallySeconds != null || ttb.completelySeconds != null) || vibeTags.length > 0) && (
        <div className="gd-ttb-block">
          <p className="gd-ttb-heading">At a glance</p>

          {/* Length to beat — from IGDB game_time_to_beats */}
          {ttb && (ttb.hastilySeconds != null || ttb.normallySeconds != null || ttb.completelySeconds != null) && (
            <div className="gd-ttb-row">
              {ttb.hastilySeconds != null && (
                <span className="gd-ttb-item">
                  Rushed{' '}
                  <span className="gd-ttb-val">~{Math.round(ttb.hastilySeconds / 3600)}h</span>
                </span>
              )}
              {ttb.normallySeconds != null && (
                <span className="gd-ttb-item gd-ttb-item--main">
                  Main{' '}
                  <span className="gd-ttb-val">~{Math.round(ttb.normallySeconds / 3600)}h</span>
                </span>
              )}
              {ttb.completelySeconds != null && (
                <span className="gd-ttb-item">
                  Completionist{' '}
                  <span className="gd-ttb-val">~{Math.round(ttb.completelySeconds / 3600)}h</span>
                </span>
              )}
            </div>
          )}

          {/* Vibe tags — IGDB themes (atmospheric), deduped, max 6. Genres are
               excluded here; they render as their own chips in the About
               section below. */}
          {vibeTags.length > 0 && (
            <div className="gd-vibe-row" aria-label="Vibe tags">
              {vibeTags.map(tag => (
                <span key={tag} className="gd-vibe-pill">{tag}</span>
              ))}
            </div>
          )}

          {/* Weekend read — derived from main-story hours; omitted when missing */}
          {weekendBadge && (
            <div className={`gd-weekend-read gd-weekend-read--${weekendBadge.variant}`}>
              <svg
                className="gd-weekend-icon"
                width="12" height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {weekendBadge.variant === 'yes' && (
                  <polyline points="20 6 9 17 4 12" />
                )}
                {weekendBadge.variant === 'maybe' && (
                  <>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </>
                )}
                {weekendBadge.variant === 'long' && (
                  <>
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </>
                )}
              </svg>
              <span>Good for a weekend? </span>
              <strong>{weekendBadge.text}</strong>
            </div>
          )}
        </div>
      )}

      {/* ── Community Pulse — circle-scoped signals ──
           Three sub-rows rendered only when they have real data.
           The entire block is suppressed when all three are empty,
           so non-social or low-activity games stay clean.           */}
      {circlePulse && (
        circlePulse.circleRatingCount > 0 ||
        circlePulse.activePresence.length > 0 ||
        circlePulse.circleRank != null
      ) && (
        <div className="gd-pulse-block">
          <p className="gd-pulse-heading">Your Circle</p>

          {/* Sub-row 1: Circle avg rating */}
          {circlePulse.circleRatingCount > 0 && (
            <div className="gd-pulse-row">
              <div className="gd-pulse-icon" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <p className="gd-pulse-label">
                <span className="gd-pulse-rating-val">★ {circlePulse.circleAvgRating.toFixed(1)}</span>
                {' '}avg rating
              </p>
              <span className="gd-pulse-sub">
                {circlePulse.circleRatingCount === 1
                  ? '1 person'
                  : `${circlePulse.circleRatingCount} people`}
              </span>
            </div>
          )}

          {/* Sub-row 2: Active presence — who's playing now */}
          {circlePulse.activePresence.length > 0 && (
            <div className="gd-pulse-row">
              <div className="gd-pulse-live-dot" aria-hidden="true" />
              <div className="gd-pulse-avatars" aria-hidden="true">
                {circlePulse.activePresence.slice(0, 5).map((p) =>
                  p.avatarUrl ? (
                    <img
                      key={p.userId}
                      src={p.avatarUrl}
                      alt=""
                      className="gd-pulse-avatar"
                    />
                  ) : (
                    <div key={p.userId} className="gd-pulse-avatar" />
                  )
                )}
                {circlePulse.activePresence.length > 5 && (
                  <div className="gd-pulse-avatar-overflow">
                    +{circlePulse.activePresence.length - 5}
                  </div>
                )}
              </div>
              <p className="gd-pulse-label">
                {circlePulse.activePresence.length === 1
                  ? `${circlePulse.activePresence[0].displayName} is playing`
                  : `${circlePulse.activePresence.length} friends playing now`}
              </p>
            </div>
          )}

          {/* Sub-row 3: Circle rank */}
          {circlePulse.circleRank != null && (
            <div className="gd-pulse-row">
              <div className="gd-pulse-icon" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </div>
              <p className="gd-pulse-label">
                <span className="gd-pulse-rank-num">#{circlePulse.circleRank}</span>
                {' '}in your circle
              </p>
              <span className="gd-pulse-sub">of {circlePulse.circleTotalGames}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Content Area ── */}
      <div className="gd-content">

        {/* About + genre chips */}
        <div className="gd-section">
          <p className="gd-section-label">About</p>
          <div className={`gd-description-wrapper${descExpanded ? ' gd-description-wrapper--expanded' : ''}`}>
            <p className="gd-description">{game.description}</p>
            {!descExpanded && <div className="gd-description-fade" aria-hidden="true" />}
          </div>
          <button
            className="gd-read-more-btn"
            onClick={() => setDescExpanded(v => !v)}
          >
            {descExpanded ? 'Less' : 'More'}
          </button>

          {game.genres.length > 0 && (
            <div className="gd-genre-row">
              {game.genres.map((genre) => (
                <button
                  key={genre}
                  className="gd-genre-pill"
                  onClick={() => navigate(`/search?genre=${genreToSlug(genre)}`)}
                >
                  {genre}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="gd-divider" />

        <div className="gd-section">
          <p className="gd-section-label">Details</p>
          <div className="gd-details-grid">
            {game.developers.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Developer</span>
                <span className="gd-detail-val">{game.developers.join(', ')}</span>
              </div>
            )}
            {game.publishers.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Publisher</span>
                <span className="gd-detail-val">{game.publishers.join(', ')}</span>
              </div>
            )}
            {game.platforms.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Platforms</span>
                <span className="gd-detail-val">{game.platforms.join(', ')}</span>
              </div>
            )}
            {game.year && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Released</span>
                <span className="gd-detail-val">{game.year}</span>
              </div>
            )}
          </div>
        </div>

        {/* Screenshots — scroll-snap + lightbox */}
        {game.screenshots && game.screenshots.length > 0 && (
          <>
            <div className="gd-divider" />
            <div className="gd-section">
              <p className="gd-section-label">Screenshots</p>
              <div className="gd-screenshots-scroll">
                {game.screenshots.slice(0, 8).map((screenshot, index) => (
                  <button
                    key={index}
                    className="gd-screenshot-btn"
                    onClick={() => setLightboxSrc(screenshot)}
                    aria-label={`View screenshot ${index + 1} fullscreen`}
                  >
                    <img
                      src={screenshot}
                      alt={`${game.title} screenshot ${index + 1}`}
                      className="gd-screenshot"
                    />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* From People You Follow — community row above the reviews list.
             Hidden entirely when zero followed users rated this game; no
             placeholders or fabricated names are ever rendered here. */}
        {followedRatings && followedRatings.count > 0 && (
          <>
            <div className="gd-divider" />
            <div className="gd-section">
              <p className="gd-section-label">From People You Follow</p>
              <div className="gd-follow-row">
                <div className="gd-follow-avatars" aria-hidden="true">
                  {followedRatings.followers.slice(0, 3).map((f) =>
                    f.avatarUrl ? (
                      <img
                        key={f.userId}
                        src={f.avatarUrl}
                        alt=""
                        className="gd-follow-avatar"
                      />
                    ) : (
                      <div key={f.userId} className="gd-follow-avatar gd-follow-avatar--fallback">
                        {(f.username || f.displayName || '?').charAt(0).toUpperCase()}
                      </div>
                    )
                  )}
                </div>
                <p className="gd-follow-text">
                  {buildFollowSentence(followedRatings.followers, followedRatings.average)}
                </p>
              </div>
            </div>
          </>
        )}

        <div className="gd-divider" />

        {/* Reviews — promoted here per the new section order */}
        <div className="gd-section">
          <div className="gd-section-header-row">
            <h2 className="gd-section-display-title">Top Reviews</h2>
            <button
              className="gd-see-all-btn"
              onClick={() => navigate(`/game/${gameId}/reviews`)}
              aria-label="See all reviews"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {(() => {
            const ownReview = reviews.find(r => r.user_id === user?.id)
            const othersTop = reviews
              .filter(r => r.user_id !== user?.id)
              .sort(
                (a, b) =>
                  (reviewLikeCounts.get(b.id) || 0) -
                  (reviewLikeCounts.get(a.id) || 0)
              )
              .slice(0, ownReview ? 4 : 5)

            if (!ownReview && othersTop.length === 0) {
              return (
                <div className="gd-reviews-empty">
                  <p className="gd-reviews-empty-text">Be the first to review this game</p>
                  <button
                    className="gd-reviews-empty-cta"
                    onClick={() => setComposeSheetOpen(true)}
                  >
                    Write a review
                  </button>
                </div>
              )
            }

            const visibleRows = [
              ...(ownReview ? [ownReview] : []),
              ...othersTop,
            ]

            return (
              <div className="gd-top-reviews-list">
                {visibleRows.map((row) => {
                  const shaped = toReviewCardShape(
                    row,
                    game,
                    reviewLikeCounts,
                    reviewCommentCounts
                  )
                  const own = row.user_id === user?.id
                  return (
                    <div key={row.id} id={`review-${row.id}`}>
                      <ReviewCard
                        review={shaped}
                        variant="gamedetail"
                        showOwnPill={own}
                        isOwn={own}
                        onEdit={openReviewComposer}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* More Like This — SimilarGamesRow self-fetches in parallel; renders null (incl. header/divider) if no results */}
        <SimilarGamesRow
          gameId={gameId}
          genreIds={game.genreIds || []}
          themeIds={game.themeIds || []}
        />

      </div>

      {/* ── Log Session Modal ── */}
      <LogSessionModal
        isOpen={logSessionOpen}
        onClose={() => setLogSessionOpen(false)}
        onSave={handleLogSession}
        isSaving={logSaving}
      />

      {/* ── Compose action sheet: Write review / Add to journal ── */}
      <ActionSheet
        isOpen={composeSheetOpen}
        onClose={() => setComposeSheetOpen(false)}
        items={[
          {
            label: 'Write a review',
            onClick: () => { setComposeSheetOpen(false); openReviewComposer() },
          },
          {
            label: 'Add to journal',
            onClick: () => { setComposeSheetOpen(false); openJournalComposer() },
          },
        ]}
      />

      {/* ── Journal Entry Modal — inline pop-up, no route change ── */}
      <JournalEntryModal
        isOpen={journalModalOpen}
        onClose={() => setJournalModalOpen(false)}
        game={game}
      />

      <DmShareSheet
        isOpen={dmShareOpen}
        onClose={() => setDmShareOpen(false)}
        attachment={{
          type: 'game',
          id: gameId,
          title: game.title,
          cover_url: game.image || null,
          subtitle: game.developers?.length ? game.developers[0] : null,
          url_path: `/game/${gameId}`,
        }}
      />

      {/* ── Screenshot Lightbox ── */}
      {lightboxSrc && (
        <div
          className="gd-lightbox"
          onClick={() => setLightboxSrc(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot fullscreen view"
        >
          <img
            src={lightboxSrc}
            alt="Screenshot fullscreen"
            className="gd-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="gd-lightbox-close"
            onClick={() => setLightboxSrc(null)}
            aria-label="Close fullscreen"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

    </div>
  )
}

export default GameDetail
