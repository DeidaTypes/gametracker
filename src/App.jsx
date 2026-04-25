import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import TopNav from './components/TopNav'
import MobileNav from './components/MobileNav'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Search from './pages/Search'
import CategoryResults from './pages/CategoryResults'
import Library from './pages/Library'
import Wishlist from './pages/Wishlist'
import Reviews from './pages/Reviews'
import GameDetail from './pages/GameDetail'
import Profile from './pages/Profile'
import CurrentlyPlaying from './pages/CurrentlyPlaying'
import SmartListDetail from './pages/SmartListDetail'
import Onboarding from './pages/Onboarding'
import { getPreferences, initializePreferences } from './services/userPreferences'
import { initializeProfile } from './services/profileService'
import './styles/theme.css'
import './styles/grid.css'
import './App.css'

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)

  useEffect(() => {
    // Initialize profile
    initializeProfile()

    // Check if user has completed onboarding
    const prefs = getPreferences()
    if (!prefs || !prefs.onboarded) {
      // Initialize preferences if they don't exist
      if (!prefs) {
        initializePreferences()
      }
      // Redirect to onboarding if not on onboarding page
      if (location.pathname !== '/onboarding') {
        navigate('/onboarding', { replace: true })
      }
    }
    setCheckingOnboarding(false)
  }, [navigate, location.pathname])

  // Don't show nav chrome on onboarding page
  const showNav = location.pathname !== '/onboarding'

  if (checkingOnboarding) {
    return (
      <div className="app">
        <div className="loading-container">
          <div className="loading-spinner"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {showNav && <TopNav />}
      {showNav && <MobileNav />}
      <div className="main-content">
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/search" element={<Search />} />
          <Route path="/browse/:categoryKey" element={<CategoryResults />} />
          <Route path="/library" element={<Library />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/game/:gameId" element={<GameDetail />} />
          <Route path="/currently-playing" element={<CurrentlyPlaying />} />
          <Route path="/smart-list/:listKey" element={<SmartListDetail />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
      {showNav && <BottomNav />}
    </div>
  )
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}

export default App
