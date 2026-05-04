import React, { createContext, useContext, useState } from 'react'

/**
 * Holds the extracted swatch palette for the currently-viewed game detail
 * page so that global chrome (tab bar, etc.) can tint itself to match.
 *
 * Shape:
 *   swatches: { vibrant: {r,g,b}, vibrantDark: {r,g,b}, muted: {r,g,b}|null }
 *             | null   ← default amber chrome
 *
 * GameDetail sets swatches on mount (after async extraction) and clears them
 * on unmount. All other consumers are read-only.
 */
const GameColorContext = createContext({
  swatches: null,
  setSwatches: () => {},
})

export function GameColorProvider({ children }) {
  const [swatches, setSwatches] = useState(null)
  return (
    <GameColorContext.Provider value={{ swatches, setSwatches }}>
      {children}
    </GameColorContext.Provider>
  )
}

export function useGameColor() {
  return useContext(GameColorContext)
}
