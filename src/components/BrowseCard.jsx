import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Pressable from './Pressable'
import './BrowseCard.css'

function BrowseCard({ category, index = 0 }) {
  const navigate = useNavigate()
  const [imgLoaded, setImgLoaded] = useState(false)

  const handleClick = () => {
    navigate(`/browse/${category.key}`)
  }

  return (
    <Pressable
      className="browse-card"
      style={{
        backgroundColor: category.color,
        animationDelay: `${index * 60}ms`,
      }}
      onClick={handleClick}
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
    </Pressable>
  )
}

export default BrowseCard
