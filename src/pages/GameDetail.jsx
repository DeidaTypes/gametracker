import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { getGameById, getGamesByIds, getSimilarGames } from '../services/igdb'
import { getDominantColor, getGameSwatches } from '../services/colorExtract'
import { useGameColor } from '../contexts/GameColorContext'
import ReviewForm from '../components/ReviewForm'
import AddToListButton from '../components/AddToListButton'
import GameCard from '../components/GameCard'
import SharedCover, { getRecentCoverImage } from '../components/SharedCover'
import { GameCardSkeletonRow } from '../components/skeletons/GameCardSkeleton'
import StarRating from '../components/StarRating'
import SpoilerOverlay from '../components/SpoilerOverlay'
import { postReview, getReviewsForGame } from '../services/reviewService'
import { useAuth } from '../contexts/AuthContext'
import { addViewedGame } from '../services/userPreferences'
import { getGameStatus, setGameStatus, getGameProgress, updateGameProgress } from '../services/libraryService'
import { showToast } from '../components/Toast'
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
              stroke="rgba(200,150,90,0.3)"
              strokeWidth="1.5"
              fill="none"
            />
            {pct > 0 && (
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="#C8965A"
                clipPath={`url(#${clipId})`}
              />
            )}
          </svg>
        )
      })}
    </span>
  )
}

const STATUS_OPTIONS = [
  { key: 'want', label: 'Want to Play' },
  { key: 'currently', label: 'Playing' },
  { key: 'played', label: 'Played' },
  { key: 'dropped', label: 'Dropped' },
]

function GameDetail() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const targetReviewId = searchParams.get('review')
  const { user, profile } = useAuth()
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
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [similarGames, setSimilarGames] = useState([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState({ progressPercent: null, lastPlayedAt: null, hoursPlayed: null })
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
  const motionPrefs = useMotionPreference()

  const refreshFromStore = useCallback(() => {
    setStatus(getGameStatus(gameId))
    setProgress(getGameProgress(gameId))
  }, [gameId])

  const refreshReviews = useCallback(async () => {
    try {
      const rows = await getReviewsForGame(gameId)
      setReviews(rows)
    } catch (err) {
      console.error('[gameDetail] failed to load reviews:', err)
      setReviews([])
    }
  }, [gameId])

  useEffect(() => {
    async function fetchGame() {
      try {
        setLoading(true)
        setError(null)
        const gameData = await getGameById(gameId)
        setGame(gameData)

        addViewedGame(gameId, gameData.title)

        await refreshReviews()

        refreshFromStore()

        // Extract dominant color for poster glow (non-blocking)
        getDominantColor(gameData.image).then(color => setDominantColor(color)).catch(() => {})

        // Extract full swatch palette for chrome tinting (non-blocking).
        // We only apply the tint AFTER resolution to avoid a flash of
        // amber → tinted color while still on this page.
        getGameSwatches(gameData.image, gameId).then(sw => {
          setChromeTint(sw)
          setGlobalSwatches(sw)
        }).catch(() => {})

        // Fetch similar games: prefer IGDB `similar_games` field, fall back to genre-based
        setLoadingSimilar(true)
        try {
          let similar = []
          if (gameData.similarGameIds && gameData.similarGameIds.length > 0) {
            similar = await getGamesByIds(gameData.similarGameIds.slice(0, 12))
          }
          if (similar.length === 0 && gameData.genres && gameData.genres.length > 0) {
            similar = await getSimilarGames(gameData.genres, gameId, 12)
          }
          setSimilarGames(similar)
        } catch (err) {
          console.error('Error fetching similar games:', err)
          setSimilarGames([])
        } finally {
          setLoadingSimilar(false)
        }
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
    window.addEventListener('libraryUpdated', handleLibraryUpdate)
    window.addEventListener('storage', handleLibraryUpdate)
    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdate)
      window.removeEventListener('storage', handleLibraryUpdate)
    }
  }, [refreshFromStore])

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

  const handleReviewSubmit = async (reviewData) => {
    const { markCompleted, containsSpoilers, text, rating, liked, hoursPlayed } =
      reviewData
    try {
      const created = await postReview({
        igdbGameId: gameId,
        body: text,
        rating: Number(rating),
        liked: !!liked,
        hasSpoilers: !!containsSpoilers,
        gameTitle: game.title,
        gameImage: game.image,
        hoursPlayed: Number(hoursPlayed) || 0,
      })

      // Optimistically prepend with the joined-user shape so the in-page
      // list shows the avatar + name immediately, before the next refresh.
      const optimisticUser = {
        display_name: profile?.display_name || profile?.displayName || user?.email || 'You',
        avatar_url: profile?.avatar_url || null,
      }
      setReviews([{ ...created, users: optimisticUser }, ...reviews])
      setShowReviewForm(false)

      if (markCompleted && status !== 'played') {
        setStatus('played')
        setGameStatus(gameId, 'played', game)
      }

      // Activity logging now happens automatically inside reviewService.postReview
      // and libraryService.setGameStatus. This event is purely for listeners that
      // want the same `reviewAdded` notification under the existing name —
      // reviewService dispatches it itself, this is a redundant safety net.
      window.dispatchEvent(new Event('reviewAdded'))
    } catch (err) {
      console.error('[gameDetail] postReview failed:', err)
      showToast('Could not save your review. Please try again.', 'error')
      setShowReviewForm(false)
    }
  }

  const handleStatusChange = (newStatus) => {
    if (!game) return
    if (newStatus === status) return

    const previousStatus = status
    setStatus(newStatus)

    statusChangeInFlight.current = true
    const success = setGameStatus(gameId, newStatus, game)
    statusChangeInFlight.current = false

    if (!success) {
      setStatus(previousStatus)
      showToast('Failed to update status. Please try again.', 'error')
      return
    }

    // Activity logging happens automatically inside libraryService.setGameStatus.
    refreshFromStore()
  }

  const handleProgressChange = (percent) => {
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0))
    updateGameProgress(gameId, {
      progressPercent: clamped,
      lastPlayedAt: new Date().toISOString(),
    })
    refreshFromStore()
  }

  const handleHoursChange = (hours) => {
    const parsed = hours ? parseFloat(hours) : null
    updateGameProgress(gameId, {
      hoursPlayed: parsed,
      lastPlayedAt: new Date().toISOString(),
    })
    refreshFromStore()
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: game.title, url: window.location.href })
      } catch {}
    } else {
      navigator.clipboard?.writeText(window.location.href)
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

  const fallbackCover = 'https://via.placeholder.com/400x600/1a1a1a/ffffff?text=No+Cover'
  const ratingNum = game.rating ? parseFloat(game.rating) : null

  const effectiveColor = getEffectiveColor(dominantColor)

  // ── Chrome tint helpers ─────────────────────────────────────────────────
  // When chromeTint is set the status puck and action buttons swap their
  // default amber gradient for a vibrant → vibrantDark gradient.
  const puckStyle = chromeTint
    ? {
        background: `linear-gradient(180deg,
          rgb(${chromeTint.vibrant.r},${chromeTint.vibrant.g},${chromeTint.vibrant.b}) 0%,
          rgb(${chromeTint.vibrantDark.r},${chromeTint.vibrantDark.g},${chromeTint.vibrantDark.b}) 100%)`,
      }
    : {}

  // Border override for the active status chip wrapper
  const activeChipStyle = chromeTint
    ? { borderColor: `rgb(${chromeTint.vibrantDark.r},${chromeTint.vibrantDark.g},${chromeTint.vibrantDark.b})` }
    : {}

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
            onClick={() => setShowReviewForm(true)}
            aria-label="Write a review"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <AddToListButton game={game} variant="icon" fabStyle={fabStyle} />
        </div>
      </div>

      {/* ── Content Area ── */}
      <div className="gd-content">

        {/* Playing Status */}
        <div className="gd-section">
          <p className="gd-section-label">Playing Status</p>
          <div className="gd-status-chips">
            {STATUS_OPTIONS.map((opt) => {
              const isActive = status === opt.key
              return (
                <motion.button
                  key={opt.key}
                  className={`gd-status-chip${isActive ? ' gd-status-chip--active' : ''}`}
                  style={isActive ? activeChipStyle : {}}
                  onClick={() => handleStatusChange(opt.key)}
                  whileTap={motionPrefs.reduced ? {} : { scale: 1.06 }}
                  transition={{ scale: { duration: 0.2, ease: 'easeOut' } }}
                >
                  {isActive && (
                    <motion.div
                      className="status-puck"
                      layoutId={`game-${gameId}-status-puck`}
                      style={puckStyle}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        layout: motionPrefs.transition,
                        opacity: motionPrefs.reduced ? { duration: 0 } : { duration: 0.18 },
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <motion.span
                    className="gd-status-chip-label"
                    initial={false}
                    animate={{ color: isActive ? '#ffffff' : 'rgba(255,255,255,0.6)' }}
                    transition={motionPrefs.reduced ? { duration: 0 } : { duration: 0.12, ease: 'easeInOut' }}
                  >
                    {opt.label}
                  </motion.span>
                </motion.button>
              )
            })}
          </div>

          {status === 'currently' && (
            <div className="gd-progress-fields">
              <div className="gd-progress-field">
                <span className="gd-field-label">Progress</span>
                <div className="gd-slider-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={progress.progressPercent ?? 0}
                    onChange={(e) => handleProgressChange(e.target.value)}
                    className="gd-range"
                  />
                  <span className="gd-pct-label">{progress.progressPercent ?? 0}%</span>
                </div>
              </div>
              <div className="gd-progress-field">
                <label className="gd-field-label" htmlFor="gd-hours">Hours Played</label>
                <input
                  id="gd-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={progress.hoursPlayed ?? ''}
                  onChange={(e) => handleHoursChange(e.target.value)}
                  placeholder="0"
                  className="gd-hours-input"
                />
              </div>
            </div>
          )}
        </div>

        <div className="gd-divider" />

        {/* About — collapsible at 4 lines */}
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
            {descExpanded ? 'Read less' : 'Read more'}
          </button>
        </div>

        <div className="gd-divider" />

        {/* Details */}
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

        <div className="gd-divider" />

        {/* Reviews */}
        <div className="gd-section">
          <div className="gd-section-header-row">
            <p className="gd-section-label">Reviews ({reviews.length})</p>
            <button
              className="gd-write-review-btn"
              onClick={() => setShowReviewForm(true)}
            >
              Write Review
            </button>
          </div>

          <div className="gd-reviews-list">
            {reviews.length === 0 ? (
              <p className="gd-empty-text">No reviews yet. Be the first to review!</p>
            ) : (
              reviews.map((review) => {
                const reviewerName =
                  review.users?.display_name || 'Anonymous'
                const hours = Number(review.hours_played) || 0
                const dateLabel = review.created_at
                  ? new Date(review.created_at).toLocaleDateString()
                  : ''
                // Don't blur the user's own review on a game detail page.
                const shouldBlur =
                  !!review.has_spoilers && review.user_id !== user?.id
                return (
                  <div
                    key={review.id}
                    id={`review-${review.id}`}
                    className="gd-review-card"
                  >
                    <div className="gd-review-top">
                      <div className="gd-review-user">
                        <span className="gd-review-name">{reviewerName}</span>
                        <span className="gd-review-date">
                          {dateLabel}
                          {hours > 0 && ` · ${hours}h played`}
                        </span>
                      </div>
                      <div className="gd-review-stars">
                        <StarRating rating={parseFloat(review.rating)} size={18} />
                      </div>
                    </div>
                    {shouldBlur ? (
                      <SpoilerOverlay>
                        <p className="gd-review-body">{review.body}</p>
                      </SpoilerOverlay>
                    ) : (
                      <p className="gd-review-body">{review.body}</p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Similar Games */}
        {(loadingSimilar || similarGames.length > 0) && (
          <>
            <div className="gd-divider" />
            <div className="gd-section">
              <p className="gd-section-label">Similar Games</p>
              {loadingSimilar ? (
                <GameCardSkeletonRow count={5} />
              ) : (
                <div className="gd-similar-scroll">
                  {similarGames.map((similarGame) => (
                    <GameCard key={similarGame.id} game={similarGame} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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

      {/* Review Modal (portaled to body) */}
      <ReviewForm
        gameId={gameId}
        gameTitle={game.title}
        gameImage={game.image}
        gameYear={game.year}
        gameDeveloper={game.developers?.length > 0 ? game.developers[0] : undefined}
        gameStatus={status}
        onSubmit={handleReviewSubmit}
        onCancel={() => setShowReviewForm(false)}
        isOpen={showReviewForm}
      />
    </div>
  )
}

export default GameDetail
