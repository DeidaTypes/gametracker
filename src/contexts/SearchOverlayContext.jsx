import React, { createContext, useContext, useMemo, useState } from 'react'

/**
 * Provides the open/close state for the full-screen search overlay that
 * is reachable from both the Home pill and the Discover magnifying-glass.
 *
 * Usage:
 *   const { isOpen, open, close } = useSearchOverlay()
 *
 * Render the <SearchOverlay /> inside an <AnimatePresence> at the app root;
 * it reads `isOpen` internally via this context.
 */
const SearchOverlayContext = createContext({
  isOpen: false,
  open: () => {},
  close: () => {},
})

export function SearchOverlayProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)

  const value = useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [isOpen]
  )

  return (
    <SearchOverlayContext.Provider value={value}>
      {children}
    </SearchOverlayContext.Provider>
  )
}

export function useSearchOverlay() {
  return useContext(SearchOverlayContext)
}
