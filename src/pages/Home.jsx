import React, { useState, useEffect, useCallback } from 'react'
import AppShell from '../components/AppShell'
import HomeSearchBar from '../components/HomeSearchBar'
import HeroCurrentlyPlaying from '../components/HeroCurrentlyPlaying'
import WantToPlayCard from '../components/WantToPlayCard'
import HomeFAB from '../components/HomeFAB'
import PopularNewSection from '../components/PopularNewSection'
import TimelineFeed from '../components/TimelineFeed'
import { getGamesFromList, getContinuePlayingGames } from '../services/libraryService'
import './Home.css'

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

function Home() {
  const [loading, setLoading] = useState(true)
  const [continueGames, setContinueGames] = useState([])
  const [wantToPlayGames, setWantToPlayGames] = useState([])
  const [feedRefreshKey] = useState(0)

  const loadHomeData = useCallback(() => {
    try {
      setLoading(true)
      setContinueGames(getContinuePlayingGames(5))
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

    return () => {
      window.removeEventListener('libraryUpdated', handleUpdate)
      window.removeEventListener('reviewAdded', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
      window.removeEventListener('activityUpdated', handleUpdate)
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

          {/* ── Inline search ────────────────────────────────────────
              Home searches IN PLACE — tapping the field focuses it (the
              keyboard appears because the user chose to search) and live
              results drop down here in context. This is intentionally
              different from Discover, whose search button navigates to the
              full-screen SearchOverlay. No layoutId here: the morph-into-
              overlay animation belongs to Discover only.
          ─────────────────────────────────────────────────────── */}
          <div className="home-section home-section-padded">
            <HomeSearchBar />
          </div>

          {/* Currently Playing — hero + secondary carousel */}
          <section className="home-section home-section--bleed">
            <HeroCurrentlyPlaying games={continueGames} />
          </section>

          {/* Want to Play card */}
          <section className="home-section">
            <WantToPlayCard games={wantToPlayGames} />
          </section>

          {/* Popular / New This Week — Sprint 5 P5 */}
          <PopularNewSection />

          {/* Timeline feed — Sprint 5 P5 */}
          <TimelineFeed refreshKey={feedRefreshKey} />

        </div>
      </div>
      <HomeFAB />
    </AppShell>
  )
}

export default Home
