import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import SharedCover from '../components/SharedCover'
import { getBestImageUrl } from '../services/imageUtils'
import { getMostPlayed, getUnfinished, getTopRated } from '../services/smartListService'
import './SmartListDetail.css'

const LIST_CONFIG = {
  'most-played': {
    eyebrow: 'Smart List',
    title: 'Most Played',
    fetch: () => getMostPlayed(50),
    badge: (g) => `${g.hoursPlayed}h`,
    emptyMsg: 'Log hours in your reviews to populate this list.',
  },
  unfinished: {
    eyebrow: 'Smart List',
    title: 'Unfinished',
    fetch: () => getUnfinished(50),
    badge: (g) =>
      g.progressPercent > 0 ? `${g.progressPercent}%` : 'Not started',
    emptyMsg: 'Add games to "Currently Playing" to see them here.',
  },
  'top-rated': {
    eyebrow: 'Smart List',
    title: 'Top Rated',
    fetch: () => getTopRated(50),
    badge: (g) => `★ ${g.userRating.toFixed(1)}`,
    emptyMsg: 'Rate games in your reviews to populate this list.',
  },
}

function SmartListDetail() {
  const { listKey } = useParams()
  const navigate = useNavigate()
  const [games, setGames] = useState([])

  const config = LIST_CONFIG[listKey]

  useEffect(() => {
    if (config) {
      setGames(config.fetch())
    }
  }, [listKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) {
    return (
      <AppShell>
        <div className="sld-page">
          <p className="sld-empty">Unknown list.</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="sld-page">
        <header className="sld-header">
          <button
            className="sld-back"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            ← Back
          </button>
          <span className="sld-eyebrow">{config.eyebrow}</span>
          <h1 className="sld-title">{config.title}</h1>
        </header>

        {games.length === 0 ? (
          <div className="sld-empty">
            <p>{config.emptyMsg}</p>
          </div>
        ) : (
          <ul className="sld-list">
            {games.map((game, idx) => {
              const imgUrl = getBestImageUrl(game, 200) || game.image
              return (
              <li
                key={game.id}
                className="sld-item"
                onClick={() =>
                  navigate(`/game/${game.id}`, {
                    state: { coverImage: imgUrl },
                  })
                }
              >
                <span className="sld-rank">{idx + 1}</span>
                <div className="sld-cover">
                  <SharedCover gameId={game.id} imageSrc={imgUrl}>
                    <img
                      src={imgUrl}
                      alt={game.title}
                      className="sld-cover-img"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src =
                          game.image ||
                          `https://via.placeholder.com/120x180/152035/C8965A?text=${encodeURIComponent(
                            game.title
                          )}`
                      }}
                    />
                  </SharedCover>
                </div>
                <div className="sld-info">
                  <p className="sld-game-title">{game.title}</p>
                  <span className="sld-badge">{config.badge(game)}</span>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}

export default SmartListDetail
