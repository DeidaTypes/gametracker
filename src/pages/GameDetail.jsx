import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { getGameById } from '../services/igdb'
import { getDominantColor, getGameSwatches } from '../services/colorExtract'
import { useGameColor } from '../contexts/GameColorContext'
import ReviewCard from '../components/ReviewCard'
import AddToListButton from '../components/AddToListButton'
import SharedCover, { getRecentCoverImage } from '../components/SharedCover'
import RatingsHistogram from '../components/RatingsHistogram'
import SimilarGamesRow from '../components/SimilarGamesRow'
import { getReviewsForGame } from '../services/reviewService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import { addViewedGame } from '../services/userPreferences'
import { getGameStatus } from '../services/libraryService'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getTracker, setHoursPlayed, setProgressOverride } from '../services/hoursService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { computeProgress } from '../services/progressHelper'
import './GameDetail.css'

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

// Genre → subtle tint colors (low saturation, "tinted" not "rainbow")
const GENRE_COLORS = {
  'role-playing (rpg)':   { bg: 'rgba(139,123,175,0.14)', border: 'rgba(139,123,175,0.28)', color: 'rgba(195,178,230,0.9)' },
  'adventure':            { bg: 'rgba(74,168,153,0.13)',  border: 'rgba(74,168,153,0.26)',  color: 'rgba(130,210,190,0.9)' },
  'strategy':             { bg: 'rgba(74,127,165,0.13)',  border: 'rgba(74,127,165,0.26)',  color: 'rgba(120,180,220,0.9)' },
  'shooter':              { bg: 'rgba(100,140,80,0.13)',  border: 'rgba(100,140,80,0.26)',  color: 'rgba(155,205,130,0.9)' },
  'action':               { bg: 'rgba(196,99,78,0.13)',   border: 'rgba(196,99,78,0.26)',   color: 'rgba(230,155,130,0.9)' },
  'platform':             { bg: 'rgba(200,150,90,0.13)',  border: 'rgba(200,150,90,0.26)',  color: 'rgba(230,195,140,0.9)' },
  'puzzle':               { bg: 'rgba(74,168,153,0.13)',  border: 'rgba(74,168,153,0.26)',  color: 'rgba(130,210,190,0.9)' },
  'sport':                { bg: 'rgba(74,127,165,0.13)',  border: 'rgba(74,127,165,0.26)',  color: 'rgba(120,180,220,0.9)' },
  'sports':               { bg: 'rgba(74,127,165,0.13)',  border: 'rgba(74,127,165,0.26)',  color: 'rgba(120,180,220,0.9)' },
  'fighting':             { bg: 'rgba(196,99,78,0.13)',   border: 'rgba(196,99,78,0.26)',   color: 'rgba(230,155,130,0.9)' },
  'simulation':           { bg: 'rgba(139,123,175,0.13)', border: 'rgba(139,123,175,0.26)', color: 'rgba(195,178,230,0.9)' },
  'horror':               { bg: 'rgba(90,40,50,0.18)',    border: 'rgba(140,60,70,0.28)',   color: 'rgba(210,130,140,0.9)' },
  'indie':                { bg: 'rgba(200,150,90,0.13)',  border: 'rgba(200,150,90,0.26)',  color: 'rgba(230,195,140,0.9)' },
  'music':                { bg: 'rgba(139,123,175,0.13)', border: 'rgba(139,123,175,0.26)', color: 'rgba(195,178,230,0.9)' },
  'racing':               { bg: 'rgba(196,99,78,0.13)',   border: 'rgba(196,99,78,0.26)',   color: 'rgba(230,155,130,0.9)' },
  'arcade':               { bg: 'rgba(200,150,90,0.13)',  border: 'rgba(200,150,90,0.26)',  color: 'rgba(230,195,140,0.9)' },
}

function getGenreColor(genre) {
  return GENRE_COLORS[genre.toLowerCase()] || null
}

function genreToSlug(genre) {
  return genre.toLowerCase().replace(/\s*\(.*?\)/g, '').trim().replace(/\s+/g, '-')
}

// Inline partial-fill star row for the hero rating display
function PartialStarRow({ rating, size = 16 }) {
  const uid = `psr-${Math.round(rating * 100)}`
  return (
    <span className="gd-partial-stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.min(1, Math.max(0, rating - (star - 1)))
        const pct = Math.round(fill * 100)
        const clipId = `${uid}-s${star}`
        return (
          <svg
            key={star}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', flexShrink: 0 }}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width={`${pct}%`} height="24" />
              </clipPath>
            </defs>
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              stroke="var(--star-empty)"
              strokeWidth="1.5"
              fill="none"
            />
            {pct > 0 && (
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="var(--star)"
                clipPath={`url(#${clipId})`}
              />
            )}
          </svg>
        )
      })}
    </span>
  )
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
  const [status, setStatus] = useState(null)
  const [dominantColor, setDominantColor] = useState(null)
  // Chrome-tint swatches: set after async extraction, cleared on unmount.
  // Drives the status puck gradient, action-button tint, and (via context)
  // the BottomNav accent color.
  const [chromeTint, setChromeTint] = useState(null)
  const { setSwatches: setGlobalSwatches } = useGameColor()
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const statusChangeInFlight = useRef(false)
  const reviewScrollAttempted = useRef(false)

  // ── Hours / Progress state ──────────────────────────────────────────────────
  const [tracker, setTracker] = useState(null)
  const [trackerReady, setTrackerReady] = useState(false)
  const [ttb, setTtb] = useState(null)
  // Optimistic local hours — non-null while a debounced save is in flight.
  const [localHours, setLocalHours] = useState(null)
  const [editingHours, setEditingHours] = useState(false)
  const [inputDraft, setInputDraft] = useState('')
  const [overrideOpen, setOverrideOpen] = useState(false)
  // Optimistic local override — non-null while a debounced save is in flight.
  const [localOverride, setLocalOverride] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const saveHoursTimer = useRef(null)
  const saveOverrideTimer = useRef(null)
  const toastTimerRef = useRef(null)
  // Tracks the currently-displayed game so debounced save callbacks don't
  // mutate state after the user has already navigated to a different game.
  const gameIdRef = useRef(gameId)
  // Ref to the hours number input for iOS keyboard compatibility —
  // focus() called via setTimeout(120) matches the app-wide pattern.
  const hoursInputRef = useRef(null)

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

  useEffect(() => {
    async function fetchGame() {
      try {
        setLoading(true)
        setError(null)
        const gameData = await getGameById(gameId)
        setGame(gameData)

        addViewedGame(gameId, gameData.title, gameData.image)
        refreshFromStore()

        // Kick off all post-load work in parallel — none of these block
        // the main content from rendering.
        Promise.all([
          refreshReviews(),
          getDominantColor(gameData.image)
            .then(color => setDominantColor(color))
            .catch(() => {}),
          getGameSwatches(gameData.image, gameId)
            .then(sw => { setChromeTint(sw); setGlobalSwatches(sw) })
            .catch(() => {}),
          // Fetch TTB for ALL games (not just library games) so the Time to
          // Beat averages section is visible even before a game is tracked.
          // The timeToBeatService caches results, so the tracker effect below
          // will be a cache hit when status becomes truthy.
          getTimeToBeat(gameId)
            .then(b => setTtb(b))
            .catch(() => {}),
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
    }
    window.addEventListener('libraryUpdated', handleLibraryUpdate)
    window.addEventListener('storage', handleLibraryUpdate)
    window.addEventListener('reviewAdded', handleReviewAdded)
    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdate)
      window.removeEventListener('storage', handleLibraryUpdate)
      window.removeEventListener('reviewAdded', handleReviewAdded)
    }
  }, [refreshFromStore, refreshReviews])

  // Fetch the tracker row + TTB data once the game's library status is known.
  // Re-runs when the gameId changes (new game) or status flips to truthy (just added).
  useEffect(() => {
    if (!status) return
    let cancelled = false
    setTrackerReady(false)
    setLocalHours(null)
    setLocalOverride(null)
    setOverrideOpen(false)
    setEditingHours(false)

    async function loadTrackerAndTtb() {
      const [t, b] = await Promise.all([
        getTracker(gameId).catch(() => null),
        getTimeToBeat(gameId).catch(() => null),
      ])
      if (cancelled) return
      setTracker(t)
      setTtb(b)
      setTrackerReady(true)
    }

    loadTrackerAndTtb()
    return () => { cancelled = true }
  }, [status, gameId])

  // Clean up debounce timers on unmount so stale callbacks never fire.
  useEffect(() => {
    return () => {
      clearTimeout(saveHoursTimer.current)
      clearTimeout(saveOverrideTimer.current)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  // Keep gameIdRef in sync so save callbacks can detect game navigation.
  useEffect(() => {
    gameIdRef.current = gameId
  }, [gameId])

  // Focus the hours input when editing mode opens — 120ms matches the
  // app-wide pattern for iOS WebView keyboard triggering.
  useEffect(() => {
    if (!editingHours) return
    const t = setTimeout(() => hoursInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [editingHours])

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

  // Single review composer for the whole app: the keyboard-aware ReviewNew
  // popup at /review/new. We pass the loaded game in route state so it renders
  // instantly without a refetch. When the user posts, ReviewNew dispatches the
  // `reviewAdded` event and navigates back here, where our listener (below)
  // refreshes the in-page list.
  const openReviewComposer = useCallback(() => {
    navigate(`/review/new?gameId=${gameId}`, { state: { game } })
  }, [navigate, gameId, game])

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: game.title, url: window.location.href })
      } catch {}
    } else {
      navigator.clipboard?.writeText(window.location.href)
    }
  }

  // ── Progress computed values ────────────────────────────────────────────────
  // Prefer local (optimistic) values while a save is in flight.
  const effectiveHours = localHours !== null ? localHours : (tracker?.hours_played ?? 0)
  const effectiveOverride = localOverride !== null ? localOverride : (tracker?.progress_override ?? null)
  const progress = (status && trackerReady)
    ? computeProgress({
        hoursPlayed: effectiveHours,
        progressOverride: effectiveOverride,
        normallySeconds: ttb?.normallySeconds ?? null,
      })
    : null

  // ── Toast helper ─────────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000)
  }

  // ── Hours handlers ────────────────────────────────────────────────────────────
  // Stepper: increment/decrement in 0.5-hr steps with 800ms debounced persist.
  const handleStep = (delta) => {
    const prev = effectiveHours
    const next = Math.max(0, Math.round((prev + delta) * 2) / 2)
    const capturedGameId = gameId
    setLocalHours(next)
    clearTimeout(saveHoursTimer.current)
    saveHoursTimer.current = setTimeout(async () => {
      const result = await setHoursPlayed(capturedGameId, next, {
        game_title: game?.title,
        game_image: game?.image,
      })
      // Guard: only update UI state if the user hasn't navigated away.
      if (gameIdRef.current !== capturedGameId) return
      if (result) {
        setTracker(t => ({ ...t, hours_played: result.hours_played }))
        setLocalHours(null)
      } else {
        setLocalHours(prev)
        showToast('Could not save — try again')
      }
    }, 800)
  }

  // Input: confirm typed value (rounds to 1 decimal), immediate persist.
  const confirmHoursInput = () => {
    const parsed = parseFloat(inputDraft)
    setEditingHours(false)
    if (isNaN(parsed) || parsed < 0) return
    const prev = effectiveHours
    const next = Math.max(0, Math.round(parsed * 10) / 10)
    const capturedGameId = gameId
    setLocalHours(next)
    setHoursPlayed(capturedGameId, next, { game_title: game?.title, game_image: game?.image })
      .then(result => {
        if (gameIdRef.current !== capturedGameId) return
        if (result) {
          setTracker(t => ({ ...t, hours_played: result.hours_played }))
          setLocalHours(null)
        } else {
          setLocalHours(prev)
          showToast('Could not save — try again')
        }
      })
  }

  // ── Override handlers ─────────────────────────────────────────────────────────
  // Slider: 400ms debounced persist of the manual % override.
  const handleOverrideChange = (val) => {
    const num = parseFloat(val)
    const prev = effectiveOverride
    const capturedGameId = gameId
    setLocalOverride(num)
    clearTimeout(saveOverrideTimer.current)
    saveOverrideTimer.current = setTimeout(async () => {
      const result = await setProgressOverride(capturedGameId, num)
      if (gameIdRef.current !== capturedGameId) return
      if (result) {
        setTracker(t => ({ ...t, progress_override: result.progress_override }))
        setLocalOverride(null)
      } else {
        setLocalOverride(prev)
        showToast('Could not save override — try again')
      }
    }, 400)
  }

  // Clear: removes the manual override and falls back to hours-based estimate.
  const handleClearOverride = async () => {
    const capturedGameId = gameId
    setLocalOverride(null)
    const result = await setProgressOverride(capturedGameId, null)
    if (gameIdRef.current !== capturedGameId) return
    if (result) {
      setTracker(t => ({ ...t, progress_override: null }))
    } else {
      showToast('Could not clear override — try again')
    }
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
  const ratingNum = game.rating ? parseFloat(game.rating) : null

  const effectiveColor = getEffectiveColor(dominantColor)

  // Action-circle (FAB) tint: full vibrant → vibrantDark gradient fill
  const fabStyle = chromeTint
    ? {
        background: `linear-gradient(135deg,
          rgb(${chromeTint.vibrant.r},${chromeTint.vibrant.g},${chromeTint.vibrant.b}) 0%,
          rgb(${chromeTint.vibrantDark.r},${chromeTint.vibrantDark.g},${chromeTint.vibrantDark.b}) 100%)`,
        borderColor: `rgba(${chromeTint.vibrant.r},${chromeTint.vibrant.g},${chromeTint.vibrant.b},0.4)`,
        color: '#fff',
      }
    : {}

  // Small poster glow — radial bloom directly behind the cover art
  const glowStyle = effectiveColor
    ? { background: `radial-gradient(ellipse 180px 240px at center, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.30) 0%, transparent 80%)` }
    : {}

  // Full-bleed backdrop: two gradient layers stacked.
  //   Layer A (color, on top): dominant color opaque 0–240px → transparent 640px
  //   Layer B (radial vignette): soft bloom centered on the poster at 30% opacity
  // Both fade to transparent so the body's fixed navy gradient shows through.
  const backdropStyle = effectiveColor ? {
    background: [
      `radial-gradient(ellipse at 50% 200px, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.28) 0%, transparent 60%)`,
      `linear-gradient(180deg, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.55) 0%, rgba(${effectiveColor.r},${effectiveColor.g},${effectiveColor.b},0.55) 240px, transparent 640px)`,
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
        </div>

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
      </div>

      {/* ── Title + Action Buttons ── */}
      <div className="gd-title-section">
        <div className="gd-title-text">
          <h1 className="gd-title">{game.title}</h1>
          {game.year && <p className="gd-subtitle">{game.year}</p>}
          {game.developers.length > 0 && (
            <p className="gd-developer">{game.developers.join(', ')}</p>
          )}
          {game.publishers.length > 0 && (
            <p className="gd-publisher">{game.publishers.join(', ')}</p>
          )}

          {/* Star rating row */}
          {ratingNum && (
            <div className="gd-rating-row">
              <PartialStarRow rating={ratingNum} size={15} />
              <span className="gd-rating-text">
                {game.rating} / 5
              </span>
            </div>
          )}

          {game.genres.length > 0 && (
            <div className="gd-genre-row">
              {game.genres.map((genre) => {
                const tint = getGenreColor(genre)
                return (
                  <button
                    key={genre}
                    className="gd-genre-pill"
                    onClick={() => navigate(`/search?genre=${genreToSlug(genre)}`)}
                    style={tint ? { background: tint.bg, borderColor: tint.border, color: tint.color } : {}}
                  >
                    {genre}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="gd-action-buttons">
          <button className="gd-action-circle" style={fabStyle} onClick={handleShare} aria-label="Share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
          <button
            className="gd-action-circle"
            style={fabStyle}
            onClick={openReviewComposer}
            aria-label="Write a review"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <AddToListButton game={game} variant="icon" fabStyle={fabStyle} />
        </div>
      </div>

      {/* ── Time to Beat ── visible for any game that has IGDB TTB data,
           regardless of library status. At least one field must be non-null;
           if IGDB has no entry the whole section is hidden. ── */}
      {ttb && (ttb.hastilySeconds != null || ttb.normallySeconds != null || ttb.completelySeconds != null) && (
        <div className="gd-ttb-block">
          <p className="gd-ttb-heading">Time to beat</p>
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
        </div>
      )}

      {/* ── Your Progress ── library games only; waits for tracker fetch ── */}
      {status && trackerReady && progress && (
        <div className="gd-progress-block">

          {/* Section heading */}
          <p className="gd-progress-section-label">Your Progress</p>

          {/* Label row: "24 / ~39 hrs" + optional "manual" badge */}
          <div className="gd-progress-header">
            <span className="gd-progress-label">{progress.label}</span>
            {effectiveOverride !== null && (
              <span className="gd-override-badge">manual</span>
            )}
          </div>

          {/* Bar — always rendered; fill only when percent > 0 so 0 hrs = empty track */}
          <div
            className="gd-progress-bar-track"
            role="progressbar"
            aria-valuenow={Math.round(progress.percent ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress: ${Math.round(progress.percent ?? 0)}%`}
          >
            {(progress.percent ?? 0) > 0 && (
              <div
                className="gd-progress-bar-fill"
                style={{ width: `${Math.min(100, progress.percent)}%` }}
              />
            )}
          </div>

          {/* Hours stepper row + override toggle */}
          <div className="gd-hours-row">
            {editingHours ? (
              <div className="gd-hours-input-wrap">
                <input
                  ref={hoursInputRef}
                  className="gd-hours-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={inputDraft}
                  onChange={e => setInputDraft(e.target.value)}
                  onBlur={confirmHoursInput}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmHoursInput()
                    if (e.key === 'Escape') setEditingHours(false)
                  }}
                  aria-label="Hours played"
                />
                <span className="gd-hours-unit">hrs</span>
                <button
                  className="gd-hours-confirm"
                  onClick={confirmHoursInput}
                  aria-label="Confirm hours"
                >✓</button>
              </div>
            ) : (
              <div className="gd-hours-stepper">
                <button
                  className="gd-step-btn"
                  onClick={() => handleStep(-0.5)}
                  aria-label="Decrease hours by 0.5"
                >−</button>
                <button
                  className="gd-hours-display"
                  onClick={() => { setInputDraft(String(effectiveHours)); setEditingHours(true) }}
                  aria-label={`${effectiveHours} hours played, tap to edit`}
                >
                  {effectiveHours % 1 === 0
                    ? `${effectiveHours} hrs`
                    : `${effectiveHours.toFixed(1)} hrs`}
                </button>
                <button
                  className="gd-step-btn"
                  onClick={() => handleStep(0.5)}
                  aria-label="Increase hours by 0.5"
                >+</button>
              </div>
            )}

            {/* "Adjust %" — always labeled the same; override panel is hidden by default */}
            <button
              className="gd-override-toggle-btn"
              onClick={() => setOverrideOpen(v => !v)}
              aria-expanded={overrideOpen}
              aria-label={overrideOpen ? 'Close progress override' : 'Set progress manually'}
            >
              Adjust %
            </button>
          </div>

          {/* Override panel — collapsed by default; expands when "Adjust %" is tapped */}
          {overrideOpen && (
            <div className="gd-override-panel">
              <div className="gd-override-slider-row">
                <span className="gd-override-pct">
                  {effectiveOverride !== null ? Math.round(effectiveOverride) : 0}%
                </span>
                <input
                  className="gd-override-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={effectiveOverride !== null ? Math.round(effectiveOverride) : 0}
                  onChange={e => handleOverrideChange(e.target.value)}
                  aria-label="Manual progress percentage"
                />
                {effectiveOverride !== null && (
                  <button
                    className="gd-override-clear-btn"
                    onClick={handleClearOverride}
                    aria-label="Clear manual override"
                  >
                    Clear
                  </button>
                )}
              </div>
              {effectiveOverride !== null && (
                <p className="gd-override-hint">
                  Manual override active — hours still tracked above
                </p>
              )}
            </div>
          )}

          {/* Inline error toast */}
          {toastMsg && (
            <div className="gd-toast" role="alert" aria-live="polite">
              {toastMsg}
            </div>
          )}
        </div>
      )}

      {/* ── Content Area ── */}
      <div className="gd-content">

        {/* Top Reviews — above Information per Sprint 5 layout */}
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
                    onClick={openReviewComposer}
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
                        variant="default"
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

        <div className="gd-divider" />

        {/* Information — About + Details + Screenshots, with histogram on top */}
        <div className="gd-section">
          {/* Ratings histogram — renders only when review ratings exist */}
          <RatingsHistogram
            ratings={reviews
              .map(r => parseFloat(r.rating))
              .filter(r => !isNaN(r) && r >= 0 && r <= 5)}
          />

          <p className="gd-section-label">About</p>
          <div className={`gd-description-wrapper${descExpanded ? ' gd-description-wrapper--expanded' : ''}`}>
            <p className="gd-description">{game.description}</p>
            {!descExpanded && <div className="gd-description-fade" aria-hidden="true" />}
          </div>
          <button
            className="gd-read-more-btn"
            onClick={() => setDescExpanded(v => !v)}
          >
            {descExpanded ? 'Read less' : 'Read more'}
          </button>
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

        {/* Similar Games — SimilarGamesRow self-fetches in parallel; renders null (incl. header) if no results */}
        <SimilarGamesRow
          gameId={gameId}
          genreIds={game.genreIds || []}
          themeIds={game.themeIds || []}
        />

      </div>

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
