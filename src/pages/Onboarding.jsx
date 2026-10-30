import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import { useAuth } from '../contexts/AuthContext'
import { updateProfile } from '../services/profileService'
import { updateUserProfile } from '../services/userService'
import { completeOnboarding } from '../services/onboardingService'
import { setOnboarded } from '../services/userPreferences'
import { getGameStatus, setGameStatus } from '../services/libraryService'
import { showToast } from '../components/Toast'
import ThemeStep from '../components/onboarding/ThemeStep'
import PlatformStep from '../components/onboarding/PlatformStep'
import FavoritesStep from '../components/onboarding/FavoritesStep'
import PlayingStep from '../components/onboarding/PlayingStep'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { hapticImpact } from '../utils/haptics'
import { MOTION, EASE } from '../motion/xMotion'
import './Onboarding.css'

/**
 * The flow, in order. One list drives the dots, the announcer, the slides and
 * the "last step" rule (Skip and Continue both call finish() on the last one),
 * so a new step is one more id here plus one more case in the slide switch.
 */
const STEPS = ['theme', 'platforms', 'favorites', 'playing']

const STEP_TITLES = {
  theme: 'Make it yours',
  platforms: 'Where do you play?',
  favorites: 'Your 4 favorites',
  playing: 'What are you playing right now?',
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

  // Step 3 — four favorites. Step 4 — the one game they're playing.
  // Search lives inside each step. Continue, in the frame, is what saves.
  const [selectedGames, setSelectedGames] = useState([])
  const [playingGame, setPlayingGame] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const announceRef = useRef(null)

  // What was really written, for the closing toast. A ref, not state: finish()
  // can run in the same tick as the save that sets it, and must see it. The
  // theme is not counted; it is a setting, not something added to the profile.
  const savedRef = useRef({
    platforms: false,
    gamingSince: false,
    favorites: 0,
    playing: false,
  })

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
      if (saved.playing) parts.push('now playing')
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

  // Favorites Continue — the same write as before (localStorage +
  // users.favorite_games, never a tracker status). Nothing picked means
  // nothing written. Then on to "what are you playing", not the end.
  const handleFavoritesContinue = useCallback(async () => {
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
    advance()
  }, [submitting, selectedGames, user, advance])

  // Playing Continue — one game, Currently Playing. Already there means
  // do nothing. Nothing picked means nothing written. This is the last step.
  const handlePlayingContinue = useCallback(() => {
    if (submitting || finishedRef.current) return
    if (playingGame && getGameStatus(playingGame.id) !== 'currently') {
      try {
        const ok = setGameStatus(playingGame.id, 'currently', playingGame)
        if (ok) savedRef.current.playing = true
        else console.error('[Onboarding] playing save failed')
      } catch (err) {
        console.error('[Onboarding] playing save failed:', err)
      }
    }
    advance()
  }, [submitting, playingGame, advance])

  const handleContinue = useCallback(() => {
    if (stepId === 'platforms') handlePlatformsContinue()
    else if (stepId === 'favorites') handleFavoritesContinue()
    else if (stepId === 'playing') handlePlayingContinue()
    else advance()
  }, [stepId, handlePlatformsContinue, handleFavoritesContinue, handlePlayingContinue, advance])

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

  return (
    // kb-viewport-fit: the page is a fixed shell (header / scroll region /
    // Continue) that sizes to the space the keyboard leaves, so the foot
    // stays above it. See src/styles/keyboard.css.
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
              {stepId === 'favorites' && (
                <FavoritesStep games={selectedGames} onChange={setSelectedGames} />
              )}
              {stepId === 'playing' && (
                <PlayingStep game={playingGame} onChange={setPlayingGame} />
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
        </AnimatePresence>
      </div>
    </div>
  )
}

