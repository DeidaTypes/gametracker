import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../../services/imageUtils'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './TrendingCard.css'

const STATUS_VERB = {
  reviewed: 'reviewed',
  played: 'finished',
  completed: 'finished',
  finished: 'finished',
  currently: 'are playing',
  playing: 'are playing',
  'currently-playing': 'are playing',
  want: 'added',
  'want-to-play': 'added',
  dropped: 'dropped',
}

function TrendingCard({ entry }) {
  const navigate = useNavigate()
  const { game, peopleCount, mostCommonStatus } = entry
  const verb = STATUS_VERB[mostCommonStatus] || 'logged'
  const img = getBestImageUrl(game, 600) || game.image

  return (
    <Pressable
      className="trending-card"
      onClick={() =>
        navigate(`/game/${game.id}`, { state: { coverImage: img } })
      }
    >
      <div className="trending-card__cover">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img
            src={img}
            alt={game.title}
            loading="lazy"
            onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
          />
        </SharedCover>
      </div>
      <div className="trending-card__meta">
        <h3 className="trending-card__title">{game.title}</h3>
        <span className="trending-card__badge">
          {peopleCount} {peopleCount === 1 ? 'person' : 'people'} {verb}
        </span>
      </div>
    </Pressable>
  )
}

export default TrendingCard
