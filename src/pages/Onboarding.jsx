import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setFavoriteGenres, setOnboarded } from '../services/userPreferences'
import './Onboarding.css'

const POPULAR_GENRES = [
  'Action',
  'Adventure',
  'Role-playing (RPG)',
  'Strategy',
  'Simulation',
  'Sports',
  'Racing',
  'Fighting',
  'Puzzle',
  'Indie',
  'Platform',
  'Shooter',
  'Horror',
  'Survival',
  'MMO',
  'MOBA',
]

function Onboarding() {
  const navigate = useNavigate()
  const [selectedGenres, setSelectedGenres] = useState([])
  const [step, setStep] = useState(1)

  const toggleGenre = (genre) => {
    if (selectedGenres.includes(genre)) {
      setSelectedGenres(selectedGenres.filter(g => g !== genre))
    } else {
      setSelectedGenres([...selectedGenres, genre])
    }
  }

  const handleContinue = () => {
    if (step === 1) {
      if (selectedGenres.length === 0) {
        alert('Please select at least one genre to continue.')
        return
      }
      setStep(2)
    } else {
      // Save preferences and complete onboarding
      setFavoriteGenres(selectedGenres)
      setOnboarded(true)
      navigate('/')
    }
  }

  const handleSkip = () => {
    setOnboarded(true)
    navigate('/')
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        {step === 1 && (
          <>
            <h1>Welcome to GameTracker! 🎮</h1>
            <p className="onboarding-subtitle">
              Select your favorite game genres to personalize your experience
            </p>
            <p className="onboarding-hint">
              Select at least 3 genres (you can select more)
            </p>
            
            <div className="genres-grid">
              {POPULAR_GENRES.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={`genre-button ${selectedGenres.includes(genre) ? 'selected' : ''}`}
                >
                  {genre}
                </button>
              ))}
            </div>

            <div className="onboarding-actions">
              <button onClick={handleSkip} className="skip-button">
                Skip for now
              </button>
              <button 
                onClick={handleContinue} 
                className="continue-button"
                disabled={selectedGenres.length === 0}
              >
                Continue ({selectedGenres.length} selected)
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Almost done! ✨</h1>
            <p className="onboarding-subtitle">
              You've selected {selectedGenres.length} genres:
            </p>
            <div className="selected-genres-list">
              {selectedGenres.map((genre) => (
                <span key={genre} className="selected-genre-tag">
                  {genre}
                </span>
              ))}
            </div>
            <p className="onboarding-hint">
              We'll use these to show you personalized game recommendations!
            </p>
            <div className="onboarding-actions">
              <button onClick={() => setStep(1)} className="back-button">
                ← Back
              </button>
              <button onClick={handleContinue} className="continue-button">
                Get Started!
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Onboarding

