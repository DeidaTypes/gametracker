import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './BrowseCard.css'

function BrowseCard({ category, index = 0 }) {
  const navigate = useNavigate()
  const [pressed, setPressed] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  const handleClick = () => {
    navigate(`/browse/${category.key}`)
  }

  return (
    <button
      className={`browse-card ${pressed ? 'browse-card--pressed' : ''}`}
      style={{
        backgroundColor: category.color,
        animationDelay: `${index * 60}ms`,
      }}
      onClick={handleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      type="button"
    >
      <span className="browse-card__label">{category.label}</span>

      {category.coverImage && (
        <img
          className={`browse-card__art ${imgLoaded ? 'browse-card__art--loaded' : ''}`}
          src={category.coverImage}
          alt=""
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )}
    </button>
  )
}

export default BrowseCard
