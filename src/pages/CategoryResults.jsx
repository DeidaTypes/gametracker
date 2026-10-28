import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { fetchCategoryGames, getCategoryDefinitions } from '../services/browseService'
import { getGamesByGenreId } from '../services/igdb'
import GameCard from '../components/GameCard'
import EmptyState from '../components/EmptyState'
import GameCardSkeleton from '../components/skeletons/GameCardSkeleton'
import { Arrive } from '../components/motion/ContentSwap'
import './CategoryResults.css'

const SKELETON_COUNT = 12
const SKELETONS = Array.from({ length: SKELETON_COUNT }, (_, i) => i)

// /browse/genre-<igdbGenreId> is how Game Detail opens a genre. Every other
// key is one of the fixed browse categories in browseService.
function parseGenreId(categoryKey) {
  const match = /^genre-(\d+)$/.exec(categoryKey || '')
  return match ? Number(match[1]) : null
}

function CategoryResults() {
  const { categoryKey } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const genreId = parseGenreId(categoryKey)
  const categoryDef = genreId == null
    ? getCategoryDefinitions().find((c) => c.key === categoryKey)
    : null
  // A key nobody knows never shows its raw slug.
  const unknownKey = genreId == null && !categoryDef

  // The genre name the chip carried, for an instant title. A cold link has
  // none and takes it from the IGDB genre catalog once the load resolves.
  const stateName = typeof location.state?.genreName === 'string' && location.state.genreName
    ? location.state.genreName
    : null

  const [games, setGames] = useState([])
  const [catalogName, setCatalogName] = useState(null)
  const [loading, setLoading] = useState(!unknownKey)
  const [error, setError] = useState(null)

  const categoryLabel = genreId != null
    ? (stateName || catalogName || '')
    : (categoryDef?.label || '')

  useEffect(() => {
    if (unknownKey) {
      setLoading(false)
      return undefined
    }

    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        setCatalogName(null)

        if (genreId != null) {
          const result = await getGamesByGenreId(genreId, 30)
          if (cancelled) return
          setCatalogName(result.name)
          setGames(result.games)
          return
        }

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
  }, [categoryKey, genreId, unknownKey])

  // A genre id nobody knows: no games and no name from the chip or the catalog.
  const unavailable = unknownKey || (
    genreId != null && !loading && !error && !stateName && !catalogName && games.length === 0
  )

  // Back goes back. A cold deep link has no history entry behind it, so only
  // then does it fall back to Discover.
  const handleBack = () => {
    const idx = window.history.state?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate('/discover', { replace: true })
  }

  let body
  if (error) {
    body = (
      <div className="category-results-error">
        <p>{error}</p>
      </div>
    )
  } else if (unavailable) {
    body = <EmptyState icon={SearchX} body="This category isn't available" />
  } else if (games.length === 0) {
    body = <EmptyState icon={SearchX} body="No games found for this category." />
  } else {
    body = (
      <div className="category-results-grid">
        {games.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    )
  }

  return (
    <div className="category-results-page">
      <div className="category-results-header">
        <button
          className="category-results-back"
          onClick={handleBack}
          type="button"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        {categoryLabel && <h1 className="category-results-title">{categoryLabel}</h1>}
      </div>

      {/* The placeholder wears the results grid's own columns and padding, so
          the box is already its final shape when the covers fade in. */}
      <Arrive
        ready={!loading}
        placeholder={(
          <div className="category-results-grid">
            {SKELETONS.map((i) => <GameCardSkeleton key={i} />)}
          </div>
        )}
      >
        {body}
      </Arrive>
    </div>
  )
}

export default CategoryResults
