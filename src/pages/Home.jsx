import React, { useState, useEffect } from 'react'
import AppShell from '../components/AppShell'
import HeroCurrentlyPlaying from '../components/HeroCurrentlyPlaying'
import WantToPlayCard from '../components/WantToPlayCard'
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
  useEffect(() => {
    function loadHomeData() {
      try {
        setLoading(true)

        setContinueGames(getContinuePlayingGames(5))

        const wtp = getGamesFromList('want-to-play')
        setWantToPlayGames(wtp)
      } catch (err) {
        console.error('Error loading home data:', err)
      } finally {
        setLoading(false)
      }
    }

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
  }, [])

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

          {/* Currently Playing — hero + secondary carousel */}
          <section className="home-section home-section--bleed">
            <HeroCurrentlyPlaying games={continueGames} />
          </section>

          {/* Want to Play card */}
          <section className="home-section">
            <WantToPlayCard games={wantToPlayGames} />
          </section>

        </div>
      </div>
    </AppShell>
  )
}

export default Home
