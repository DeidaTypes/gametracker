import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Gamepad2, Plus, X } from 'lucide-react'
import { searchGames } from '../../services/searchService'
import { getBestImageUrl } from '../../services/imageUtils'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useKeyboardOpen } from '../../hooks/useKeyboardInset'
import { hapticImpact } from '../../utils/haptics'
import { MOTION, EASE } from '../../motion/xMotion'
import SearchField from '../SearchField'
import './FavoritesStep.css'

const FAVORITES_MAX = 4
const SEARCH_DEBOUNCE_MS = 300

/**
 * The same search the old picker made: searchGames(term, 20), 300ms after
 * the last keystroke. Shared by the favorites step and the now-playing step.
 * A newer keystroke (or a clear) bumps the request id so a late response
 * cannot refill a field the user already emptied.
 */
export function useOnboardingGameSearch() {
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const reqRef = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    reqRef.current += 1
  }, [])

  const onQueryChange = useCallback((val) => {
    setQuery(val)
    clearTimeout(debounceRef.current)
    const trimmed = val.trim()
    if (!trimmed) {
      reqRef.current += 1
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const req = ++reqRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const games = await searchGames(trimmed, 20)
        if (req !== reqRef.current) return
        setResults(Array.isArray(games) ? games : [])
      } catch (err) {
        if (req !== reqRef.current) return
        console.error('[Onboarding] search failed:', err)
        setError('Search failed — please try again.')
        setResults([])
      } finally {
        if (req === reqRef.current) setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)
  }, [])

  return { query, onQueryChange, results, loading, error, inputRef }
}

/** Slim row the favorites write already stores: id, title, image, developer. */
export function slimPick(game) {
  return {
    id: game.id,
    title: game.title || '',
    image: game.image || null,
    developer: game.developer || '',
  }
}

export function sameGameId(a, b) {
  return a != null && b != null && String(a) === String(b)
}

function yearText(game) {
  const year = Number(game?.year)
  return Number.isFinite(year) && year > 0 ? String(year) : ''
}

export function ObCover({ game, className, px = 240 }) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : getBestImageUrl(game, px)
  if (!url) {
    return (
      <span className={`${className} is-fallback`} aria-hidden="true">
        <Gamepad2 size={16} strokeWidth={1.8} />
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Step 3. Search on top, four equal slots underneath. A result drops into
 * the next empty slot, the field clears, and the cursor stays put.
 */
export default function FavoritesStep({ games, onChange }) {
  const { reduced } = useMotionPreference()
  const keyboardOpen = useKeyboardOpen()
  const { query, onQueryChange, results, loading, error, inputRef } = useOnboardingGameSearch()
  const fromPointer = useRef(false)
  const gamesRef = useRef(games)
  gamesRef.current = games
  const trimmed = query.trim()
  const full = games.length >= FAVORITES_MAX

  const note =
    games.length === 0
      ? 'Pick up to 4'
      : games.length >= FAVORITES_MAX
        ? 'All 4 picked'
        : `${games.length} of 4 picked`

  const pick = (game) => {
    const current = gamesRef.current
    if (
      current.length >= FAVORITES_MAX ||
      current.some((g) => sameGameId(g.id, game.id))
    ) {
      return
    }
    hapticImpact('Light')
    const next = [...current, slimPick(game)]
    gamesRef.current = next
    onChange(next)
    onQueryChange('')
    const el = inputRef.current
    el?.focus({ preventScroll: true })
    queueMicrotask(() => el?.focus({ preventScroll: true }))
  }

  const onResultPointerDown = (event, game) => {
    if (event.currentTarget.disabled) return
    event.preventDefault()
    fromPointer.current = true
    window.setTimeout(() => {
      fromPointer.current = false
    }, 500)
    pick(game)
  }

  const onResultClick = (game) => {
    if (fromPointer.current) return
    pick(game)
  }

  const remove = (id) => {
    hapticImpact('Light')
    const next = gamesRef.current.filter((g) => !sameGameId(g.id, id))
    gamesRef.current = next
    onChange(next)
  }

  const pop = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: MOTION.reducedFade / 1000, ease: EASE.fade },
      }
    : {
        initial: { scale: 0.9 },
        animate: { scale: 1 },
        transition: { duration: MOTION.popIn / 1000, ease: EASE.move },
      }

  return (
    <div className="ob-fav">
      {!keyboardOpen && (
        <>
          <h1 className="ob-title text-display-l">Your 4 favorites</h1>
          <p className="ob-sub text-body">
            The ones you&rsquo;d defend forever. They sit at the top of your profile.
          </p>
        </>
      )}

      <SearchField
        onboarding
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onClear={() => onQueryChange('')}
      >
        {trimmed && loading && (
          <div className="sfield__empty" role="status">Searching…</div>
        )}
        {trimmed && !loading && error && (
          <div className="sfield__empty" role="alert">{error}</div>
        )}
        {trimmed && !loading && !error && results.length === 0 && (
          <div className="sfield__empty" role="status">
            No games named ‘{trimmed}’
          </div>
        )}
        {trimmed && !loading && !error && results.map((game) => {
          const taken = games.some((g) => sameGameId(g.id, game.id))
          const disabled = full || taken
          const sub = taken
            ? 'Already in your 4'
            : full
              ? 'Remove one to swap'
              : yearText(game)
          return (
            <button
              key={game.id}
              type="button"
              className="sfield__row"
              role="option"
              aria-selected={taken}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => onResultPointerDown(event, game)}
              onClick={() => onResultClick(game)}
            >
              <ObCover game={game} className="sfield__cover" px={92} />
              <span className="sfield__meta">
                <span className="sfield__title">{game.title}</span>
                {sub ? <span className="sfield__sub">{sub}</span> : null}
              </span>
            </button>
          )
        })}
      </SearchField>

      <div className="ob-fav__slots" role="list" aria-label="Your 4 favorites">
        {Array.from({ length: FAVORITES_MAX }, (_, i) => {
          const game = games[i]
          if (!game) {
            return (
              <button
                key={`empty-${i}`}
                type="button"
                className="ob-fav__slot"
                role="listitem"
                aria-label="Add a favorite"
                onClick={() => inputRef.current?.focus({ preventScroll: true })}
              >
                <Plus size={22} strokeWidth={1.8} />
              </button>
            )
          }
          return (
            <motion.button
              key={game.id}
              type="button"
              className="ob-fav__slot ob-fav__slot--on"
              role="listitem"
              aria-label={`Remove ${game.title}`}
              onClick={() => remove(game.id)}
              {...pop}
            >
              <ObCover game={game} className="ob-fav__art" px={240} />
              <span className="ob-fav__rm" aria-hidden="true">
                <X size={11} strokeWidth={3} />
              </span>
            </motion.button>
          )
        })}
      </div>

      <p className="ob-note text-caption" aria-live="polite">{note}</p>
    </div>
  )
}
