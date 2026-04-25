import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchCategoryGames, getCategoryDefinitions } from '../services/browseService'
import GameCard from '../components/GameCard'
import './CategoryResults.css'

function CategoryResults() {
  const { categoryKey } = useParams()
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const categoryDef = getCategoryDefinitions().find((c) => c.key === categoryKey)
  const categoryLabel = categoryDef?.label || categoryKey

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const results = await fetchCategoryGames(categoryKey)
        if (!cancelled) {
          const sorted = [...results].sort((a, b) => {
            const rA = parseFloat(a.rating) || 0
            const rB = parseFloat(b.rating) || 0
            return rB - rA
          })
          setGames(sorted)
        }
      } catch (err) {
        console.error('Failed to load category games:', err)
        if (!cancelled) setError('Could not load games for this category.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [categoryKey])

  return (
    <div className="category-results-page">
      <div className="category-results-header">
        <button
          className="category-results-back"
          onClick={() => navigate('/search')}
          type="button"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="category-results-title">{categoryLabel}</h1>
      </div>

      {loading && (
        <div className="category-results-loading">
          <div className="loading-spinner"></div>
          <p>Loading games...</p>
        </div>
      )}

      {error && (
        <div className="category-results-error">
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <div className="category-results-empty">
          <p>No games found for this category.</p>
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="category-results-grid">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  )
}

export default CategoryResults
