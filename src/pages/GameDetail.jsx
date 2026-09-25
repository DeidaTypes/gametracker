import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { PenLine } from 'lucide-react'
import { getGameById } from '../services/igdb'
import EmptyState from '../components/EmptyState'
import { getDominantColor, getGameSwatches } from '../services/colorExtract'
import { useGameColor } from '../contexts/GameColorContext'
import { useTransitionComplete, PAGE_TRANSITION_DURATION_MS } from '../components/PageTransition'
import { useMotionPreference } from '../hooks/useMotionPreference'
import ReviewCard from '../components/ReviewCard'
import { STATUS_TILES } from '../components/AddToListButton'
import StatusChip, { STATUS_META } from '../components/StatusChip'
import SharedCover, { getRecentCoverImage } from '../components/SharedCover'
import GameDetailStatStrip from '../components/GameDetailStatStrip'
import RatingDistributionSheet from '../components/RatingDistributionSheet'
import SimilarGamesRow from '../components/SimilarGamesRow'
import { getReviewsForGame, getRatingDistributionForGame } from '../services/reviewService'
import { getCirclePulseForGame, getFollowedRatingsForGame } from '../services/communityService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import { useAuth } from '../contexts/AuthContext'
import { addViewedGame } from '../services/userPreferences'
import { getGameStatus, setGameStatus, getLastLibraryError } from '../services/libraryService'
// TEMPORARY device debug — remove this import and the debugLog calls in
// handleStatusPillTap when the iOS status-tile investigation is done.
import { debugLog, debugLogLibraryMembership, debugTakeSetStatusError } from '../utils/deviceDebug'
import { getGameNavStub } from '../utils/gameNavStub'
import { completeGameWithRating } from '../services/completionService'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { shouldShowCount } from '../utils/formatSocialCount'
import { tap, success } from '../services/moments'
import { maybeOpenRateItSheet } from '../services/ratePrompt'
import { getCurrentCelebration } from '../services/celebrationService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { getManualSessionsForGame } from '../services/sessionService'
import ActionSheet from '../components/ActionSheet'
import JournalEntryModal from '../components/JournalEntryModal'
import DmShareSheet from '../components/DmShareSheet'
import Avatar from '../components/Avatar'
import { showToast } from '../components/Toast'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { getSWR, peekSWR } from '../services/swrCache'

/**
 * Game metadata from IGDB barely changes, so it is held longer than the
 * social data on the same page (reviews, ratings, pulse) which is
 * deliberately left uncached and always current.
 */
const GAME_TTL_MS = 5 * 60 * 1000
import './GameDetail.css'

// Display-only, shorter labels for the status tile grid below the title.
// STATUS_TILES.label itself is left untouched — it still drives the fuller
// wording used inside AddToListButton's bottom sheet.
const GD_STATUS_LABELS = {
  want: STATUS_META.want.label,
  currently: 'Playing',
  played: STATUS_META.played.label,
  dropped: STATUS_META.dropped.label,
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
      highestStreakMilestone: row.users?.highest_streak_milestone ?? null,
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
  // perf: gates every non-critical mount effect below (social bundle,
  // color extraction, SimilarGamesRow) so none of it competes with the
  // page's own 220ms entrance tween for the main thread — see
  // useTransitionComplete's docstring in PageTransition.jsx. Resolves
  // immediately when motion is reduced (there's no tween to wait for).
  const transitionComplete = useTransitionComplete()
  const { reduced: motionReduced } = useMotionPreference()
  // The color backdrop used to fade in over its own hardcoded 280ms,
  // longer than (and unsynchronized with) the page's 220ms tween — two
  // overlapping fades of different durations finishing at different times
  // is part of what read as choppy on a cold game. Matching the page
  // tween's own duration (imported from PageTransition, not re-typed as a
  // second "0.22") means the two always finish together instead of the
  // backdrop trailing off after the page has already settled. Also
  // respects reduced motion, which the old hardcoded transition never did.
  const backdropTransition = motionReduced
    ? { duration: 0 }
    : { duration: PAGE_TRANSITION_DURATION_MS / 1000 }
  // Source cover image for the shared-element flight. Comes either from
  // the navigation state (if the caller passed it) or from a small
  // module-level cache of the most recently rendered cover for this
  // gameId. Used as the hero img src until the higher-res IGDB
  // cover_big has loaded — keeps the flight target from being empty.
  const placeholderCover =
    location.state?.coverImage || getRecentCoverImage(gameId)
  // Seed from the shared cache so reopening a game the user just backed out
  // of renders the hero, title and metadata immediately rather than showing
  // a skeleton while we re-confirm details that have not changed.
  const cachedGame = peekSWR(`game:${gameId}`)
  // The "game stub" — title, year, developer, cover — that whichever grid/
  // card/row the user just tapped already had on screen and passed through
  // via router state (see src/utils/gameNavStub.js). getGameNavStub() safely
  // omits whatever field a given caller doesn't have, so this is built as
  // long as there's *anything* to seed with (a title, a coverImage on
  // location.state, or a cached cover from a prior visit) — it no longer
  // requires a title specifically. Callers that only pass `coverImage` (or
  // nothing at all, relying on the recent-cover cache) used to fall through
  // to a "cover-only" skeleton branch built for the old centered hero — that
  // branch rendered the cover inside .gd-hero with no title-section, no
  // status tiles, no About/reviews below, and never fell through to the
  // real headrow layout. That branch has been removed; this partial stub
  // now flows straight into the real render below (see the headrow hero at
  // .gd-title-section), with a skeleton title shown wherever the caller
  // didn't have one yet. Every field a full IGDB game exposes gets a safe
  // empty default here so downstream reads like `game.developers.length`
  // never crash on a partially-known game.
  const navSeed = getGameNavStub(location.state)
  const navStub =
    navSeed.title || navSeed.coverImage || placeholderCover
      ? {
          id: gameId,
          title: navSeed.title || null,
          year: navSeed.year ?? null,
          image: navSeed.coverImage || placeholderCover,
          developers: navSeed.developer ? [navSeed.developer] : [],
          publishers: [],
          genres: [],
          genreIds: [],
          themes: [],
          themeIds: [],
          platforms: [],
          screenshots: [],
          description: null,
        }
      : null
  const [game, setGame] = useState(cachedGame ?? navStub ?? null)
  const [loading, setLoading] = useState(cachedGame === undefined)
  const [error, setError] = useState(null)
  const [reviews, setReviews] = useState([])
  // Sprint 6 P0 — Map<reviewId, count> for the visible reviews. Drives
  // the Top Reviews sort and the count rendered on each card.
  const [reviewLikeCounts, setReviewLikeCounts] = useState(() => new Map())
  // Sprint 6 P1 — real comment counts per review id, fetched once per
  // refresh. The ReviewCard badge consumes these via toReviewCardShape.
  const [reviewCommentCounts, setReviewCommentCounts] = useState(() => new Map())
  // Whole-game rating distribution (avg + half-star counts) for the
  // community rating card — independent of `reviews` above, which is
  // capped to the 20 most recent rows for the Top Reviews list.
  const [ratingDist, setRatingDist] = useState(null)
  const [status, setStatus] = useState(null)
  const [dominantColor, setDominantColor] = useState(null)
  // The resolved (real IGDB, not stub) cover URL, set once getGameById
  // settles. Color extraction keys off this rather than `game.image`
  // directly so it never runs against the nav-stub placeholder — same
  // "needs the resolved cover" requirement the old inline code had.
  const [resolvedImage, setResolvedImage] = useState(null)
  const { setSwatches: setGlobalSwatches } = useGameColor()
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [circlePulse, setCirclePulse] = useState(null)
  // "From people you follow" row — followed users who rated this game.
  // Hidden entirely when count is 0 (no one followed has rated it).
  const [followedRatings, setFollowedRatings] = useState(null)
  const statusChangeInFlight = useRef(false)
  const reviewScrollAttempted = useRef(false)
  // perf/exit — guards every setState below that lands from a fetch that
  // can still be in flight when the user navigates away (reviews, rating
  // distribution, circle pulse, followed ratings). None of these fetches
  // are aborted (they're cheap reads and worth letting finish for the
  // cache), but their .then()/async continuations all check this first so
  // a slow response never calls setState on an unmounted GameDetail.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [ttb, setTtb] = useState(null)

  const refreshFromStore = useCallback(() => {
    setStatus(getGameStatus(gameId))
  }, [gameId])

  const refreshReviews = useCallback(async () => {
    try {
      const rows = await getReviewsForGame(gameId)
      if (!mountedRef.current) return
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
        if (!mountedRef.current) return
        setReviewLikeCounts(counts)
        setReviewCommentCounts(cCounts)
      } catch (err) {
        console.error('[gameDetail] like/comment count prefetch failed:', err)
        if (!mountedRef.current) return
        setReviewLikeCounts(new Map())
        setReviewCommentCounts(new Map())
      }
    } catch (err) {
      console.error('[gameDetail] failed to load reviews:', err)
      if (!mountedRef.current) return
      setReviews([])
      setReviewLikeCounts(new Map())
      setReviewCommentCounts(new Map())
    }
  }, [gameId])

  const refreshFollowedRatings = useCallback(async () => {
    try {
      const result = await getFollowedRatingsForGame(gameId)
      if (!mountedRef.current) return
      setFollowedRatings(result)
    } catch (err) {
      console.error('[gameDetail] failed to load followed ratings:', err)
      if (!mountedRef.current) return
      setFollowedRatings({ average: null, count: 0, followers: [] })
    }
  }, [gameId])

  // Circle pulse — was previously three copies of the same inline
  // `getCirclePulseForGame(gameId).then(setCirclePulse).catch(() => {})`
  // (initial load, reviewAdded handler, resume handler). Centralized here
  // so all three get the same mountedRef guard instead of each needing it
  // duplicated.
  const refreshCirclePulse = useCallback(async () => {
    try {
      const p = await getCirclePulseForGame(gameId)
      if (!mountedRef.current) return
      setCirclePulse(p)
    } catch {
      // Best-effort — leave whatever circlePulse already holds.
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
      if (!mountedRef.current) return
      setRatingDist(dist)
    } catch (err) {
      console.error('[gameDetail] failed to load rating distribution:', err)
      if (!mountedRef.current) return
      setRatingDist({ average: null, totalCount: 0, counts: null, error: true })
    }
  }, [gameId])

  useEffect(() => {
    // perf/exit — getGameById itself is the one thing on this page that is
    // NOT deferred behind the transition (the hero needs it, or already
    // has a stub to render meanwhile), but it's still a network round-trip
    // that can outlive a fast back-navigation. `cancelled` stops its
    // resolution from writing state into a GameDetail that already
    // unmounted — the request itself isn't aborted since the SWR cache
    // benefits from letting it finish for the next visit.
    let cancelled = false

    async function fetchGame() {
      try {
        const warm = peekSWR(`game:${gameId}`)
        // A warm game revalidates behind the already-rendered page; only a
        // cold one is allowed to blank the screen out to a skeleton.
        if (warm === undefined) setLoading(true)
        setError(null)
        setRatingDist(null)

        const gameData = await getSWR(`game:${gameId}`, () => getGameById(gameId), {
          ttlMs: GAME_TTL_MS,
        })
        if (cancelled) return
        setGame(gameData)
        // Hands off to the deferred color-extraction effect below — it
        // waits for both this AND the page transition to finish before
        // touching the canvas. Deliberately NOT chained here: this keeps
        // getGameById's own re-render as cheap as a single setGame call.
        setResolvedImage(gameData.image)

        addViewedGame(gameId, gameData.title, gameData.image)
        refreshFromStore()
      } catch (err) {
        if (cancelled) return
        console.error('Error fetching game:', err)
        setError('Failed to load game details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (gameId) {
      fetchGame()
    }

    return () => { cancelled = true }
  }, [gameId])

  // perf — the social bundle (reviews, rating distribution, circle pulse,
  // followed ratings). None of it needs the resolved IGDB payload, only
  // `gameId`, so it used to fire in parallel with getGameById right at
  // mount — which on a COLD game meant four fetches landing and
  // re-rendering mid-tween, fighting the entrance animation for the main
  // thread. Deferred until the transition completes (immediately, under
  // reduced motion) so it always lands "after", not "during". The visible
  // effect is these sections popping in a beat later instead of during
  // the fade — see the individual refresh* callbacks above for the
  // mountedRef guards that make this safe if the user has already
  // navigated away by the time any of these resolve.
  useEffect(() => {
    if (!gameId || !transitionComplete) return
    refreshReviews()
    refreshRatingDistribution()
    refreshCirclePulse()
    refreshFollowedRatings()
  }, [
    gameId,
    transitionComplete,
    refreshReviews,
    refreshRatingDistribution,
    refreshCirclePulse,
    refreshFollowedRatings,
  ])

  // perf — dominant-color + swatch extraction. Canvas pixel work, purely
  // cosmetic (the poster glow + backdrop tint), and cached after the first
  // run — but that first run is real main-thread work with no reason to
  // compete with the page's own entrance tween, on a warm visit or a cold
  // one. Waits for BOTH the resolved cover (can't extract from nothing)
  // AND the transition to finish (immediately, under reduced motion).
  useEffect(() => {
    if (!resolvedImage || !transitionComplete) return
    let cancelled = false
    getDominantColor(resolvedImage)
      .then((color) => { if (!cancelled) setDominantColor(color) })
      .catch(() => {})
    getGameSwatches(resolvedImage, gameId)
      .then((sw) => { if (!cancelled) setGlobalSwatches(sw) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedImage, gameId, transitionComplete, setGlobalSwatches])

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
  const [sessions, setSessions] = useState([])
  const [composeSheetOpen, setComposeSheetOpen] = useState(false)
  const [journalModalOpen, setJournalModalOpen] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)
  const [ratingDistSheetOpen, setRatingDistSheetOpen] = useState(false)

  const refreshSessions = useCallback(async () => {
    const data = await getManualSessionsForGame(gameId).catch(() => [])
    setSessions(data)
  }, [gameId])

  // Time to Beat + this game's play_sessions, for every game regardless
  // of library status. Card and Session History both sum those rows via
  // getTotalHoursForGame — do not re-derive hours here.
  useEffect(() => {
    let cancelled = false
    getTimeToBeat(gameId)
      .catch(() => null)
      .then((b) => { if (!cancelled) setTtb(b) })
    refreshSessions()
    return () => { cancelled = true }
  }, [gameId, refreshSessions])

  // Resume revalidation. Deliberately NOT a re-run of the mount-time
  // fetchGame(): the IGDB metadata it loads (title, cover, summary) can't have
  // changed while we were suspended, and re-running it would flip `loading`
  // back on and flash the skeleton over content the user is looking at. Only
  // the parts other people can move — reviews, ratings, pulse — plus local
  // status and sessions are reloaded.
  useEffect(() => {
    if (!gameId) return undefined
    const onResume = () => {
      refreshFromStore()
      refreshReviews()
      refreshRatingDistribution()
      refreshFollowedRatings()
      refreshSessions()
      refreshCirclePulse()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [
    gameId,
    refreshFromStore,
    refreshReviews,
    refreshRatingDistribution,
    refreshCirclePulse,
    refreshFollowedRatings,
    refreshSessions,
  ])

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
  // the sheet stay in sync via the one unchanged status store. 'played'
  // writes immediately (Finish), then the shared Rate it? sheet opens
  // after the celebration closes if this user has no rating.
  const handleStatusPillTap = useCallback((statusKey) => {
    // TEMPORARY device debug — remove the debugLog / debugLogLibraryMembership
    // / debugTakeSetStatusError lines in this callback when the iOS
    // status-tile investigation is done. Do not remove the original guards.
    debugLog(`a. tap statusKey=${statusKey}`)
    debugLog(`b. status=${status == null ? 'null' : status} game=${game ? game.id : 'none'}`)
    if (!game || status === statusKey) {
      debugLog(`b. GUARD FIRED ${!game ? 'no game' : 'status===statusKey'}`)
      return
    }
    debugLog('b. guard passed')
    if (statusKey === 'played') {
      completeGameWithRating({ gameId: game.id, game, rating: 0 }).then(({ ok }) => {
        // TEMPORARY device debug — remove these three lines with the block above.
        debugLog(`c. setGameStatus returned ${ok} (via completeGameWithRating)`)
        if (!ok) debugLog(`d. error: ${debugTakeSetStatusError() || '(none stashed)'}`)
        debugLogLibraryMembership(game.id, statusKey)
        if (!ok) {
          // A quota failure already showed its own distinct, honest toast
          // from saveLibrary() (libraryService.js) — don't stack a second,
          // contradictory "try again" on top of it.
          if (getLastLibraryError()?.code !== 'quota') {
            showToast('Could not update — try again', 'error')
          }
          return
        }
        success()
        refreshFromStore()
        const head = getCurrentCelebration()
        if (!head || String(head.igdbGameId) !== String(game.id)) {
          maybeOpenRateItSheet(game)
        }
      })
      return
    }
    tap()
    const ok = setGameStatus(game.id, statusKey, game)
    // TEMPORARY device debug — remove these three lines with the block above.
    debugLog(`c. setGameStatus returned ${ok}`)
    if (!ok) debugLog(`d. error: ${debugTakeSetStatusError() || '(none stashed)'}`)
    debugLogLibraryMembership(game.id, statusKey)
    refreshFromStore()
    if (!ok) {
      // See the completeGameWithRating branch above — same reasoning.
      if (getLastLibraryError()?.code !== 'quota') {
        showToast('Could not update — try again', 'error')
      }
      return
    }
    window.dispatchEvent(new Event('libraryUpdated'))
  }, [game, status, refreshFromStore])

  const handleShare = () => {
    setDmShareOpen(true)
  }

  // Only the truly-cold path (no SWR cache AND no usable stub — a deep
  // link, or a navigation with no title, no coverImage, and nothing in the
  // recent-cover cache) still gates the whole page on `loading`. The moment
  // `game` is set — whether from cache or from a passed-through stub, full
  // or partial — we fall through to the real return below and render the
  // real headrow hero immediately; `loading` from that point on only
  // affects the sections further down the page that a stub genuinely can't
  // provide (see hasDescription / hasDetails / the screenshots +
  // similar-games gates further down). A caller that only had a cover
  // (no title) no longer has a separate branch here — `navStub` above
  // already builds a partial stub for that case, so it renders through the
  // same real layout as a full stub, just with a skeleton title until
  // getGameById resolves.
  if (loading && !game) {
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

  // A stub-seeded `game` is enough to keep rendering the real page even if
  // the getGameById fetch that would have filled in the rest fails — the
  // hero the user is looking at is already correct, so an IGDB hiccup
  // shouldn't blow it away in favor of an error screen. Only show the
  // error page when there's truly nothing to show.
  if (error && !game) {
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

  // IGDB coverage varies per game; both of these sections are label-plus-
  // content with nothing to fall back on, so they hide when their content
  // is missing rather than rendering a titled blank.
  const hasDescription = !!(game.description || '').trim()
  const hasDetails =
    game.developers.length > 0 ||
    game.publishers.length > 0 ||
    game.platforms.length > 0 ||
    !!game.year

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

           Wrapped in motion.div with an opacity fade timed to MATCH the
           page's own entrance tween (backdropTransition, above) rather than
           its own independent 280ms — the two now finish together instead
           of the backdrop's fade trailing on past the page settling, which
           was part of what read as choppy on a cold game. Still blooms in
           WHILE the cover-to-hero layoutId flight is in motion (per spec);
           it's just no longer a second, differently-timed animation
           racing the page tween. */}
      <motion.div
        className="gd-color-backdrop"
        style={backdropStyle}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={backdropTransition}
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
                alt={game.title || 'Game cover'}
                onError={(e) => { e.target.src = fallbackCover }}
              />
            </SharedCover>
          </div>
        </div>
        <div className="gd-title-text">
          {/* Callers that navigated in with only a cover (no title in
              router state, and nothing in the recent-cover cache for this
              gameId) seed a partial stub whose `title` is null — shimmer a
              placeholder here rather than rendering an empty <h1> until
              getGameById resolves the real title. */}
          {game.title ? (
            <h1 className="gd-title">{game.title}</h1>
          ) : (
            <span className="gd-title-skel skeleton" aria-hidden="true" />
          )}
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
              <StatusChip
                key={tile.key}
                as="button"
                variant="tile"
                status={tile.key}
                icon={tile.icon}
                label={GD_STATUS_LABELS[tile.key] || tile.label}
                active={active}
                onClick={() => handleStatusPillTap(tile.key)}
                aria-pressed={active}
              />
            )
          })}
        </div>
      </div>

      {/* ── Session + community stat strip — one bordered container, two
           equal halves. Left: total session hours (sum). Right: community
           average + 5-bar ridge meter. Always renders; empty halves show
           muted zero states. ── */}
      <GameDetailStatStrip
        sessions={sessions}
        ratingDist={ratingDist}
        onOpenSessions={() => navigate(`/game/${gameId}/sessions`)}
        onOpenRatingDistribution={() => setRatingDistSheetOpen(true)}
      />

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
                {circlePulse.activePresence.slice(0, 5).map((p) => (
                  <Avatar
                    key={p.userId}
                    user={p}
                    size="xs"
                    className="gd-pulse-avatar"
                  />
                ))}
                {circlePulse.activePresence.length > 5 && (
                  <div className="gd-pulse-avatar-overflow">
                    +{circlePulse.activePresence.length - 5}
                  </div>
                )}
              </div>
              <p className="gd-pulse-label">
                {circlePulse.activePresence.length === 1
                  ? `${circlePulse.activePresence[0].displayName} is playing`
                  : shouldShowCount(circlePulse.activePresence.length)
                    ? `${circlePulse.activePresence.length} friends playing now`
                    : 'Friends playing now'}
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

        {/* About — a stub genuinely can't provide a summary, so this stays
             skeletoned (not hidden) for the one gap between "we don't know
             yet" and "IGDB has no summary for this game". Hidden outright
             once loading finishes and there's still nothing — that used to
             leave an "About" label over a blank fade and a "Read more"
             button with nothing to expand. */}
        {loading ? (
          <div className="gd-section">
            <p className="gd-section-label">About</p>
            <div className="gd-sk-desc skeleton" />
            <div className="gd-sk-desc gd-sk-desc--short skeleton" />
          </div>
        ) : hasDescription && (
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
              {descExpanded ? 'Show less' : 'Read more'}
            </button>
          </div>
        )}

        {/* Genres — single canonical chip set for the whole page. The "At a
             glance" vibe tags above (IGDB themes) are a separate, deliberately
             distinct concept and never duplicate these. */}
        {game.genres.length > 0 && (
          <div className="gd-section">
            <p className="gd-section-label">Genres</p>
            <div className="gd-genre-row">
              {game.genres.map((genre) => (
                <button
                  key={genre}
                  className="gd-genre-pill"
                  onClick={() => navigate(`/browse/${genreToSlug(genre)}`)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Details — every row is conditional, so the label and its grid
             follow suit rather than sitting over an empty grid for the
             sparser IGDB records. The divider goes with them. */}
        {hasDetails && (
          <>
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
          </>
        )}

        {/* Screenshots — scroll-snap + lightbox. Another field a stub
             genuinely can't provide, so it skeletons (a row of blank
             screenshot-sized tiles) instead of hiding while getGameById is
             still in flight; collapses away entirely if the loaded game
             turns out to have none. */}
        {loading ? (
          <div className="gd-section">
            <p className="gd-section-label">Screenshots</p>
            <div className="gd-screenshots-scroll" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="gd-screenshot skeleton" />
              ))}
            </div>
          </div>
        ) : game.screenshots && game.screenshots.length > 0 && (
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
                  {followedRatings.followers.slice(0, 3).map((f) => (
                    <Avatar
                      key={f.userId}
                      user={f}
                      size="sm"
                      className="gd-follow-avatar"
                    />
                  ))}
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
            <p className="gd-section-label">Top Reviews</p>
            {/* No "See all" until there's a second page worth of reviews to
                see — on an unreviewed game it only led to another empty
                state. */}
            {reviews.length > 0 && (
              <button
                className="gd-see-all-link"
                onClick={() => navigate(`/game/${gameId}/reviews`)}
                aria-label="See all reviews"
              >
                See all
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
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
                <EmptyState
                  icon={PenLine}
                  size="compact"
                  title="Be the first to review this game"
                  cta="Write a review"
                  onCta={() => setComposeSheetOpen(true)}
                />
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

        {/* More Like This — deliberately held back until the real
             genreIds/themeIds/similarGameIds land: SimilarGamesRow's own
             fetch effect only re-runs on gameId/genreIds/themeIds/
             similarGameIds, so mounting it early against the stub's empty
             values would fetch once with nothing to resolve/filter on and
             never correct itself once the real ones arrive.
             SimilarGamesRow self-fetches (and shows its own cover-skeleton
             row) in parallel with the rest of the page once mounted, and
             renders null (incl. header/divider) if it comes back empty.
             similarGameIds is IGDB's own `similar_games` relation for this
             game — already fetched by getGameById as part of the normal
             game load, never re-fetched here — and is the primary source
             fetchSimilarGamesForRow resolves from, falling back to the
             genre/theme query only when it's sparse/empty.
             "See all" reuses the same /browse/:categoryKey destination as
             the Genres chips above (CategoryResults) — there is no
             dedicated "all similar games" page today, so this is the
             closest real destination rather than a dead link.

             perf: also held back until the page transition completes —
             mounting fires SimilarGamesRow's own IGDB fetch (which can
             retry a second time internally if its first query comes back
             empty, see fetchSimilarGamesForRow), so on a cold game this
             used to start competing with the entrance tween for the main
             thread on top of everything else. */}
        {!loading && transitionComplete && (
          <SimilarGamesRow
            gameId={gameId}
            genreIds={game.genreIds || []}
            themeIds={game.themeIds || []}
            similarGameIds={game.similarGameIds || []}
            onSeeAll={
              game.genres.length > 0
                ? () => navigate(`/browse/${genreToSlug(game.genres[0])}`)
                : undefined
            }
          />
        )}

      </div>

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

      <RatingDistributionSheet
        isOpen={ratingDistSheetOpen}
        onClose={() => setRatingDistSheetOpen(false)}
        ratingDist={ratingDist}
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
