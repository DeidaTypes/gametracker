import React from 'react'
import './StarRating.css'

function StarRating({ rating, size = 20 }) {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 >= 0.25 // Show half star if rating is .25 or more
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0)

  return (
    <div className="star-rating-display">
      {/* Full stars */}
      {Array.from({ length: fullStars }).map((_, index) => (
        <svg
          key={`full-${index}`}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="rating-star full"
        >
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            fill="var(--star)"
            stroke="var(--star)"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}

      {/* Half star */}
      {hasHalfStar && (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="rating-star half"
        >
          <defs>
            <clipPath id={`half-clip-${rating}`}>
              <rect x="0" y="0" width="12" height="24" />
            </clipPath>
          </defs>
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            stroke="var(--star-empty)"
            strokeWidth="1.5"
            fill="none"
          />
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            fill="var(--star)"
            clipPath={`url(#half-clip-${rating})`}
          />
        </svg>
      )}

      {/* Empty stars */}
      {Array.from({ length: emptyStars }).map((_, index) => (
        <svg
          key={`empty-${index}`}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="rating-star empty"
        >
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            fill="none"
            stroke="var(--star-empty)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </div>
  )
}

export default StarRating

