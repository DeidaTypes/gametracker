import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopNav from './components/TopNav'
import MobileNav from './components/MobileNav'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Search from './pages/Search'
import Library from './pages/Library'
import Wishlist from './pages/Wishlist'
import Reviews from './pages/Reviews'
import GameDetail from './pages/GameDetail'
import Profile from './pages/Profile'
import Onboarding from './pages/Onboarding'
import { getPreferences, initializePreferences } from './services/userPreferences'
import './App.css'

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)

  useEffect(() => {
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

  // Don't show sidebar on onboarding page
  const showSidebar = location.pathname !== '/onboarding'

  if (checkingOnboarding) {
    return (
      <div className="app">
        <div className="loading-container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="loading-spinner"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TopNav />
      <MobileNav />
      {showSidebar && <Sidebar />}
      <div className="main-content" style={!showSidebar ? { marginLeft: 0 } : {}}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/game/:gameId" element={<GameDetail />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
      <BottomNav />
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
