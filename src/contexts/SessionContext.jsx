// SessionContext — global play-session state shared across the whole app.
//
// One active session at a time. The timer tick always recomputes elapsed
// from `started_at` rather than accumulating deltas so that backgrounding
// the app and returning never desynchronises the counter.
//
// Consumers use the `useSession` hook. GameDetail, HomeFAB, and the
// persistent SessionPill all read from this single source of truth.
//
// The per-second elapsed count lives in its own context (`useSessionElapsed`)
// so that the timer only re-renders the components actually displaying it.
// Putting it on the main context would re-render every consumer — and, since
// this provider wraps the whole app, effectively the entire tree — once a
// second for the length of a session.

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
import { useAuth } from './AuthContext'
import {
  startSession as svcStart,
  stopSession as svcStop,
  getActiveSession,
} from '../services/sessionService'

const SessionContext = createContext(null)
const SessionElapsedContext = createContext(0)

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedFrom(startedAt) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  )
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

/**
 * Owns the ticking second counter, isolated from SessionProvider so that a
 * tick re-renders only this component and its context consumers. `children`
 * arrives as an unchanged element reference, so React skips the subtree.
 */
function SessionElapsedProvider({ startedAt, children }) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? elapsedFrom(startedAt) : 0
  )

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0)
      return undefined
    }

    const tick = () => setElapsed(elapsedFrom(startedAt))
    tick() // immediate first tick

    const id = setInterval(tick, 1000)

    // Recompute from started_at rather than accumulating, so backgrounding
    // the app and returning never desynchronises the counter.
    const onResume = () => setElapsed(elapsedFrom(startedAt))
    const onVisible = () => {
      if (!document.hidden) onResume()
    }

    window.addEventListener('app:resumed', onResume)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      window.removeEventListener('app:resumed', onResume)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [startedAt])

  return (
    <SessionElapsedContext.Provider value={elapsed}>
      {children}
    </SessionElapsedContext.Provider>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function SessionProvider({ children }) {
  const { user } = useAuth()

  // Active session row + display metadata
  const [session, setSession] = useState(null)

  // In-flight flags
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  // Confirmation data shown in StopSessionSheet after a successful stop.
  // Cleared when the sheet is dismissed.
  const [stopResult, setStopResult] = useState(null)

  // ── Restore orphaned session on auth ──────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setSession(null)
      return
    }

    getActiveSession().then((row) => {
      if (row) setSession(row)
    })
  }, [user])

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Begin a timed session for a game.
   * If another session is already running it is stopped first (time is NOT
   * saved for the interrupted session — the user should have stopped it).
   */
  const startGameSession = useCallback(
    async (igdbGameId, meta = {}) => {
      if (isStarting) return
      setIsStarting(true)
      try {
        const row = await svcStart(igdbGameId, meta)
        if (row) setSession(row)
      } finally {
        setIsStarting(false)
      }
    },
    [isStarting]
  )

  /**
   * Stop the active session, save time, and open the confirmation sheet.
   *
   * @param {object} [opts]
   * @param {string} [opts.note]  Optional journal line.
   */
  const stopGameSession = useCallback(
    async (opts = {}) => {
      if (!session || isStopping) return
      setIsStopping(true)
      try {
        const result = await svcStop(session.id, session.igdb_game_id, {
          startedAt: session.started_at,
          note: opts.note,
          gameTitle: session.game_title,
          gameImage: session.game_image,
        })

        const capturedSession = session
        setSession(null)

        if (result) {
          setStopResult({
            gameTitle: capturedSession.game_title,
            addedHours: result.addedHours,
            newHours: result.newHours,
            prevHours: result.prevHours,
            igdbGameId: capturedSession.igdb_game_id,
            // stopSession() already created a diary entry for this session
            // (blank body — the note isn't known yet). StopSessionSheet
            // fills it in via updateJournalEntry rather than inserting a
            // second, parallel diary row.
            journalEntryId: result.journalEntry?.id ?? null,
          })
          // Notify progress bar consumers so hours display updates immediately.
          try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}
        }
      } finally {
        setIsStopping(false)
      }
    },
    [session, isStopping]
  )

  const dismissStopResult = useCallback(() => setStopResult(null), [])

  const value = useMemo(
    () => ({
      session,
      isStarting,
      isStopping,
      stopResult,
      startGameSession,
      stopGameSession,
      dismissStopResult,
    }),
    [
      session,
      isStarting,
      isStopping,
      stopResult,
      startGameSession,
      stopGameSession,
      dismissStopResult,
    ]
  )

  return (
    <SessionContext.Provider value={value}>
      <SessionElapsedProvider startedAt={session?.started_at ?? null}>
        {children}
      </SessionElapsedProvider>
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}

/**
 * Seconds elapsed in the active session, updated once a second.
 * Subscribe only where the number is actually rendered.
 */
export function useSessionElapsed() {
  return useContext(SessionElapsedContext)
}
