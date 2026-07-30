import React from 'react'
import { useNavigate } from 'react-router-dom'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './GenrePosterCard.css'

/** IGDB's total_rating is 0-100; every rating badge in the app reads 0-5. */
function ratingLabel(totalRating) {
  const n = Number(totalRating)
  if (!Number.isFinite(n) || n <= 0) return null
  return (n / 20).toFixed(1)
}

/**
 * One poster tile in Your Gaming Map's genre detail grid and its "Good
 * places to start" strip. Real IGDB cover art + rating only — no fabricated
 * badges. Tapping opens the game's own detail page, same as any other
 * poster in the app.
 */
function GenrePosterCard({ game }) {
  const navigate = useNavigate()
  const rating = ratingLabel(game.totalRating)

  return (
    <Pressable
      as="div"
      className="genre-poster-card"
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/game/${game.id}`)}
      aria-label={`${game.title}${rating ? `, rated ${rating} out of 5` : ''}`}
    >
      <div className="genre-poster-card__cover">
        <img
          src={game.image || COVER_FALLBACK}
          alt=""
          loading="lazy"
          className="genre-poster-card__img"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
        {rating && <span className="genre-poster-card__rating">{rating}</span>}
      </div>
      <p className="genre-poster-card__title">{game.title}</p>
    </Pressable>
  )
}

export default GenrePosterCard
