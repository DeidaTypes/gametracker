// SessionContext — global play-session state shared across the whole app.
//
// One active session at a time. The timer tick always recomputes elapsed
// from `started_at` rather than accumulating deltas so that backgrounding
// the app and returning never desynchronises the counter.
//
// Consumers use the `useSession` hook. GameDetail, HomeFAB, and the
// persistent SessionPill all read from this single source of truth.

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { useAuth } from './AuthContext'
import {
  startSession as svcStart,
  stopSession as svcStop,
  getActiveSession,
} from '../services/sessionService'

const SessionContext = createContext(null)

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedFrom(startedAt) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function SessionProvider({ children }) {
  const { user } = useAuth()

  // Active session row + display metadata
  const [session, setSession] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  // In-flight flags
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  // Confirmation data shown in StopSessionSheet after a successful stop.
  // Cleared when the sheet is dismissed.
  const [stopResult, setStopResult] = useState(null)

  const tickRef = useRef(null)

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      clearInterval(tickRef.current)
      return
    }

    const tick = () => setElapsed(elapsedFrom(session.started_at))
    tick() // immediate first tick

    tickRef.current = setInterval(tick, 1000)
    return () => clearInterval(tickRef.current)
  }, [session])

  // ── Foreground resume: recompute from started_at ───────────────────────────
  useEffect(() => {
    function onResume() {
      if (session) setElapsed(elapsedFrom(session.started_at))
    }

    window.addEventListener('app:resumed', onResume)

    function onVisible() {
      if (!document.hidden) onResume()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('app:resumed', onResume)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  // ── Restore orphaned session on auth ──────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setSession(null)
      setElapsed(0)
      clearInterval(tickRef.current)
      return
    }

    getActiveSession().then((row) => {
      if (row) {
        setSession(row)
        setElapsed(elapsedFrom(row.started_at))
      }
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
        if (row) {
          setSession(row)
          setElapsed(0)
        }
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
        setElapsed(0)

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

  return (
    <SessionContext.Provider
      value={{
        session,
        elapsed,
        isStarting,
        isStopping,
        stopResult,
        startGameSession,
        stopGameSession,
        dismissStopResult,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
