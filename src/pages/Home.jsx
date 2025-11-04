import React, { useState, useEffect } from 'react'
import GameSection from '../components/GameSection'
import { testAPIConnection } from '../services/igdb'
import { getPersonalizedRecommendations, getRecommendationsFromViewed } from '../services/recommendations'
import './Home.css'

function Home() {
  const [gameSections, setGameSections] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchGames() {
      try {
        setLoading(true)
        setError(null)

        // Test API connection first
        const apiWorking = await testAPIConnection()
        if (!apiWorking) {
          setError('API connection test failed. Please check your .env file and restart the dev server.')
          setLoading(false)
          return
        }

        // Get personalized recommendations
        const personalized = await getPersonalizedRecommendations()
        
        // Get recommendations based on viewed games
        const viewedBased = await getRecommendationsFromViewed()
        
        // Combine all recommendations
        const allSections = {
          ...personalized,
          ...viewedBased,
        }

        console.log('Game sections loaded:', Object.keys(allSections))

        setGameSections(allSections)
      } catch (err) {
        console.error('Error fetching games:', err)
        const errorMessage = err.message || 'Unknown error'
        setError(`Failed to load games: ${errorMessage}. Please check your IGDB API credentials and browser console for details.`)
      } finally {
        setLoading(false)
      }
    }

    fetchGames()
  }, [])

  if (loading) {
    return (
      <div className="home">
        <div className="home-header">
          <h1>Good evening</h1>
        </div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading games...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="home">
        <div className="home-header">
          <h1>Good evening</h1>
        </div>
        <div className="error-container">
          <p>{error}</p>
          <p className="error-help">
            To use the IGDB API, you need to:
            <br />
            1. Create a Twitch account and register your app at{' '}
            <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer">
              https://dev.twitch.tv/console/apps
            </a>
            <br />
            2. Create a <code>.env</code> file with:
            <br />
            <code>VITE_IGDB_CLIENT_ID=your_client_id</code>
            <br />
            <code>VITE_IGDB_CLIENT_SECRET=your_client_secret</code>
          </p>
        </div>
      </div>
    )
  }

  // Sort sections to prioritize "New Releases" and "Trending Now" at the top
  const sectionEntries = Object.entries(gameSections).sort(([titleA], [titleB]) => {
    // Priority order: New Releases first, then Trending Now, then everything else
    const priority = {
      'New Releases': 1,
      'New Releases (Last 12 Months)': 1,
      'Trending Now': 2,
      'Most Popular': 2,
    }
    
    const priorityA = priority[titleA] || 99
    const priorityB = priority[titleB] || 99
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    
    // If same priority, maintain original order
    return 0
  })

  return (
    <div className="home">
      <div className="home-header">
        <h1>Good evening</h1>
      </div>

      <div className="home-content">
        {sectionEntries.length > 0 ? (
          sectionEntries.map(([title, games]) => 
            games && games.length > 0 ? (
              <GameSection key={title} title={title} games={games} />
            ) : null
          )
        ) : (
          <div className="no-games">
            <p>No games found. Please check your API configuration.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Home

