import React from 'react'
import './AppShell.css'

/**
 * AppShell — global layout wrapper for all pages.
 * Provides the main scrollable content region with correct
 * offsets for the fixed top-nav (desktop) and bottom-nav (mobile).
 */
function AppShell({ children }) {
  return (
    <div className="app-shell-content">
      {children}
    </div>
  )
}

export default AppShell
