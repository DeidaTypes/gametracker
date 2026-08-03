import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGamesByDeveloper } from '../services/igdb'
import { Building2 } from 'lucide-react'
import GameCard from '../components/GameCard'
import InlineErrorBanner from '../components/InlineErrorBanner'
import EmptyState from '../components/EmptyState'
import { GameCardSkeletonGrid } from '../components/skeletons/GameCardSkeleton'
import './DeveloperDetail.css'

function DeveloperDetail() {
  const { developerName } = useParams()
  const navigate = useNavigate()
  const [company, setCompany] = useState(null)
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  const displayName = decodeURIComponent(developerName || '')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const result = await getGamesByDeveloper(displayName)
        if (cancelled) return

        if (result.company) {
          setCompany(result.company)
          setGames(result.games)
        } else {
          setError('Developer not found')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load developer')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [displayName, retryCount])

  return (
    <div className="dev-detail-page">
      <div className="dev-detail-header">
        <button
          className="dev-detail-back"
          onClick={() => navigate(-1)}
          type="button"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="dev-detail-title">
          {company?.name || displayName}
        </h1>
      </div>

      {company?.description && (
        <p className="dev-detail-bio">{company.description}</p>
      )}

      {loading && <GameCardSkeletonGrid count={12} />}

      {error && !loading && (
        <div className="dev-detail-status">
          <InlineErrorBanner
            message={error}
            onRetry={() => setRetryCount(n => n + 1)}
          />
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <div className="dev-detail-status">
          <EmptyState
            icon={Building2}
            title={`No games on file for ${company?.name || displayName}`}
            cta="Search games"
            onCta={() => navigate('/search')}
          />
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <>
          <p className="dev-detail-count">
            {games.length} {games.length === 1 ? 'game' : 'games'}
          </p>
          <div className="dev-detail-grid">
            {games.map(game => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default DeveloperDetail
