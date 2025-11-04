import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import './MobileNav.css'

function MobileNav() {
  const [isOpen, setIsOpen] = useState(false)
  const location = useLocation()

  const toggleNav = () => {
    setIsOpen(!isOpen)
  }

  const closeNav = () => {
    setIsOpen(false)
  }

  // Don't show on onboarding page
  if (location.pathname === '/onboarding') {
    return null
  }

  return (
    <>
      <button className="mobile-nav-toggle" onClick={toggleNav} aria-label="Toggle navigation">
        <span className={`hamburger ${isOpen ? 'open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>

      <div className={`mobile-nav-overlay ${isOpen ? 'open' : ''}`} onClick={closeNav}></div>

      <nav className={`mobile-nav ${isOpen ? 'open' : ''}`}>
        <div className="mobile-nav-header">
          <h1>🎮 GameTracker</h1>
          <button className="mobile-nav-close" onClick={closeNav} aria-label="Close navigation">
            ✕
          </button>
        </div>
        <div className="mobile-nav-links">
          <NavLink 
            to="/" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">🏠</span>
            <span>Home</span>
          </NavLink>
          <NavLink 
            to="/search" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">🔍</span>
            <span>Search</span>
          </NavLink>
          <NavLink 
            to="/library" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">📚</span>
            <span>Your Library</span>
          </NavLink>
          <NavLink 
            to="/wishlist" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">⭐</span>
            <span>Wishlist</span>
          </NavLink>
          <NavLink 
            to="/reviews" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">📝</span>
            <span>Reviews</span>
          </NavLink>
          <NavLink 
            to="/profile" 
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeNav}
          >
            <span className="nav-icon">👤</span>
            <span>Profile</span>
          </NavLink>
        </div>
      </nav>
    </>
  )
}

export default MobileNav

