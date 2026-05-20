import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSimilarGamesForRow } from '../services/igdb'
import './SimilarGamesRow.css'

const COVER_W = 120
const COVER_H = 180 // 2:3 aspect

function CoverSkeleton() {
  return (
    <div
      className="sgr-cover-skeleton skeleton"
      style={{ width: COVER_W, height: COVER_H }}
      aria-hidden="true"
    />
  )
}

export default function SimilarGamesRow({ gameId, genreIds = [], themeIds = [] }) {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const results = await fetchSimilarGamesForRow(gameId, genreIds, themeIds)
        if (!cancelled) setGames(results)
      } catch {
        if (!cancelled) setGames([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [gameId])

  if (!loading && games.length === 0) return null

  return (
    <>
      <div className="gd-divider" />
      <div className="gd-section">
        <p className="gd-section-label">Similar Games</p>
        <div className="sgr-scroll" role="list" aria-label="Similar games">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <CoverSkeleton key={i} />
              ))
            : games.map((game) => (
                <button
                  key={game.id}
                  className="sgr-cover-btn"
                  onClick={() => navigate(`/game/${game.id}`)}
                  aria-label={game.title}
                  role="listitem"
                >
                  <img
                    src={game.image}
                    alt={game.title}
                    className="sgr-cover-img"
                    width={COVER_W}
                    height={COVER_H}
                    loading="lazy"
                  />
                </button>
              ))
          }
        </div>
      </div>
    </>
  )
}
