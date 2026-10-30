import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { getMostPlayedThisWeek, getTrendingThisWeek } from '../../services/communityService'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useKeyboardOpen } from '../../hooks/useKeyboardInset'
import { hapticImpact } from '../../utils/haptics'
import { MOTION, EASE } from '../../motion/xMotion'
import SearchField from '../SearchField'
import {
  ObCover,
  sameGameId,
  slimPick,
  useOnboardingGameSearch,
} from './FavoritesStep'
import './PlayingStep.css'

const POPULAR_COUNT = 6

function yearText(game) {
  const year = Number(game?.year)
  return Number.isFinite(year) && year > 0 ? String(year) : ''
}

/** Trending rows are { game }, most-played rows are flat RPC columns. */
function toPlayable(row) {
  if (!row) return null
  const game = row.game || row
  const id = game.id ?? game.igdb_game_id
  const title = game.title || game.game_title || ''
  const image = game.image || game.game_image || null
  if (id == null || !title || title === 'Unknown Game') return null
  return {
    id,
    title,
    image: image || null,
    developer: game.developer || '',
    year: game.year ?? null,
  }
}

/**
 * Step 4. One game only: a second pick swaps it, tapping the picked one
 * again clears it. Popular covers are real community data; an empty week
 * hides the section.
 */
export default function PlayingStep({ game, onChange }) {
  const { reduced } = useMotionPreference()
  const keyboardOpen = useKeyboardOpen()
  const { query, onQueryChange, results, loading, error, inputRef } = useOnboardingGameSearch()
  const fromPointer = useRef(false)
  const [popular, setPopular] = useState([])
  const trimmed = query.trim()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let rows = await getTrendingThisWeek(POPULAR_COUNT)
      if (!rows?.length) rows = await getMostPlayedThisWeek(POPULAR_COUNT)
      if (cancelled) return
      const seen = new Set()
      const games = []
      for (const row of rows || []) {
        const next = toPlayable(row)
        if (!next) continue
        const key = String(next.id)
        if (seen.has(key)) continue
        seen.add(key)
        games.push(next)
        if (games.length === POPULAR_COUNT) break
      }
      setPopular(games)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const choose = (next, { focus }) => {
    hapticImpact('Light')
    const same = game && sameGameId(game.id, next.id)
    onChange(same ? null : slimPick(next))
    if (focus) {
      onQueryChange('')
      const el = inputRef.current
      el?.focus({ preventScroll: true })
      queueMicrotask(() => el?.focus({ preventScroll: true }))
    } else if (query) {
      onQueryChange('')
    }
  }

  const onResultPointerDown = (event, result) => {
    event.preventDefault()
    fromPointer.current = true
    window.setTimeout(() => {
      fromPointer.current = false
    }, 500)
    choose(result, { focus: true })
  }

  const onResultClick = (result) => {
    if (fromPointer.current) return
    choose(result, { focus: true })
  }

  const fade = {
    duration: (reduced ? MOTION.reducedFade : MOTION.arrive) / 1000,
    ease: EASE.fade,
  }

  return (
    <div className="ob-now">
      {!keyboardOpen && (
        <>
          <h1 className="ob-title text-display-l">What are you playing right now?</h1>
          <p className="ob-sub text-body">
            Just one. It goes on your Home so you can log a session from day one.
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
        {trimmed && !loading && !error && results.map((result) => {
          const picked = game && sameGameId(game.id, result.id)
          const year = yearText(result)
          return (
            <button
              key={result.id}
              type="button"
              className="sfield__row"
              role="option"
              aria-selected={!!picked}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => onResultPointerDown(event, result)}
              onClick={() => onResultClick(result)}
            >
              <ObCover game={result} className="sfield__cover" px={92} />
              <span className="sfield__meta">
                <span className="sfield__title">{result.title}</span>
                {year ? <span className="sfield__sub">{year}</span> : null}
              </span>
            </button>
          )
        })}
      </SearchField>

      {popular.length > 0 && (
        <section aria-label="Popular right now">
          <h2 className="ob-sec text-label">Popular right now</h2>
          <div className="ob-now__grid">
            {popular.map((item) => {
              const picked = game && sameGameId(game.id, item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={'ob-now__cv' + (picked ? ' ob-now__cv--on' : '')}
                  aria-pressed={picked}
                  aria-label={picked ? `${item.title}, selected` : item.title}
                  onClick={() => choose(item, { focus: false })}
                >
                  <span className="ob-now__art">
                    <ObCover game={item} className="ob-now__img" px={240} />
                    {picked && (
                      <span className="ob-now__tick" aria-hidden="true">
                        <span>
                          <Check size={16} strokeWidth={3} />
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="ob-now__name">{item.title}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {game && (
        <motion.div
          key={game.id}
          className="ob-now__home"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fade}
          aria-label={`On your Home: ${game.title}`}
        >
          <ObCover game={game} className="ob-now__home-cover" px={96} />
          <div className="ob-now__home-copy">
            <p className="ob-now__kicker text-label">On your home</p>
            <p className="ob-now__home-title">{game.title}</p>
          </div>
          <span className="ob-now__log">Log a session</span>
        </motion.div>
      )}
    </div>
  )
}
