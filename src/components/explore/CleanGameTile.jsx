import React from 'react'
import { useNavigate } from 'react-router-dom'
import { getBestImageUrl } from '../../services/imageUtils'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './CleanGameTile.css'

/**
 * A cover and a title. Nothing else.
 *
 * Explore carries no scores — not on a rail, not on a card, not on any of
 * its see-all grids. A number under a cover turns browsing into judging,
 * and Discover exists for the games you haven't judged yet. Ratings live
 * on the game detail page, one tap away, where they're being asked for.
 *
 * Shared by the themed-drop grid, the New & Notable rail and its see-all
 * grid so those three surfaces cannot drift apart. Width is the caller's
 * business: the tile fills its slot, and `.explore-scroll-row` /
 * `.clean-tile-grid` below set the slot.
 */
export default function CleanGameTile({ game }) {
  const navigate = useNavigate()

  const image = getBestImageUrl(game, 400) || game.image || COVER_FALLBACK
  const title = game.title || game.name

  return (
    <Pressable
      className="clean-tile"
      onClick={() => navigate(`/game/${game.id}`, { state: { coverImage: image } })}
      aria-label={`View ${title}`}
    >
      <div className="clean-tile__cover">
        <SharedCover gameId={game.id} imageSrc={image}>
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
          />
        </SharedCover>
      </div>
      <span className="clean-tile__title">{title}</span>
    </Pressable>
  )
}
