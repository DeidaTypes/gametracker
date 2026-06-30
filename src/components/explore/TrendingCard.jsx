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
  const { game, peopleCount, mostCommonStatus, followFriendCount = 0 } = entry

  // Hide cards with no meaningful social signal.
  // "1 person reviewed" is noise; a single friend playing it IS signal.
  if (peopleCount <= 1 && followFriendCount === 0) return null

  const verb = STATUS_VERB[mostCommonStatus] || 'logged'
  const img = getBestImageUrl(game, 600) || game.image

  // Prefer follow-graph proof — "N you follow played this" — over raw counts.
  const badge = followFriendCount > 0
    ? `${followFriendCount} you follow ${followFriendCount === 1 ? 'played' : 'played'} this`
    : `${peopleCount} people ${verb}`

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
        <span className="trending-card__badge">{badge}</span>
      </div>
    </Pressable>
  )
}

export default TrendingCard
