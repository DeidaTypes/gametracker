import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import { Search, X, Plus, Check, SearchX } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { searchGames } from '../services/searchService'
import { getBestImageUrl } from '../services/imageUtils'
import { updateProfile } from '../services/profileService'
import { updateUserProfile } from '../services/userService'
import { completeOnboarding } from '../services/onboardingService'
import { setOnboarded } from '../services/userPreferences'
import { showToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import ThemeStep from '../components/onboarding/ThemeStep'
import PlatformStep from '../components/onboarding/PlatformStep'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useKeyboardOpen } from '../hooks/useKeyboardInset'
import { hapticImpact } from '../utils/haptics'
import { MOTION, EASE } from '../motion/xMotion'
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
 * The flow, in order. One list drives the dots, the announcer, the slides and
 * the "last step" rule (Skip and Continue both call finish() on the last one),
 * so a new step is one more id here plus one more case in the slide switch.
 */
const STEPS = ['theme', 'platforms', 'favorites']

const STEP_TITLES = {
  theme: 'Make it yours',
  platforms: 'Where do you play?',
  favorites: 'Add 4 favorite games',
}

// The profile shows four favorites; the picker offers exactly four.
const FAVORITES_MAX = 4

// A step slides this far (and fades) as it arrives and leaves.
const STEP_SHIFT_PX = 24
const REST = 'translate3d(0px, 0, 0)'

/** Joins ['a', 'b', 'c'] as "a, b and c" for the welcome toast. */
function joinList(parts) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * One step's slide. Its own component so it can ask AnimatePresence whether
 * it is the leaving step: a leaving step must not catch a tap meant for the
 * step arriving on top of it.
 */
function StepSlide({ variants, className, children }) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { reduced } = useMotionPreference()

  const [step, setStep] = useState(0)
  const stepId = STEPS[step]
  const isLastStep = step === STEPS.length - 1

  // Step 2 — platforms + since when. Held here (not in the step) because
  // Continue, which lives in the frame, is what saves them.
  const [platforms, setPlatforms] = useState([])
  const [gamingSince, setGamingSince] = useState(null)

  // Step 3 — game picker
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selectedGames, setSelectedGames] = useState([])
  const [submitting, setSubmitting] = useState(false)

  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const announceRef = useRef(null)

  // What was really written, for the closing toast. A ref, not state: finish()
  // can run in the same tick as the save that sets it, and must see it. The
  // theme is not counted; it is a setting, not something added to the profile.
  const savedRef = useRef({ platforms: false, gamingSince: false, favorites: 0 })

  // Announce current screen title to screen readers whenever step changes.
  useEffect(() => {
    const title = STEP_TITLES[stepId]
    if (announceRef.current) {
      // Clear first so repeated-same-step announcements still fire.
      announceRef.current.textContent = ''
      // Defer so the DOM diff settles before the live region fires.
      requestAnimationFrame(() => {
        if (announceRef.current) announceRef.current.textContent = title
      })
    }
  }, [stepId])

  // ── Shared "finish onboarding" logic — the ONLY place that marks
  // onboarding complete and navigates home. It runs once, at the true end of
  // the flow: Continue/Done or Skip on the last step. ───────────────────
  // A ref latch, not `submitting`: it is set synchronously before any await
  // and never reset, so completeOnboarding / navigate / the toast happen
  // exactly once even if finish() is called again while this page is still
  // mounted for its exit transition.
  const finishedRef = useRef(false)
  const finish = useCallback(async () => {
    if (finishedRef.current) return
    finishedRef.current = true
    setSubmitting(true)
    try {
      // Mark onboarded — localStorage first (instant, guards re-fire
      // before the Supabase write returns) then Supabase.
      setOnboarded(true)
      if (user?.id) {
        await completeOnboarding(user.id)
      }

      navigate('/', { replace: true })

      const saved = savedRef.current
      const parts = []
      if (saved.platforms) parts.push('platforms')
      if (saved.gamingSince) parts.push('gaming start')
      if (saved.favorites > 0) parts.push('favorites')
      if (parts.length > 0) {
        showToast('Welcome to Checkpoint', 'success', 5000, null, null, {
          sub: `Saved your ${joinList(parts)}`,
          tone: 'saved',
        })
      }
    } catch (err) {
      console.error('[Onboarding] finish failed:', err)
      // Always navigate even if writes partially fail.
      navigate('/', { replace: true })
    }
    // `submitting` stays true: the page is leaving, nothing re-enables.
  }, [user, navigate])

  // Skip and Continue both land here: on to the next step, or finish() on the
  // last one. A tap that arrives while the previous step is still sliding out
  // is dropped, so a double-tap cannot skip a step the user never saw.
  const lastAdvanceRef = useRef(0)
  const advance = useCallback(() => {
    if (finishedRef.current) return
    const now = Date.now()
    if (now - lastAdvanceRef.current < MOTION.slide) return
    lastAdvanceRef.current = now
    if (step >= STEPS.length - 1) {
      finish()
    } else {
      setStep(step + 1)
    }
  }, [step, finish])

  // Skip never saves the step it leaves.
  const handleSkip = advance

  // Step 2 Continue — saves platforms + gaming_since through the same
  // updateUserProfile every profile write uses. Nothing picked means nothing
  // to write. A failed save logs and still advances: it must not trap the user.
  const handlePlatformsContinue = useCallback(async () => {
    if (submitting) return
    if (user?.id && (platforms.length > 0 || gamingSince != null)) {
      setSubmitting(true)
      try {
        await updateUserProfile(user.id, { platforms, gamingSince })
        savedRef.current.platforms = platforms.length > 0
        savedRef.current.gamingSince = gamingSince != null
      } catch (err) {
        console.error('[Onboarding] platforms sync failed:', err)
      } finally {
        setSubmitting(false)
      }
    }
    advance()
  }, [submitting, user, platforms, gamingSince, advance])

  const handleContinue = useCallback(() => {
    if (stepId === 'platforms') handlePlatformsContinue()
    else advance()
  }, [stepId, handlePlatformsContinue, advance])

  const togglePlatform = useCallback((id) => {
    hapticImpact('Light')
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }, [])

  // Tapping the chosen decade again clears it; any other decade becomes "since".
  const pickGamingSince = useCallback((year) => {
    hapticImpact('Light')
    setGamingSince((prev) => (prev === year ? null : year))
  }, [])

  // Favorites "Done" — saves favorites (exactly the same write as before:
  // localStorage + users.favorite_games, never a tracker status) then
  // finishes onboarding, because this is the last step.
  const handleFavoritesDone = useCallback(async () => {
    if (submitting || finishedRef.current) return
    if (selectedGames.length > 0) {
      setSubmitting(true)
      try {
        const favorites = selectedGames.slice(0, FAVORITES_MAX)
        updateProfile({ favoriteGames: favorites })
        savedRef.current.favorites = favorites.length
        if (user?.id) {
          try {
            await updateUserProfile(user.id, { favoriteGames: favorites })
          } catch (err) {
            // Favorites are already saved locally; a failed sync must not
            // trap the user on onboarding.
            console.error('[Onboarding] favorites sync failed:', err)
          }
        }
      } finally {
        setSubmitting(false)
      }
    }
    finish()
  }, [submitting, selectedGames, user, finish])

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
      hapticImpact('Light')
      if (isPicked(game.id)) {
        setSelectedGames((prev) =>
          prev.filter((g) => String(g.id) !== String(game.id))
        )
      } else {
        // Four slots on the profile: a fifth tap is ignored, not queued.
        setSelectedGames((prev) =>
          prev.length >= FAVORITES_MAX
            ? prev
            : [
                ...prev,
                {
                  id: game.id,
                  title: game.title || '',
                  image: game.image || null,
                  developer: game.developer || '',
                },
              ]
        )
      }
    },
    [isPicked]
  )

  const removeSelected = useCallback((id) => {
    hapticImpact('Light')
    setSelectedGames((prev) =>
      prev.filter((g) => String(g.id) !== String(id))
    )
  }, [])

  // ── Step transition ───────────────────────────────────────────────
  // Arrives 24px from the right and fades in; leaves 24px to the left and
  // fades out. Fade 260, move 340, both on the locked ease tokens. Reduce
  // Motion: a 150 fade, nothing travels.
  const stepVariants = useMemo(() => {
    const shift = reduced ? 0 : STEP_SHIFT_PX
    const transition = reduced
      ? { opacity: { duration: MOTION.reducedFade / 1000, ease: EASE.fade } }
      : {
          opacity: { duration: MOTION.popIn / 1000, ease: EASE.fade },
          transform: { duration: MOTION.slide / 1000, ease: EASE.move },
        }
    return {
      enter: { opacity: 0, transform: `translate3d(${shift}px, 0, 0)` },
      center: { opacity: 1, transform: REST, transition },
      exit: { opacity: 0, transform: `translate3d(${-shift}px, 0, 0)`, transition },
    }
  }, [reduced])

  const remaining = Math.max(0, FAVORITES_MAX - selectedGames.length)

  return (
    // kb-viewport-fit: this page is a fixed shell (header / scroll region /
    // action bar) whose results list is the only scroller on the picker step,
    // so it sizes to the space the keyboard leaves rather than extending
    // underneath it. See src/styles/keyboard.css.
    <div className="ob-page kb-viewport-fit" role="main">
      {/* Screen-reader live region — announces each screen's title on mount */}
      <span
        ref={announceRef}
        className="ob-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />

      {/* ── Header: one dot per step + Skip ── */}
      <div className="ob-header">
        <div className="ob-dots" aria-hidden="true">
          {STEPS.map((id, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'inactive'
            return <span key={id} className={`ob-dot ob-dot--${state}`} />
          })}
        </div>
        <button
          type="button"
          className="ob-skip"
          onClick={handleSkip}
          aria-label={isLastStep ? 'Skip and finish' : 'Skip this step'}
          disabled={submitting}
        >
          Skip
        </button>
      </div>

      {/* ── Animated step area ── */}
      <div className="ob-slide-wrap" aria-live="off">
        <AnimatePresence mode="sync" initial={false}>
          {stepId === 'favorites' ? (
            <StepSlide
              key="favorites"
              className="ob-slide ob-slide--picker"
              variants={stepVariants}
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
            </StepSlide>
          ) : (
            <StepSlide key={stepId} className="ob-slide" variants={stepVariants}>
              <div className="ob-scroll">
                {stepId === 'theme' && <ThemeStep reduced={reduced} />}
                {stepId === 'platforms' && (
                  <PlatformStep
                    platforms={platforms}
                    onTogglePlatform={togglePlatform}
                    gamingSince={gamingSince}
                    onPickGamingSince={pickGamingSince}
                  />
                )}
              </div>
              <div className="ob-foot">
                <button
                  type="button"
                  className="ob-cta-btn"
                  onClick={handleContinue}
                  disabled={submitting}
                >
                  Continue
                </button>
              </div>
            </StepSlide>
          )}
        </AnimatePresence>
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
      ? 'Your 4 picks'
      : pickedCount >= FAVORITES_MAX
        ? 'Your 4 picks — ready!'
        : `Your 4 picks — ${remaining} more to go`

  // The picks area has two layouts, never both at once (a results list
  // layered over the picks grid reads as a rendering glitch). Typing swaps
  // the four full-size slots for one compact strip; clearing the field
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
    <div className="ob-picker" aria-label="Add 4 favorite games">
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
              <h1 className="ob-vp__title">Add 4 favorite games</h1>
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
            Idle: four full-size slots, empty (dashed "+" placeholder) or
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
                  <strong>{pickedCount}</strong> of 4 selected
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
                  aria-label="Your 4 picks"
                >
                  {Array.from({ length: FAVORITES_MAX }, (_, i) => i).map((slotIndex) => {
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
          {pickedCount} of 4 selected
        </p>
        <button
          type="button"
          className="ob-cta-btn"
          onClick={onDone}
          disabled={submitting}
        >
          {submitting ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>
  )
}
