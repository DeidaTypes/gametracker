import React, { createContext, useContext, useMemo } from 'react'
import usePresence from '../hooks/usePresence'
import { usePresencePings } from '../hooks/usePresencePings'
import { useProgressNudges } from '../hooks/useProgressNudges'

/**
 * NudgesContext — transient in-app pings and progress nudges.
 *
 * Deliberately separate from NotificationsContext (the persistent inbox).
 * Nothing here is written to the DB; all state is client-side only and
 * lives until the user dismisses or reloads.
 *
 * Provides
 * --------
 *   pings        — grouped presence-join banners
 *                  [{ id, gameId, gameTitle, gameImage, userIds[], count }]
 *   nudges       — progress threshold nudges
 *                  [{ id, type, message, meta }]
 *   dismissPing  — (id: string) => void
 *   dismissNudge — (id: string) => void
 *
 * Provider tree requirement
 * -------------------------
 * Must be rendered inside AuthProvider, SessionProvider, and
 * SettingsProvider (all already in App.jsx).
 */

const NudgesContext = createContext({
  pings: [],
  nudges: [],
  dismissPing: () => {},
  dismissNudge: () => {},
})

export function NudgesProvider({ children }) {
  const { playingNow } = usePresence()
  const { pings, dismissPing } = usePresencePings(playingNow)
  const { nudges, dismissNudge } = useProgressNudges()

  const value = useMemo(
    () => ({ pings, nudges, dismissPing, dismissNudge }),
    [pings, nudges, dismissPing, dismissNudge]
  )

  return (
    <NudgesContext.Provider value={value}>
      {children}
    </NudgesContext.Provider>
  )
}

export function useNudges() {
  return useContext(NudgesContext)
}

export default NudgesContext
