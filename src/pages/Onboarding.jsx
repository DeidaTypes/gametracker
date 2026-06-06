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
  PenLine,
  List,
  Users,
  Search,
  X,
  Check,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { searchGames } from '../services/igdb'
import {
  setGameStatus,
  initializeLibrary,
} from '../services/libraryService'
import { updateProfile } from '../services/profileService'
import { completeOnboarding } from '../services/onboardingService'
import { setOnboarded } from '../services/userPreferences'
import { showToast } from '../components/Toast'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './Onboarding.css'

/** Four value-prop screens (indices 0-3). */
const VALUE_PROP_SCREENS = [
  {
    Icon: PlayCircle,
    title: 'Track what you play',
    body: "Log the games you've finished, are playing, or want to try.",
    cta: 'Next',
  },
  {
    Icon: PenLine,
    title: 'Share your thoughts',
    body: 'Rate games, write reviews, and see what others think before you dive in.',
    cta: 'Next',
  },
  {
    Icon: List,
    title: 'Build your backlog',
    body: 'Create lists for cozy games, multiplayer nights, anything you can think of.',
    cta: 'Next',
  },
  {
    Icon: Users,
    title: 'Find your people',
    body: "Follow friends and discover what they're playing. Game taste is the new music taste.",
    cta: 'Get started',
  },
]

// Step 4 is the game-picker action screen.
const PICKER_STEP = 4

export default function Onboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { reduced } = useMotionPreference()

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  // Screen 5 — game picker
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
        ? VALUE_PROP_SCREENS[step].title
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
          for (const game of seedGames) {
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
            'Welcome to GameTracker. Tap any game to leave a review.',
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

  // Done is enabled when the user has picked 3+ games OR none at all
  // (picking 0 acts as a "Done = skip" pathway).
  const canDone = selectedGames.length === 0 || selectedGames.length >= 3
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
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className={
                'ob-dot' +
                (i === Math.min(step, 3) ? ' ob-dot--active' : '') +
                (i < step ? ' ob-dot--done' : '')
              }
            />
          ))}
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
                canDone={canDone}
                remaining={remaining}
                onSkip={handleSkip}
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

// ── Value-prop slide (screens 1-4) ──────────────────────────────────────

function ValuePropSlide({ screen, onNext }) {
  const { Icon, title, body, cta } = screen
  return (
    <div className="ob-vp">
      <div className="ob-vp__icon" aria-hidden="true">
        <Icon size={64} strokeWidth={1.5} />
      </div>
      <h1 className="ob-vp__title">{title}</h1>
      <p className="ob-vp__body">{body}</p>
      <div className="ob-cta-wrap">
        <button
          type="button"
          className="ob-cta-btn"
          onClick={onNext}
        >
          {cta}
        </button>
      </div>
    </div>
  )
}

// ── Game-picker slide (screen 5) ────────────────────────────────────────

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
  canDone,
  remaining,
  onSkip,
  onDone,
  submitting,
}) {
  const clearQuery = useCallback(() => {
    onQueryChange({ target: { value: '' } })
    inputRef.current?.focus()
  }, [onQueryChange, inputRef])

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

        {/* Selected games strip */}
        {selectedGames.length > 0 && (
          <div
            className="ob-selected-strip"
            role="list"
            aria-label="Selected games"
          >
            {selectedGames.map((g) => (
              <div
                key={g.id}
                className="ob-selected-item"
                role="listitem"
              >
                <div className="ob-selected-cover">
                  {g.image ? (
                    <img src={g.image} alt="" loading="lazy" />
                  ) : (
                    <span className="ob-selected-cover__fallback">
                      {g.title?.charAt(0) || '?'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="ob-selected-remove"
                    onClick={() => removeSelected(g.id)}
                    aria-label={`${g.title}, selected, tap to remove`}
                  >
                    <X size={9} strokeWidth={3} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
          <p className="ob-picker__state" aria-live="polite">
            No games found for &ldquo;{query}&rdquo;
          </p>
        )}

        {!query.trim() && !loading && (
          <p className="ob-picker__hint">
            Search above to find your favorites.
          </p>
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
                    className={
                      'ob-grid__tile' + (picked ? ' ob-grid__tile--picked' : '')
                    }
                    onClick={() => toggleGame(game)}
                  >
                    <div className="ob-grid__cover">
                      {game.image ? (
                        <img src={game.image} alt="" loading="lazy" />
                      ) : (
                        <span className="ob-grid__cover-fallback">
                          {game.title?.charAt(0) || '?'}
                        </span>
                      )}
                      {picked && (
                        <span
                          className="ob-grid__check"
                          aria-hidden="true"
                        >
                          <Check size={13} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                    <span className="ob-grid__title">{game.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Bottom: count hint + Skip / Done */}
      <div className="ob-picker__bottom">
        {selectedGames.length > 0 && remaining > 0 && (
          <p className="ob-picker__count-hint" aria-live="polite">
            {remaining} more to go
          </p>
        )}
        {selectedGames.length >= 3 && (
          <p className="ob-picker__count-hint ob-picker__count-hint--ready" aria-live="polite">
            {selectedGames.length} selected — ready!
          </p>
        )}
        <div className="ob-picker__actions">
          <button
            type="button"
            className="ob-picker__btn ob-picker__btn--ghost"
            onClick={onSkip}
            disabled={submitting}
            aria-label="Skip onboarding"
          >
            Skip
          </button>
          <button
            type="button"
            className={
              'ob-picker__btn ob-picker__btn--primary' +
              (!canDone ? ' ob-picker__btn--disabled' : '')
            }
            onClick={canDone ? onDone : undefined}
            disabled={!canDone || submitting}
            aria-disabled={!canDone}
          >
            {submitting ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
