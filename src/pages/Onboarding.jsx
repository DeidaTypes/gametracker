import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  PlayCircle,
  List,
  Search,
  X,
  Plus,
  Check,
  SearchX,
  Gamepad2,
  Ban,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { searchGames } from '../services/searchService'
import { getBestImageUrl } from '../services/imageUtils'
import { updateProfile } from '../services/profileService'
import { updateUserProfile } from '../services/userService'
import { completeOnboarding } from '../services/onboardingService'
import { setOnboarded } from '../services/userPreferences'
import { postReview, getReviewsForUser } from '../services/reviewService'
import { getGameStatus } from '../services/libraryService'
import {
  PLATFORM_CHIPS,
  ERA_CHIPS,
  fetchRateFromMemoryCandidates,
  getNeverPlayedExclusions,
  excludeGameAsNeverPlayed,
} from '../services/rateFromMemoryService'
import { StarRatingInput } from '../components/forms'
import { showToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useKeyboardOpen } from '../hooks/useKeyboardInset'
import './Onboarding.css'

/**
 * Deterministic gradient used ONLY as the cover fallback — behind a
 * loading cover, and as the final placeholder for a game IGDB has no
 * art for. Hashed from the game's IGDB id across the app's --genre-*
 * jewel-tone palette (cobalt / teal / purple / rose / steel only —
 * orange/amber is retired app-wide, see src/styles/theme.css). Id-based
 * rather than genre-based so adjacent placeholders in the same franchise
 * still read as distinct. Tokens only — no hardcoded hex.
 */
const TILE_COLOR_TOKENS = [
  '--genre-action', '--genre-rpg', '--genre-adventure', '--genre-strategy',
  '--genre-shooter', '--genre-sports', '--genre-racing', '--genre-puzzle',
  '--genre-simulation', '--genre-fighting', '--genre-platformer',
  '--genre-horror', '--genre-indie', '--genre-arcade',
]

function tileColorVar(id) {
  const n = Math.abs(Number(id)) || 0
  const token = TILE_COLOR_TOKENS[n % TILE_COLOR_TOKENS.length]
  return `var(${token})`
}

/**
 * Three value-prop/action screens (indices 0-2), matching the approved
 * onboarding mockups:
 *   0 — "Track what you play"  — cobalt -> journal two-tone intro
 *   1 — "Build your backlog"   — single journal-purple accent
 *   2 — favorites game-picker  — see PICKER_STEP below
 *
 * Condensed from a prior 5-screen flow ("Share your thoughts" and "Find
 * your people" value props were dropped) so the step count matches the
 * 3-step mockup set 1:1.
 */
const VALUE_PROP_SCREENS = [
  {
    key: 'track',
    Icon: PlayCircle,
    accent: 'cobalt',
    twoTone: true,
    announceTitle: "Every game you've ever played, remembered.",
    titleLead: "Every game you've ever played,",
    titleGradient: 'remembered.',
    body: "From the one that hooked you as a kid to what you booted up last night — it all lives here.",
    cta: 'Next',
  },
  {
    key: 'backlog',
    Icon: List,
    accent: 'journal',
    twoTone: false,
    announceTitle: 'Build your backlog',
    title: 'Build your backlog',
    body: 'Create lists for cozy games, multiplayer nights, anything you can think of.',
    cta: 'Next',
  },
]

// Step 2 (the third screen) is the favorites game-picker.
const PICKER_STEP = 2
// Step 3 — "What did you play on?" (platforms + eras). Step 4 — "Five from
// your past" (rate-from-memory). Both are new; both are skippable; neither
// touches game_trackers (see rateFromMemoryService.js header comment and
// postReview() in reviewService.js).
const PLATFORM_STEP = 3
const RATE_STEP = 4
const TOTAL_STEPS = 5
// Per-step dot/accent color, in step order — mirrors each screen's accent
// and the picker's content-forward green so the dot trail visually narrates
// cobalt -> journal purple -> review green -> cobalt -> star gold across the
// whole flow. --star is the app's one sanctioned warm token (rating gold,
// see .cursorrules), which is exactly what the rating step is.
const STEP_ACCENT_VARS = [
  'var(--accent)',
  'var(--accent-journal)',
  'var(--accent-review)',
  'var(--accent)',
  'var(--star)',
]
// How many games IGDB requests fire per five-card set: exactly one (see
// fetchRateFromMemoryCandidates in rateFromMemoryService.js — the whole
// pool is fetched up front, so zero further requests happen per-card), plus
// a same-session fallback query only if that first request returns zero
// candidates.
const RATE_STEP_TOTAL = 5

export default function Onboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { reduced } = useMotionPreference()

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  // Screen 3 — game picker
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selectedGames, setSelectedGames] = useState([])
  const [submitting, setSubmitting] = useState(false)

  // Step 3 — platforms + eras
  const [selectedPlatformChips, setSelectedPlatformChips] = useState([])
  const [selectedEraChips, setSelectedEraChips] = useState([])

  // Step 4 — rate from memory
  const [rateCandidates, setRateCandidates] = useState([])
  const [rateLoading, setRateLoading] = useState(false)
  // True once the candidate-load attempt has finished (success or failure/
  // empty) — gates the auto-finish effect below so it can't fire on the
  // very first render, before loading has even started.
  const [rateReady, setRateReady] = useState(false)
  const [rateIndex, setRateIndex] = useState(0)
  const [rateSubmittingId, setRateSubmittingId] = useState(null)
  const [ratedCount, setRatedCount] = useState(0)
  const rateLoadedRef = useRef(false)

  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const announceRef = useRef(null)

  // Announce current screen title to screen readers whenever step changes.
  useEffect(() => {
    const title =
      step < PICKER_STEP
        ? VALUE_PROP_SCREENS[step].announceTitle
        : step === PICKER_STEP
          ? 'Add 3 favorite games'
          : step === PLATFORM_STEP
            ? 'What did you play on?'
            : 'Five from your past'
    if (announceRef.current) {
      // Clear first so repeated-same-step announcements still fire.
      announceRef.current.textContent = ''
      // Defer so the DOM diff settles before the live region fires.
      requestAnimationFrame(() => {
        if (announceRef.current) announceRef.current.textContent = title
      })
    }
  }, [step])

  // Auto-focus search input when reaching the picker screen.
  useEffect(() => {
    if (step !== PICKER_STEP) return undefined
    const id = setTimeout(() => inputRef.current?.focus(), 160)
    return () => clearTimeout(id)
  }, [step])

  const goToStep = useCallback(
    (next) => {
      setDirection(next > step ? 1 : -1)
      setStep(next)
    },
    [step]
  )

  // Set once favorites are actually saved (step 2 "Done" with 1+ picks) —
  // only ever used to shape the final completion toast, never re-read for
  // any write.
  const [favoritesCount, setFavoritesCount] = useState(0)

  // ── Shared "finish onboarding" logic — now the ONLY place that marks
  // onboarding complete and navigates home. Step 2 (favorites) and step 3
  // (platforms/eras) no longer call this directly; they advance instead.
  // This runs once, at the true end of the flow (step 4 done/skipped, or
  // header Skip from an earlier step). ──────────────────────────────
  const finish = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      // Mark onboarded — localStorage first (instant, guards re-fire
      // before the Supabase write returns) then Supabase.
      setOnboarded(true)
      if (user?.id) {
        await completeOnboarding(user.id)
      }

      navigate('/', { replace: true })

      const parts = []
      if (favoritesCount > 0) parts.push('favorites')
      if (ratedCount > 0) parts.push('ratings')
      if (parts.length > 0) {
        showToast(
          `Welcome to Checkpoint. Your ${parts.join(' and ')} are on your profile.`,
          'success',
          5000
        )
      }
    } catch (err) {
      console.error('[Onboarding] finish failed:', err)
      // Always navigate even if writes partially fail.
      navigate('/', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }, [submitting, user, navigate, favoritesCount, ratedCount])

  // Header "Skip" is the one shared skip affordance for every step, but its
  // effect depends on where it's tapped:
  //   - Steps 0/1/2 (unchanged behavior): abort onboarding entirely, same
  //     as before this change — nothing selected on those steps is saved.
  //   - Step 3 (platforms/eras): skip THIS STEP only — falls through to
  //     Step 4 with no platform/era filter, which fetchRateFromMemoryCandidates
  //     resolves as "broadly popular games across eras" (no platform/era
  //     clause in the query).
  //   - Step 4 (rate from memory): this is the last step, so skipping it
  //     IS finishing onboarding — same as before, partial/zero ratings are
  //     fine.
  const handleSkip = useCallback(() => {
    if (step === PLATFORM_STEP) {
      goToStep(RATE_STEP)
      return
    }
    finish()
  }, [step, goToStep, finish])

  const handleNext = useCallback(() => {
    if (step < PICKER_STEP) goToStep(step + 1)
  }, [step, goToStep])

  // Step 2 "Done" — saves favorites (exactly the same write as before:
  // localStorage + users.favorite_games, never a tracker status) then
  // ADVANCES to the platform step instead of finishing onboarding.
  const handleFavoritesDone = useCallback(async () => {
    if (submitting) return
    if (selectedGames.length > 0) {
      setSubmitting(true)
      try {
        const favorites = selectedGames.slice(0, 4)
        updateProfile({ favoriteGames: favorites })
        if (user?.id) {
          try {
            await updateUserProfile(user.id, { favoriteGames: favorites })
          } catch (err) {
            // Favorites are already saved locally; a failed sync must not
            // trap the user on onboarding.
            console.error('[Onboarding] favorites sync failed:', err)
          }
        }
        setFavoritesCount(favorites.length)
      } finally {
        setSubmitting(false)
      }
    }
    goToStep(PLATFORM_STEP)
  }, [submitting, selectedGames, user, goToStep])

  // Step 3 "Next" — platforms/eras are read directly from state by the
  // rate-candidate loader; nothing to persist here beyond advancing.
  const handlePlatformNext = useCallback(() => {
    goToStep(RATE_STEP)
  }, [goToStep])

  const togglePlatformChip = useCallback((chipId) => {
    setSelectedPlatformChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    )
  }, [])

  const toggleEraChip = useCallback((chipId) => {
    setSelectedEraChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    )
  }, [])

  // ── Step 4 — rate from memory ──────────────────────────────────────
  // Loads the candidate pool exactly once per onboarding session, when the
  // step is first reached. See rateFromMemoryService.js for the query
  // (ONE batched IGDB request in the normal case) and exclusion rules.
  useEffect(() => {
    if (step !== RATE_STEP || rateLoadedRef.current) return
    rateLoadedRef.current = true
    let cancelled = false
    ;(async () => {
      setRateLoading(true)
      try {
        // Exclude: permanently "never played" + already-rated (reviews)
        // games. "Already tracks" is applied after fetch below, since the
        // candidate ids aren't known until the query returns.
        const excludeIds = getNeverPlayedExclusions()
        if (user?.id) {
          try {
            const reviews = await getReviewsForUser(user.id)
            for (const r of reviews) {
              if (r.igdb_game_id != null) excludeIds.add(String(r.igdb_game_id))
            }
          } catch (err) {
            console.error('[Onboarding] fetching existing reviews failed:', err)
          }
        }

        const candidates = await fetchRateFromMemoryCandidates({
          platformChipIds: selectedPlatformChips,
          eraChipIds: selectedEraChips,
          excludeIds,
          limit: RATE_STEP_TOTAL,
        })

        // "...or tracks" exclusion — local device library check, cheap and
        // synchronous (see libraryService.getGameStatus).
        const untracked = candidates.filter((g) => !getGameStatus(g.id))

        if (!cancelled) setRateCandidates(untracked)
      } catch (err) {
        console.error('[Onboarding] loading rate candidates failed:', err)
        if (!cancelled) setRateCandidates([])
      } finally {
        if (!cancelled) {
          setRateLoading(false)
          setRateReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once via rateLoadedRef
  }, [step])

  // Auto-finish once every card has been resolved (rated / never played /
  // skipped) — this is the last step, so running out of cards IS finishing
  // onboarding. `rateReady` gates this so it can't fire before the load
  // effect above has even run (e.g. on first render, index 0 >= length 0
  // would otherwise look "done" before candidates ever loaded). Also
  // covers the zero-candidates case (empty pool) the same way.
  useEffect(() => {
    if (step !== RATE_STEP || !rateReady) return
    if (rateIndex >= rateCandidates.length) {
      finish()
    }
  }, [step, rateReady, rateIndex, rateCandidates.length, finish])

  // Advance past the current rate card — shared tail for rate/never-played/
  // skip. The effect above handles finishing once the cards run out.
  const advanceRateCard = useCallback(() => {
    setRateIndex((prev) => prev + 1)
  }, [])

  const handleRateStar = useCallback(
    async (candidate, value) => {
      if (rateSubmittingId != null) return
      setRateSubmittingId(candidate.id)
      try {
        await postReview({
          igdbGameId: candidate.id,
          body: '',
          rating: value,
          gameTitle: candidate.title,
          gameImage: candidate.image,
        })
        setRatedCount((c) => c + 1)
        advanceRateCard()
      } catch (err) {
        console.error('[Onboarding] rating failed:', err)
        showToast('Could not save your rating. Please try again.', 'error')
      } finally {
        setRateSubmittingId(null)
      }
    },
    [rateSubmittingId, advanceRateCard]
  )

  const handleNeverPlayed = useCallback(
    (candidate) => {
      excludeGameAsNeverPlayed(candidate.id)
      advanceRateCard()
    },
    [advanceRateCard]
  )

  const handleSkipCard = useCallback(() => {
    advanceRateCard()
  }, [advanceRateCard])

  // ── Game search ───────────────────────────────────────────────────
  const handleQueryChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)

    if (!val.trim()) {
      setResults([])
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    setSearchLoading(true)
    setSearchError(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const games = await searchGames(val.trim(), 20)
        setResults(games)
      } catch (err) {
        console.error('[Onboarding] search failed:', err)
        setSearchError('Search failed — please try again.')
        setResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }, [])

  const isPicked = useCallback(
    (id) => selectedGames.some((g) => String(g.id) === String(id)),
    [selectedGames]
  )

  const toggleGame = useCallback(
    (game) => {
      if (isPicked(game.id)) {
        setSelectedGames((prev) =>
          prev.filter((g) => String(g.id) !== String(game.id))
        )
      } else {
        setSelectedGames((prev) => [
          ...prev,
          {
            id: game.id,
            title: game.title || '',
            image: game.image || null,
            developer: game.developer || '',
          },
        ])
      }
    },
    [isPicked]
  )

  const removeSelected = useCallback((id) => {
    setSelectedGames((prev) =>
      prev.filter((g) => String(g.id) !== String(id))
    )
  }, [])

  // ── Slide animation ───────────────────────────────────────────────
  const slideDuration = reduced ? 0 : 0.24
  const slideVariants = {
    enter: (dir) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
  }

  // Done is always actionable — at 0 picks it's a "Done = skip" pathway
  // (muted styling signals that), at 1+ it saves whatever's selected (no
  // minimum of 3 required). Visual state alone communicates progress.
  const remaining = Math.max(0, 3 - selectedGames.length)

  return (
    // kb-viewport-fit: this page is a fixed shell (header / scroll region /
    // action bar) whose results list is the only scroller, so it sizes to the
    // space the keyboard leaves rather than extending underneath it. See
    // src/styles/keyboard.css.
    <div className="ob-page kb-viewport-fit" role="main">
      {/* Screen-reader live region — announces each screen's title on mount */}
      <span
        ref={announceRef}
        className="ob-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />

      {/* ── Header: progress dots + Skip ── */}
      <div className="ob-header">
        <div className="ob-dots" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'inactive'
            return (
              <span
                key={i}
                className={`ob-dot ob-dot--${state}`}
                style={
                  state !== 'inactive'
                    ? { '--ob-dot-color': STEP_ACCENT_VARS[i] }
                    : undefined
                }
              />
            )
          })}
        </div>
        <button
          type="button"
          className="ob-skip"
          onClick={handleSkip}
          aria-label={step === PLATFORM_STEP ? 'Skip this step' : 'Skip onboarding'}
          disabled={submitting}
        >
          Skip
        </button>
      </div>

      {/* ── Animated slide area ── */}
      <div className="ob-slide-wrap" aria-live="off">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          {step < PICKER_STEP ? (
            <motion.div
              key={`vp-${step}`}
              className="ob-slide"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: slideDuration, ease: 'easeInOut' }}
            >
              <ValuePropSlide
                screen={VALUE_PROP_SCREENS[step]}
                onNext={handleNext}
              />
            </motion.div>
          ) : step === PICKER_STEP ? (
            <motion.div
              key="picker"
              className="ob-slide ob-slide--picker"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: slideDuration, ease: 'easeInOut' }}
            >
              <GamePickerSlide
                query={query}
                onQueryChange={handleQueryChange}
                inputRef={inputRef}
                results={results}
                loading={searchLoading}
                error={searchError}
                selectedGames={selectedGames}
                isPicked={isPicked}
                toggleGame={toggleGame}
                removeSelected={removeSelected}
                remaining={remaining}
                onDone={handleFavoritesDone}
                submitting={submitting}
                reduced={reduced}
              />
            </motion.div>
          ) : step === PLATFORM_STEP ? (
            <motion.div
              key="platform"
              className="ob-slide"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: slideDuration, ease: 'easeInOut' }}
            >
              <PlatformEraSlide
                selectedPlatformChips={selectedPlatformChips}
                selectedEraChips={selectedEraChips}
                togglePlatformChip={togglePlatformChip}
                toggleEraChip={toggleEraChip}
                onNext={handlePlatformNext}
              />
            </motion.div>
          ) : (
            <motion.div
              key="rate"
              className="ob-slide"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: slideDuration, ease: 'easeInOut' }}
            >
              <RateFromMemorySlide
                loading={rateLoading}
                candidates={rateCandidates}
                index={rateIndex}
                submittingId={rateSubmittingId}
                onRateStar={handleRateStar}
                onNeverPlayed={handleNeverPlayed}
                onSkipCard={handleSkipCard}
                reduced={reduced}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Value-prop slide (screens 1-2) ──────────────────────────────────────

function ValuePropSlide({ screen, onNext }) {
  const { Icon, accent, twoTone, title, titleLead, titleGradient, body, cta } =
    screen
  return (
    <div className={`ob-vp ob-vp--${accent}`}>
      <div className="ob-vp__glow" aria-hidden="true">
        {twoTone ? (
          <>
            <span className="ob-vp__glow-blob ob-vp__glow-blob--cobalt" />
            <span className="ob-vp__glow-blob ob-vp__glow-blob--journal" />
          </>
        ) : (
          <span className="ob-vp__glow-blob ob-vp__glow-blob--solo" />
        )}
      </div>

      <div
        className={
          'ob-vp__icon-frame' +
          (twoTone
            ? ' ob-vp__icon-frame--twotone'
            : ' ob-vp__icon-frame--solid')
        }
        aria-hidden="true"
      >
        <Icon size={42} strokeWidth={1.6} className="ob-vp__icon" />
      </div>

      <h1 className="ob-vp__title">
        {twoTone ? (
          <>
            {titleLead}
            <br />
            <span className="ob-vp__title-gradient">{titleGradient}</span>
          </>
        ) : (
          title
        )}
      </h1>
      <p className="ob-vp__body">{body}</p>
      <div className="ob-cta-wrap">
        <button
          type="button"
          className={
            'ob-cta-btn' + (accent === 'journal' ? ' ob-cta-btn--journal' : '')
          }
          onClick={onNext}
        >
          {cta}
        </button>
      </div>
    </div>
  )
}

// ── Game-picker slide (screen 3) ────────────────────────────────────────

/**
 * Cover art for a picker tile. Renders the real IGDB cover the same way
 * the rest of the app does (getBestImageUrl at t_cover_big for a
 * poster-sized grid slot, matching the Library grid and ListCoverCluster);
 * only games IGDB has no art for — or whose image 404s — fall back to the
 * titled gradient placeholder. Caller supplies the sized, ratio'd,
 * radius'd container.
 */
function PickerCoverArt({ game }) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : getBestImageUrl(game, 240)

  if (!url) {
    return (
      <>
        <span className="ob-cover-scrim" aria-hidden="true" />
        <span className="ob-cover-title">{game.title}</span>
      </>
    )
  }

  return (
    <img
      src={url}
      alt=""
      className="ob-cover-img"
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Collapse/expand used by everything that gives up its space while the user
 * is searching. Animating height (not opacity alone) is what makes the
 * results list actually grow into the freed space rather than sit under a
 * transparent hole.
 */
const COLLAPSED = { height: 0, opacity: 0 }
const EXPANDED = { height: 'auto', opacity: 1 }

function GamePickerSlide({
  query,
  onQueryChange,
  inputRef,
  results,
  loading,
  error,
  selectedGames,
  isPicked,
  toggleGame,
  removeSelected,
  remaining,
  onDone,
  submitting,
  reduced,
}) {
  const clearQuery = useCallback(() => {
    onQueryChange({ target: { value: '' } })
    inputRef.current?.focus()
  }, [onQueryChange, inputRef])

  const pickedCount = selectedGames.length
  const picksLabel =
    pickedCount === 0
      ? 'Your 3 picks'
      : pickedCount >= 3
        ? 'Your 3 picks — ready!'
        : `Your 3 picks — ${remaining} more to go`

  // The picks area has two layouts, never both at once (a results list
  // layered over the picks grid reads as a rendering glitch). Typing swaps
  // the three full-size slots for one compact strip; clearing the field
  // swaps them back, now holding whatever was chosen.
  const searching = query.trim().length > 0

  // The intro copy answers "what is this screen", which is a question the
  // user has stopped asking by the time the keyboard is up. It also has to
  // go: with the keyboard open and the slots at full size the step is ~66px
  // taller than the space above the keyboard, and the thing that falls off
  // the bottom is the Done button. Keyed on the keyboard rather than on
  // focus because picking a game moves focus to the tile — a focus-keyed
  // rule would expand this again mid-selection, under a keyboard that never
  // went away.
  const keyboardOpen = useKeyboardOpen()
  const showIntro = !searching && !keyboardOpen

  // ~200ms end to end in both directions. The intro collapses over the full
  // duration while the picks swap runs as two half-length legs (old out, new
  // in) under AnimatePresence's `wait`, so everything settles together.
  const introTransition = { duration: reduced ? 0 : 0.2, ease: 'easeInOut' }
  const swapTransition = { duration: reduced ? 0 : 0.1, ease: 'easeInOut' }

  return (
    <div className="ob-picker" aria-label="Add 3 favorite games">
      {/* Top section: title + subtitle + search */}
      <div className="ob-picker__top">
        <AnimatePresence initial={false}>
          {showIntro && (
            <motion.div
              key="intro"
              className="ob-collapse"
              initial={COLLAPSED}
              animate={EXPANDED}
              exit={COLLAPSED}
              transition={introTransition}
            >
              <h1 className="ob-vp__title">Add 3 favorite games</h1>
              <p className="ob-vp__body">
                Start with what you love — we&rsquo;ll use this to personalize
                your feed.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search input */}
        <div className="ob-search-row">
          <Search size={18} className="ob-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="ob-search-input"
            placeholder="Search games…"
            value={query}
            onChange={onQueryChange}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search games"
          />
          {query && (
            <button
              type="button"
              className="ob-search-clear"
              onClick={clearQuery}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Picks area — exactly one of two states occupies this space.
            Idle: three full-size slots, empty (dashed "+" placeholder) or
            holding a chosen cover. Searching: a one-line strip that keeps
            the progress count and thumbnails of what's already picked
            visible, so the space goes to the results instead. */}
        <AnimatePresence initial={false} mode="wait">
          {searching ? (
            <motion.div
              key="picks-strip"
              className="ob-collapse"
              initial={COLLAPSED}
              animate={EXPANDED}
              exit={COLLAPSED}
              transition={swapTransition}
            >
              <div className="ob-picks-strip">
                {pickedCount > 0 && (
                  <div className="ob-picks-strip__thumbs" aria-hidden="true">
                    {selectedGames.map((game) => (
                      <span
                        key={game.id}
                        className="ob-picks-strip__thumb"
                        style={{ '--ob-tile-color': tileColorVar(game.id) }}
                      >
                        <PickerCoverArt game={game} />
                      </span>
                    ))}
                  </div>
                )}
                <p
                  className={
                    'ob-picks-strip__count' +
                    (pickedCount > 0 ? ' ob-picks-strip__count--active' : '')
                  }
                >
                  <strong>{pickedCount}</strong> of 3 selected
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="picks-slots"
              className="ob-collapse"
              initial={COLLAPSED}
              animate={EXPANDED}
              exit={COLLAPSED}
              transition={swapTransition}
            >
              <div className="ob-picks">
                <p className="ob-picks__label">{picksLabel}</p>
                <div
                  className="ob-picks__row"
                  role="list"
                  aria-label="Your 3 picks"
                >
                  {[0, 1, 2].map((slotIndex) => {
                    const game = selectedGames[slotIndex]
                    if (game) {
                      return (
                        <div
                          key={game.id}
                          className="ob-picks__slot ob-picks__slot--filled"
                          role="listitem"
                        >
                          <div
                            className="ob-selected-cover"
                            style={{ '--ob-tile-color': tileColorVar(game.id) }}
                          >
                            <PickerCoverArt game={game} />
                            <button
                              type="button"
                              className="ob-selected-remove"
                              onClick={() => removeSelected(game.id)}
                              aria-label={`${game.title}, selected, tap to remove`}
                            >
                              <X size={9} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div
                        key={`empty-${slotIndex}`}
                        className="ob-picks__slot ob-picks__slot--empty"
                        role="listitem"
                        aria-hidden="true"
                      >
                        <Plus size={18} strokeWidth={2} />
                      </div>
                    )
                  })}
                </div>

                {/* Zero-state hint — plain muted text, never boxed like an
                    input (there is exactly one search field on this screen,
                    above). */}
                {pickedCount === 0 && (
                  <p className="ob-picks__hint">
                    Search above to find your favorites
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scrollable results */}
      <div className="ob-picker__body">
        {loading && (
          <div className="ob-picker__state" aria-live="polite">
            <span className="ob-spinner" aria-hidden="true" />
            <span>Searching…</span>
          </div>
        )}

        {!loading && error && (
          <p
            className="ob-picker__state ob-picker__state--error"
            aria-live="assertive"
          >
            {error}
          </p>
        )}

        {!loading && !error && query.trim() && results.length === 0 && (
          <div aria-live="polite">
            <EmptyState icon={SearchX} size="inline" body={`No games found for "${query}"`} />
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <ul
            className="ob-grid"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Search results"
          >
            {results.map((game) => {
              const picked = isPicked(game.id)
              return (
                <li key={game.id} className="ob-grid__cell">
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked}
                    aria-label={game.title}
                    className={
                      'ob-grid__tile' + (picked ? ' ob-grid__tile--picked' : '')
                    }
                    style={{ '--ob-tile-color': tileColorVar(game.id) }}
                    onClick={() => toggleGame(game)}
                  >
                    <div className="ob-grid__cover">
                      <PickerCoverArt game={game} />
                      {picked && (
                        <span
                          className="ob-grid__check"
                          aria-hidden="true"
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Bottom: status text + Done. Skip lives only in the top header now. */}
      <div className="ob-picker__bottom">
        {/* While searching the compact strip already shows this count, so
            the visible copy collapses to avoid saying it twice in one view.
            It stays mounted rather than unmounting: it is the live region
            that announces each selection, and that must keep working when a
            game is picked from the results. */}
        <p
          className={
            'ob-picker__count-hint' +
            (pickedCount > 0 ? ' ob-picker__count-hint--active' : '') +
            (searching ? ' ob-sr-only' : '')
          }
          aria-live="polite"
        >
          {pickedCount} of 3 selected
        </p>
        <div className="ob-picker__actions">
          <button
            type="button"
            className={
              'ob-picker__btn ob-picker__btn--full' +
              (pickedCount === 0
                ? ' ob-picker__btn--muted'
                : ' ob-picker__btn--primary')
            }
            onClick={onDone}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Platform + era slide (step 4, "What did you play on?") ─────────────
//
// Multi-select chips, both groups optional. Skipping (via the header Skip,
// see handleSkip) leaves both selections empty, which
// fetchRateFromMemoryCandidates resolves as "no platform/era filter" —
// i.e. broadly popular games across eras, per spec.
function PlatformEraSlide({
  selectedPlatformChips,
  selectedEraChips,
  togglePlatformChip,
  toggleEraChip,
  onNext,
}) {
  return (
    <div className="ob-vp ob-vp--platform">
      <div
        className="ob-vp__icon-frame ob-vp__icon-frame--solid"
        aria-hidden="true"
      >
        <Gamepad2 size={42} strokeWidth={1.6} className="ob-vp__icon" />
      </div>

      <h1 className="ob-vp__title">What did you play on?</h1>
      <p className="ob-vp__body">
        Pick what applies — we&rsquo;ll use it to find games from your past.
        Totally optional.
      </p>

      <div className="ob-chip-section">
        <p className="ob-chip-section__label">Platforms</p>
        <div className="ob-chip-group" role="group" aria-label="Platforms you played on">
          {PLATFORM_CHIPS.map((chip) => {
            const active = selectedPlatformChips.includes(chip.id)
            return (
              <button
                key={chip.id}
                type="button"
                className={`ob-chip${active ? ' ob-chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => togglePlatformChip(chip.id)}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ob-chip-section">
        <p className="ob-chip-section__label">Eras</p>
        <div className="ob-chip-group" role="group" aria-label="Decades you played games in">
          {ERA_CHIPS.map((chip) => {
            const active = selectedEraChips.includes(chip.id)
            return (
              <button
                key={chip.id}
                type="button"
                className={`ob-chip${active ? ' ob-chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleEraChip(chip.id)}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ob-cta-wrap">
        <button type="button" className="ob-cta-btn" onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  )
}

// ── Rate-from-memory slide (step 5, "Five from your past") ─────────────
//
// One card at a time. Tapping a star calls postReview() directly (the same
// write used everywhere else in the app) and auto-advances; "Never played"
// permanently excludes the game via rateFromMemoryService and advances;
// "Skip" advances without writing or excluding anything, so the game may
// resurface on a later run. See handleRateStar/handleNeverPlayed/
// handleSkipCard in the parent for the actual writes.
function RateFromMemorySlide({
  loading,
  candidates,
  index,
  submittingId,
  onRateStar,
  onNeverPlayed,
  onSkipCard,
  reduced,
}) {
  const total = candidates.length
  const candidate = candidates[index]

  // Optimistic star value — shows the tapped rating immediately while
  // postReview() is in flight, rather than snapping back to 0 mid-punch.
  // Resets whenever the card changes. Declared before the early returns
  // below so hook order stays stable across loading/empty/card renders.
  const [pendingValue, setPendingValue] = useState(0)
  const candidateId = candidate?.id
  useEffect(() => {
    setPendingValue(0)
  }, [candidateId])

  if (loading) {
    return (
      <div className="ob-vp ob-vp--rate">
        <div className="ob-picker__state" aria-live="polite">
          <span className="ob-spinner" aria-hidden="true" />
          <span>Finding games from your past…</span>
        </div>
      </div>
    )
  }

  // Nothing to rate (empty pool, or every card already resolved this
  // render) — the parent's advanceRateCard() finishes onboarding right
  // after this state is reached, so this is a brief, honest empty state
  // rather than a dead end.
  if (!candidate) {
    return (
      <div className="ob-vp ob-vp--rate">
        <EmptyState
          icon={Gamepad2}
          size="inline"
          body="No games to rate right now — you're all set."
        />
      </div>
    )
  }

  const cardTransition = { duration: reduced ? 0 : 0.18, ease: 'easeInOut' }
  const isSubmitting = submittingId === candidate.id

  return (
    <div className="ob-rate">
      <div className="ob-rate__top">
        <h1 className="ob-vp__title">Five from your past</h1>
        <p className="ob-rate__progress" aria-live="polite">
          {index + 1} of {total}
        </p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={candidate.id}
          className="ob-rate__card"
          initial={{ opacity: 0, y: reduced ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -12 }}
          transition={cardTransition}
        >
          <div className="ob-rate__cover">
            <RateCoverArt game={candidate} />
          </div>
          <p className="ob-rate__title">{candidate.title}</p>
          <p className="ob-rate__meta">
            {[candidate.year, candidate.developer].filter(Boolean).join(' · ')}
          </p>

          <StarRatingInput
            value={pendingValue}
            onChange={(value) => {
              setPendingValue(value)
              onRateStar(candidate, value)
            }}
            size="xl"
            readOnly={isSubmitting}
            aria-label={`Rate ${candidate.title} out of 5`}
          />

          <div className="ob-rate__actions">
            <button
              type="button"
              className="ob-rate__action-btn"
              onClick={() => onNeverPlayed(candidate)}
              disabled={isSubmitting}
            >
              <Ban size={14} strokeWidth={2} aria-hidden="true" />
              Never played
            </button>
            <button
              type="button"
              className="ob-rate__action-btn"
              onClick={onSkipCard}
              disabled={isSubmitting}
            >
              Skip
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/**
 * Cover art for a rate-from-memory card. Same real-cover-with-fallback
 * treatment as PickerCoverArt, sized for the ~96x130 slot from the spec.
 */
function RateCoverArt({ game }) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : getBestImageUrl(game, 28)

  if (!url) {
    return (
      <span
        className="ob-rate__cover-fallback"
        style={{ '--ob-tile-color': tileColorVar(game.id) }}
      >
        <span className="ob-cover-scrim" aria-hidden="true" />
        <span className="ob-cover-title">{game.title}</span>
      </span>
    )
  }

  return (
    <img
      src={url}
      alt=""
      className="ob-cover-img"
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
