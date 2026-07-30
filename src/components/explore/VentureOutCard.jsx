import React, { useEffect, useRef, useState } from 'react'
import { Compass, RefreshCw, Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { showToast } from '../Toast'
import Pressable from '../Pressable'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { getVentureOutPool } from '../../services/gamingMapService'
import { getAllLists, setGameStatus } from '../../services/libraryService'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { genreColorVar } from '../../utils/genreColors'
import { genreDisplayName, playerLabelFor } from '../../utils/gamingMapFormat'
import { getQuoteSequence } from '../../utils/gameQuotes'
import './VentureOutCard.css'

const PICK_COUNT = 2
const REVEAL_DELAY_MS = 2200
const REVEAL_DELAY_MS_REDUCED = 150
const QUOTE_ROTATE_MS = 900

/** Every game id already tracked anywhere in the user's local library. */
function ownedOrBacklogged() {
  const ids = new Set()
  try {
    const lists = getAllLists()
    for (const list of Object.values(lists || {})) {
      for (const g of list?.games || []) {
        if (g?.id != null) ids.add(String(g.id))
      }
    }
  } catch { /* best-effort */ }
  return ids
}

function pickSubtitle(game) {
  const theme = game?.matchedThemes?.[0]
  return theme ? `${theme} · easy on-ramp` : 'Easy on-ramp'
}

function makeSlot(status, game = null, quote = null) {
  return { status, game, quote }
}

/**
 * Venture Out — generative, backlog-only picks for ONE uncharted genre.
 *
 * Reads only G2's cache (getVentureOutPool); never calls IGDB. The only
 * action per pick is "add to backlog" — there is nothing else honest to
 * offer for a game the user hasn't played (no rate, no claim, no progress).
 *
 * Backlogging (or manually refreshing) a pick animates that slot out and
 * pulls the next not-yet-shown pool item into the same slot, running it
 * through a spinner + rotating-quote loading beat first so the swap reads
 * as "finding your next pick" rather than an instant swap. The pool itself
 * never repeats a game already shown this session or already owned/
 * backlogged; once it's truly exhausted the slot says so honestly instead
 * of repeating or going blank — widening the pool further is G2's job
 * (the nightly rebuild), not something this component fakes client-side.
 *
 * Advancing to the NEXT uncharted genre happens for free: the parent
 * (GamingMapSection) keys this component on the target genre's id, so a
 * tier change from G2's real-time logic (the user actually played a game
 * in this genre) fully remounts it onto whatever genre is now first in
 * the "haven't explored" tier.
 */
export default function VentureOutCard({ genre, homeTurfGenre }) {
  const { reduced } = useMotionPreference()
  const [phase, setPhase] = useState('loading') // 'loading' | 'no_pool' | 'ready'
  const [slots, setSlots] = useState(() => Array.from({ length: PICK_COUNT }, () => makeSlot('loading')))

  const poolQueueRef = useRef([])
  const shownIdsRef = useRef(new Set())
  const timersRef = useRef({})

  const displayName = genreDisplayName(genre.name)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const rows = await getVentureOutPool(genre.id, { limit: 40 })
      if (cancelled) return

      const excluded = ownedOrBacklogged()
      const filtered = rows.filter((g) => !excluded.has(String(g.id)))

      if (rows.length === 0) {
        setPhase('no_pool')
        return
      }

      poolQueueRef.current = filtered
      setPhase('ready')

      // Slot 0 resolves immediately; slot 1 runs through the loading beat
      // so the reveal doesn't feel like two static rows appearing at once.
      const first = poolQueueRef.current.shift()
      if (first) shownIdsRef.current.add(String(first.id))
      setSlots([
        makeSlot(first ? 'ready' : 'empty', first || null),
        makeSlot('loading'),
      ])
      if (PICK_COUNT > 1) startLoadingSlot(1)
    }

    init().catch((err) => {
      console.error('[VentureOutCard] init failed:', err)
      if (!cancelled) setPhase('no_pool')
    })

    return () => {
      cancelled = true
      for (const t of Object.values(timersRef.current)) {
        if (t?.intervalId) clearInterval(t.intervalId)
        if (t?.timeoutId) clearTimeout(t.timeoutId)
      }
      timersRef.current = {}
    }
    // Intentionally re-runs only when the targeted genre id changes — the
    // parent remounts this component (via `key`) on every genre swap, so
    // this effect's own cleanup already tears down prior timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre.id])

  function updateSlot(index, patch) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function startLoadingSlot(index) {
    const quotes = getQuoteSequence(5)
    let qIdx = 0
    updateSlot(index, { status: 'loading', game: null, quote: quotes[0] })

    let intervalId = null
    if (!reduced) {
      intervalId = setInterval(() => {
        qIdx = (qIdx + 1) % quotes.length
        updateSlot(index, { quote: quotes[qIdx] })
      }, QUOTE_ROTATE_MS)
    }

    const timeoutId = setTimeout(() => {
      if (intervalId) clearInterval(intervalId)
      resolveSlot(index)
    }, reduced ? REVEAL_DELAY_MS_REDUCED : REVEAL_DELAY_MS)

    timersRef.current[index] = { intervalId, timeoutId }
  }

  function resolveSlot(index) {
    const next = poolQueueRef.current.shift()
    if (next) {
      shownIdsRef.current.add(String(next.id))
      updateSlot(index, { status: 'ready', game: next, quote: null })
    } else {
      updateSlot(index, { status: 'empty', game: null, quote: null })
    }
  }

  function handleAdd(index, game) {
    const gameShape = {
      id: String(game.id),
      title: game.title,
      image: game.image || null,
      year: game.year ?? null,
      genre: displayName,
      rating: game.totalRating != null ? Math.round((game.totalRating / 20) * 10) / 10 : null,
    }
    setGameStatus(gameShape.id, 'want', gameShape)
    showToast(`Added "${game.title}" to Backlog`, 'success', 2500)
    startLoadingSlot(index)
  }

  function handleManualRefresh() {
    slots.forEach((slot, i) => {
      if (slot.status === 'ready') startLoadingSlot(i)
    })
  }

  const anyLoading = slots.some((s) => s.status === 'loading')
  const homeTurfLabel = homeTurfGenre ? playerLabelFor(homeTurfGenre.name) : null
  const bodyText = homeTurfLabel
    ? `Fresh picks for ${homeTurfLabel}. Backlog one and a new one takes its place.`
    : "Fresh picks from a genre you haven't explored yet. Backlog one and a new one takes its place."

  const slotTransition = reduced ? { duration: 0 } : { duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }

  return (
    <div className="venture-out-card">
      <div className="venture-out-card__head">
        <span className="venture-out-card__label">
          <Compass size={16} aria-hidden="true" />
          Venture out · {displayName}
        </span>
        <button
          type="button"
          className="venture-out-card__refresh"
          onClick={handleManualRefresh}
          disabled={phase !== 'ready' || anyLoading}
          aria-label="Refresh Venture Out picks"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      {phase === 'no_pool' && (
        <>
          <p className="venture-out-card__body">
            Building your {displayName} picks — check back soon.
          </p>
          <div className="venture-out-card__skel-row" aria-hidden="true">
            <span className="venture-out-card__skel-cover skeleton" />
            <span className="venture-out-card__skel-lines">
              <span className="venture-out-card__skel-line venture-out-card__skel-line--title skeleton" />
              <span className="venture-out-card__skel-line venture-out-card__skel-line--meta skeleton" />
            </span>
          </div>
        </>
      )}

      {phase === 'loading' && (
        <div className="venture-out-card__skel-row" aria-hidden="true">
          <span className="venture-out-card__skel-cover skeleton" />
          <span className="venture-out-card__skel-lines">
            <span className="venture-out-card__skel-line venture-out-card__skel-line--title skeleton" />
            <span className="venture-out-card__skel-line venture-out-card__skel-line--meta skeleton" />
          </span>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <p className="venture-out-card__body">{bodyText}</p>

          <div className="venture-out-card__slots">
            {slots.map((slot, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className="venture-out-card__divider" aria-hidden="true" />}
                <AnimatePresence mode="wait" initial={false}>
                  {slot.status === 'ready' && slot.game && (
                    <motion.div
                      key={`ready-${slot.game.id}`}
                      className="venture-out-card__pick"
                      initial={reduced ? false : { opacity: 0, x: 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -14 }}
                      transition={slotTransition}
                    >
                      <span className="venture-out-card__pick-cover">
                        {slot.game.image ? (
                          <img
                            src={slot.game.image}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.target.src = COVER_FALLBACK }}
                          />
                        ) : (
                          <span
                            className="venture-out-card__pick-swatch"
                            style={{ background: genreColorVar(genre.name) }}
                          />
                        )}
                      </span>
                      <span className="venture-out-card__pick-body">
                        <span className="venture-out-card__pick-title">{slot.game.title}</span>
                        <span className="venture-out-card__pick-sub">{pickSubtitle(slot.game)}</span>
                      </span>
                      <Pressable
                        as="button"
                        className="venture-out-card__add"
                        onClick={() => handleAdd(i, slot.game)}
                        aria-label={`Add ${slot.game.title} to backlog`}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </Pressable>
                    </motion.div>
                  )}

                  {slot.status === 'loading' && (
                    <motion.div
                      key={`loading-${i}`}
                      className="venture-out-card__loading"
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0 }}
                      transition={slotTransition}
                      role="status"
                    >
                      <span
                        className={`venture-out-card__spinner${reduced ? ' venture-out-card__spinner--static' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="venture-out-card__quote">&ldquo;{slot.quote}&rdquo;</span>
                      <span className="venture-out-card__quote-caption">finding your next frontier…</span>
                    </motion.div>
                  )}

                  {slot.status === 'empty' && (
                    <motion.div
                      key={`empty-${i}`}
                      className="venture-out-card__empty-slot"
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={slotTransition}
                    >
                      No more fresh {displayName} picks right now — check back after your next sync.
                    </motion.div>
                  )}
                </AnimatePresence>
              </React.Fragment>
            ))}
          </div>

          <p className="venture-out-card__footer">
            When you actually play one, {displayName} joins your map.
          </p>
        </>
      )}
    </div>
  )
}
