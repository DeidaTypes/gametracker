import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronRight } from 'react-icons/lu'
import StarRating from './StarRating'
import './HomeShelf.css'
import './ProfileReviewsShelf.css'

/**
 * ProfileReviewsShelf — Section A on the profile Home tab.
 *
 * Renders a horizontal, scroll-snapped rail of compact review tiles:
 * game cover → game title → star rating. Tapping a tile routes to
 * the review detail page when the review has a body, or to the game
 * detail page when it is a rating-only entry.
 *
 * Hidden entirely (returns null) when the user has no reviews.
 *
 * Props:
 *   reviews    — array of review objects shaped by rowToReviewCard
 *   onSeeAll   — callback for the header ">" chevron (routes to Reviews tab)
 */
function ProfileReviewsShelf({ reviews, onSeeAll }) {
  const navigate = useNavigate()
  if (!reviews || reviews.length === 0) return null

  return (
    <div className="shelf-box">
      <div className="shelf-head">
        <h2 className="shelf-title">Recent Activity</h2>
        <button
          type="button"
          className="shelf-link"
          onClick={onSeeAll}
          aria-label="See all reviews"
        >
          <LuChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="shelf-rail" role="list">
        {reviews.slice(0, 10).map((review) => {
          const hasBody = !!(review.body || '').trim()
          const handleTap = () => {
            if (hasBody) {
              navigate(`/reviews/${review.id}/comments`)
            } else {
              navigate(`/game/${review.game?.id}`)
            }
          }

          return (
            <button
              key={review.id}
              type="button"
              role="listitem"
              className="shelf-cover-card"
              onClick={handleTap}
              aria-label={`${review.game?.name ?? 'Game'}${review.rating > 0 ? ` — ${review.rating} stars` : ''}`}
            >
              <div className="shelf-cover-wrap">
                {review.game?.coverUrl ? (
                  <img
                    src={review.game.coverUrl}
                    className="shelf-cover-img"
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="shelf-cover-fallback" aria-hidden="true">
                    {(review.game?.name || '?').charAt(0)}
                  </div>
                )}
              </div>
              <span className="shelf-cover-title">{review.game?.name}</span>
              {review.rating > 0 && (
                <div className="prs-stars" aria-hidden="true">
                  <StarRating rating={review.rating} size={11} />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ProfileReviewsShelf
