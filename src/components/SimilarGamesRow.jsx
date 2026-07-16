import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSimilarGamesForRow } from '../services/igdb'
import './SimilarGamesRow.css'

const COVER_W = 120
const COVER_H = 180 // 2:3 aspect

function CoverSkeleton() {
  return (
    <div className="sgr-item" aria-hidden="true">
      <div
        className="sgr-cover-skeleton skeleton"
        style={{ width: COVER_W, height: COVER_H }}
      />
      <div className="sgr-title-skeleton skeleton" />
    </div>
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
        <p className="gd-section-label">More Like This</p>
        <div className="sgr-scroll" role="list" aria-label="More like this">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <CoverSkeleton key={i} />
              ))
            : games.map((game) => (
                <div key={game.id} className="sgr-item" role="listitem">
                  <button
                    className="sgr-cover-btn"
                    onClick={() => navigate(`/game/${game.id}`)}
                    aria-label={game.title}
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
                  <p className="sgr-title">{game.title}</p>
                  {/* Only rendered when the backing data actually carries a
                      per-item match score — fetchSimilarGamesForRow (IGDB
                      similar_games, filtered by genre/theme) does not compute
                      one today, so this is a no-op until a real source exists.
                      Never fabricate a percentage here. */}
                  {typeof game.matchPercent === 'number' && (
                    <p className="sgr-match">{Math.round(game.matchPercent)}% match</p>
                  )}
                </div>
              ))
          }
        </div>
      </div>
    </>
  )
}
