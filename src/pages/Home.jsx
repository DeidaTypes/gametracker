import React, { useState, useEffect } from 'react'
import AppShell from '../components/AppShell'
import CurrentlyPlayingCarousel from '../components/CurrentlyPlayingCarousel'
import HomeQuickCards from '../components/HomeQuickCards'
import SmartListSection from '../components/SmartListSection'
import { getGamesFromList, getContinuePlayingGames } from '../services/libraryService'
import { getMostPlayed } from '../services/smartListService'
import './Home.css'

function HomeSkeleton() {
  return (
    <div className="home-skeleton">
      <div className="home-sk-heading">
        <div className="skeleton home-sk-heading-block" />
      </div>
      <div className="skeleton home-sk-hero" />
      <div className="home-sk-duo">
        <div className="skeleton home-sk-duo-card" />
        <div className="skeleton home-sk-duo-card" />
      </div>
    </div>
  )
}

function Home() {
  const [loading, setLoading] = useState(true)
  const [continueGames, setContinueGames] = useState([])
  const [wantToPlayGames, setWantToPlayGames] = useState([])
  const [mostPlayed, setMostPlayed] = useState([])

  useEffect(() => {
    function loadHomeData() {
      try {
        setLoading(true)

        setContinueGames(getContinuePlayingGames(5))

        const wtp = getGamesFromList('want-to-play')
        setWantToPlayGames(wtp)

        setMostPlayed(getMostPlayed(5))
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

  const wtpCover = wantToPlayGames.length > 0 ? wantToPlayGames[0].image : null

  return (
    <AppShell>
      <div className="home">
        <div className="home-body">

          {/* Currently Playing carousel — hero section */}
          <section className="home-section home-section--carousel">
            <CurrentlyPlayingCarousel games={continueGames} />
          </section>

          {/* Quick cards: Want to Play + Stats */}
          <section className="home-section home-section--duo">
            <HomeQuickCards
              wantToPlayCover={wtpCover}
            />
          </section>

          {/* Most Played */}
          <SmartListSection
            title="Most Played"
            games={mostPlayed}
            badgeFn={(g) => `${g.hoursPlayed}h`}
            listKey="most-played"
          />

        </div>
      </div>
    </AppShell>
  )
}

export default Home
