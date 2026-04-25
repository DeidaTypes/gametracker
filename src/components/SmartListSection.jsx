import React from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from './SectionHeader'
import { getBestImageUrl } from '../services/imageUtils'
import './SmartListSection.css'

function SmartListCard({ game, badge }) {
  const navigate = useNavigate()
  const imageUrl = getBestImageUrl(game, 400) || game.image

  return (
    <div
      className="sl-card"
      onClick={() => navigate(`/game/${game.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/game/${game.id}`)}
    >
      <div className="sl-card-cover">
        <img
          src={imageUrl}
          alt={game.title}
          className="sl-card-img"
          loading="lazy"
          onError={(e) => {
            if (e.target.src !== game.image) {
              e.target.src =
                game.image ||
                `https://via.placeholder.com/200x300/152035/C8965A?text=${encodeURIComponent(
                  game.title
                )}`
            }
          }}
        />
        {badge && <span className="sl-card-badge">{badge}</span>}
        <div className="sl-card-hover">
          <span className="sl-card-view">View</span>
        </div>
      </div>
      <p className="sl-card-title">{game.title}</p>
    </div>
  )
}

/**
 * SmartListSection — a labelled horizontal row of game cards with a stat badge.
 * Props:
 *   eyebrow   — small uppercase label (e.g. "Smart List")
 *   title     — section title (e.g. "Most Played")
 *   games     — array of game objects (already sorted/sliced)
 *   badgeFn   — (game) => string|null — returns the badge label for each card
 *   listKey   — unique key used for the "See All" route (e.g. "most-played")
 */
function SmartListSection({ eyebrow, title, games, badgeFn, listKey }) {
  const navigate = useNavigate()

  if (!games || games.length === 0) return null

  return (
    <section className="home-section home-section--bleed">
      <div className="home-section-padded">
        <SectionHeader
          eyebrow={eyebrow}
          title={title}
          action="See all"
          onAction={() => navigate(`/smart-list/${listKey}`)}
        />
      </div>
      <div className="sl-row">
        {games.map((game) => (
          <SmartListCard
            key={game.id}
            game={game}
            badge={badgeFn ? badgeFn(game) : null}
          />
        ))}
      </div>
    </section>
  )
}

export default SmartListSection
