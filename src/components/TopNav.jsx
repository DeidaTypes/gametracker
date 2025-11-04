import React, { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { HiOutlineSearch, HiSearch } from 'react-icons/hi'
import './TopNav.css'

function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchValue, setSearchValue] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchValue.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`)
      setSearchValue('')
    }
  }

  // Don't show on onboarding page
  if (location.pathname === '/onboarding') {
    return null
  }

  return (
    <nav className="top-nav">
      <div className="top-nav-container">
        <NavLink to="/" className="top-nav-logo">
          <span className="logo-text">GameTracker</span>
        </NavLink>

        <form className="top-nav-search" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            placeholder="Search Game"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className={`search-input ${isSearchFocused ? 'focused' : ''}`}
          />
          <button 
            type="submit" 
            className="search-icon-button"
            aria-label="Search"
          >
            <HiOutlineSearch className="search-icon" />
          </button>
        </form>

        <div className="top-nav-links">
          <NavLink 
            to="/library" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Library
          </NavLink>
          <NavLink 
            to="/wishlist" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Wishlist
          </NavLink>
          <NavLink 
            to="/reviews" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Reviews
          </NavLink>
          <NavLink 
            to="/profile" 
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            Profile
          </NavLink>
        </div>
      </div>
    </nav>
  )
}

export default TopNav

