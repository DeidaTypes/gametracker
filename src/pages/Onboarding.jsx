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
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { searchGames } from '../services/igdb'
import { getBestImageUrl } from '../services/imageUtils'
import {
  setGameStatus,
  initializeLibrary,
  updateGameProgress,
} from '../services/libraryService'
import { updateProfile } from '../services/profileService'
import { completeOnboarding } from '../services/onboardingService'
import { setOnboarded } from '../services/userPreferences'
import { showToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import { useMotionPreference } from '../hooks/useMotionPreference'
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
const TOTAL_STEPS = 3
// Per-step dot/accent color, in step order — mirrors each screen's accent
// and the picker's content-forward green so the dot trail visually narrates
// cobalt -> journal purple -> review green across the whole flow.
const STEP_ACCENT_VARS = ['var(--accent)', 'var(--accent-journal)', 'var(--accent-review)']

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

  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const announceRef = useRef(null)

  // Announce current screen title to screen readers whenever step changes.
  useEffect(() => {
    const title =
      step < PICKER_STEP
        ? VALUE_PROP_SCREENS[step].announceTitle
        : 'Add 3 favorite games'
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

  // ── Shared "finish onboarding" logic ──────────────────────────────
  const finish = useCallback(
    async (seedGames = []) => {
      if (submitting) return
      setSubmitting(true)
      try {
        // Seed favorites (up to 4) and mark each as "Played" in the
        // local tracker so the library is pre-populated on first open.
        if (seedGames.length > 0) {
          updateProfile({ favoriteGames: seedGames.slice(0, 4) })
          initializeLibrary()
          const seededAt = new Date().toISOString()
          for (const game of seedGames) {
            // Pre-stamp playedFirstAt so setGameStatus's celebration guard
            // sees a non-null value and skips queueCelebration. Without this
            // the three "Played" writes each enqueue a CompletionCelebration,
            // which fires on top of Home and can route the user into the
            // review composer instead of landing on the dashboard.
            updateGameProgress(game.id, { playedFirstAt: seededAt })
            setGameStatus(game.id, 'played', game)
          }
        }

        // Mark onboarded — localStorage first (instant, guards re-fire
        // before the Supabase write returns) then Supabase.
        setOnboarded(true)
        if (user?.id) {
          await completeOnboarding(user.id)
        }

        navigate('/', { replace: true })
        if (seedGames.length > 0) {
          showToast(
            'Welcome to Checkpoint. Tap any game to leave a review.',
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
    },
    [submitting, user, navigate]
  )

  const handleSkip = useCallback(() => finish([]), [finish])

  const handleNext = useCallback(() => {
    if (step < PICKER_STEP) goToStep(step + 1)
  }, [step, goToStep])

  const handleDone = useCallback(() => {
    finish(selectedGames)
  }, [finish, selectedGames])

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
    <div className="ob-page" role="main">
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
          aria-label="Skip onboarding"
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
          ) : (
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
                onDone={handleDone}
                submitting={submitting}
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

  return (
    <div className="ob-picker">
      {/* Top section: title + subtitle + search */}
      <div className="ob-picker__top">
        <h1 className="ob-vp__title">Add 3 favorite games</h1>
        <p className="ob-vp__body">
          Start with what you love — we&rsquo;ll use this to personalize your
          feed.
        </p>

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

        {/* Your 3 picks — always-visible, exactly 3 slots. Empty slots show
            a dashed "+" placeholder; filled slots show the same colorful
            cover treatment as the results grid, with a remove button. */}
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

          {/* Zero-state hint — plain muted text, never boxed like an input
              (there is exactly one search field on this screen, above).
              Hidden as soon as the user types, so it never competes with
              the results list. */}
          {pickedCount === 0 && !query.trim() && (
            <p className="ob-picks__hint">Search above to find your favorites</p>
          )}
        </div>
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
        <p
          className={
            'ob-picker__count-hint' +
            (pickedCount > 0 ? ' ob-picker__count-hint--active' : '')
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
