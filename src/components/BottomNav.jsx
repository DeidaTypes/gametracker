import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { 
  HiOutlineHome, 
  HiHome,
  HiOutlineGlobe,
  HiGlobe,
  HiOutlineSearch, 
  HiSearch,
  HiOutlineBookOpen, 
  HiBookOpen,
  HiOutlineUser, 
  HiUser
} from 'react-icons/hi'
import './BottomNav.css'

function BottomNav() {
  const location = useLocation()

  // Don't show on onboarding page
  if (location.pathname === '/onboarding') {
    return null
  }

  return (
    <nav className="bottom-nav">
      <NavLink 
        to="/" 
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <HiHome className="bottom-nav-icon" />
            ) : (
              <HiOutlineHome className="bottom-nav-icon" />
            )}
            <span className="bottom-nav-label">Home</span>
          </>
        )}
      </NavLink>
      <NavLink 
        to="/explore" 
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <HiGlobe className="bottom-nav-icon" />
            ) : (
              <HiOutlineGlobe className="bottom-nav-icon" />
            )}
            <span className="bottom-nav-label">Explore</span>
          </>
        )}
      </NavLink>
      <NavLink 
        to="/search" 
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <HiSearch className="bottom-nav-icon" />
            ) : (
              <HiOutlineSearch className="bottom-nav-icon" />
            )}
            <span className="bottom-nav-label">Search</span>
          </>
        )}
      </NavLink>
      <NavLink 
        to="/library" 
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <HiBookOpen className="bottom-nav-icon" />
            ) : (
              <HiOutlineBookOpen className="bottom-nav-icon" />
            )}
            <span className="bottom-nav-label">Library</span>
          </>
        )}
      </NavLink>
      <NavLink 
        to="/profile" 
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        {({ isActive }) => (
          <>
            {isActive ? (
              <HiUser className="bottom-nav-icon" />
            ) : (
              <HiOutlineUser className="bottom-nav-icon" />
            )}
            <span className="bottom-nav-label">Profile</span>
          </>
        )}
      </NavLink>
    </nav>
  )
}

export default BottomNav

