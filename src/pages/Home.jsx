import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import HomeSearchBar from '../components/HomeSearchBar'
import TodayCard from '../components/TodayCard'
import BacklogSection from '../components/BacklogSection'
import SocialActivityCard from '../components/SocialActivityCard'
import HomeFAB from '../components/HomeFAB'
import TrackerSearchModal from '../components/TrackerSearchModal'
import { getGamesFromList } from '../services/libraryService'
import { getProfile } from '../services/profileService'
import { useAuth } from '../contexts/AuthContext'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Home.css'
import '../components/HomeShelf.css'

function HomeSkeleton() {
  return (
    <div className="home-skeleton">
      <div className="home-sk-heading">
        <div className="skeleton home-sk-heading-block" />
      </div>
      <div className="skeleton home-sk-hero" />
      <div className="home-sk-single">
        <div className="skeleton home-sk-single-card" />
      </div>
    </div>
  )
}

/**
 * Home — the personalized dashboard.
 *
 * Top to bottom: a greeting + inline search, then the user's own games:
 * Continue Playing (hero), Your Backlog (Want to Play), and Recently Played.
 * There is no Popular / New / social-timeline content here anymore — that
 * lives on Discover. Every "add a game" affordance opens a focused tracker
 * search popup (TrackerSearchModal) instead of navigating away to Explore.
 */
function Home() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [wantToPlayGames, setWantToPlayGames] = useState([])
  // Focused "add to tracker" popup. status drives which list the picked
  // game lands in ('currently' | 'want' | 'played').
  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState('currently')

  const openAdd = useCallback((status) => {
    setAddStatus(status)
    setAddOpen(true)
  }, [])

  const displayName =
    profile?.display_name?.trim() ||
    getProfile()?.displayName?.trim() ||
    'player'

  const loadHomeData = useCallback(() => {
    try {
      setLoading(true)
      setWantToPlayGames(getGamesFromList('want-to-play'))
    } catch (err) {
      console.error('Error loading home data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeData()

    const handleUpdate = () => loadHomeData()
    window.addEventListener('libraryUpdated', handleUpdate)
    window.addEventListener('reviewAdded', handleUpdate)
    window.addEventListener('storage', handleUpdate)
    window.addEventListener('activityUpdated', handleUpdate)
    window.addEventListener(APP_RESUMED_EVENT, handleUpdate)

    return () => {
      window.removeEventListener('libraryUpdated', handleUpdate)
      window.removeEventListener('reviewAdded', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
      window.removeEventListener('activityUpdated', handleUpdate)
      window.removeEventListener(APP_RESUMED_EVENT, handleUpdate)
    }
  }, [loadHomeData])

  if (loading) {
    return (
      <AppShell>
        <div className="home">
          <HomeSkeleton />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="home">
        <div className="home-body">

          {/* ── Greeting + inline search ─────────────────────────────
              Home searches IN PLACE — tapping the field focuses it and
              live results drop down here in context. This is intentionally
              different from Discover, whose search button navigates to the
              full-screen SearchOverlay.
          ─────────────────────────────────────────────────────── */}
          <header className="home-section home-section-padded home-greeting-block">
            <h1 className="home-greeting">Welcome back, {displayName}</h1>
            <HomeSearchBar />
          </header>

          {/* ── Today — streak + now playing + 7-day activity week ── */}
          <section className="home-section home-section-padded">
            <TodayCard />
          </section>

          {/* ── Your Backlog — boxed "what's next" card ── */}
          <section className="home-section home-section-padded">
            <BacklogSection
              games={wantToPlayGames}
              onAddGame={() => openAdd('want')}
            />
          </section>

          {/* ── Social Activity — Activity / Lists / Favorites swipeable card (from Following) ── */}
          <section className="home-section home-section-padded">
            <SocialActivityCard />
          </section>


        </div>
      </div>

      <HomeFAB />

      <TrackerSearchModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        status={addStatus}
      />
    </AppShell>
  )
}

export default Home
