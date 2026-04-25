import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CoverPlaceholder from './CoverPlaceholder'
import './GenreTile.css'

function GenreTile({ genre }) {
  const navigate = useNavigate()
  const [imgError, setImgError] = useState(false)

  return (
    <div
      className="genre-tile"
      onClick={() => navigate(`/browse/${genre.key}`)}
      role="link"
      tabIndex={0}
    >
      {genre.image && !imgError ? (
        <img
          className="genre-tile__bg"
          src={genre.image}
          alt=""
          onError={() => setImgError(true)}
        />
      ) : (
        <CoverPlaceholder title={genre.label} className="genre-tile__bg genre-tile__bg--placeholder" />
      )}
      <div className="genre-tile__overlay" />
      <div className="genre-tile__content">
        <h3 className="genre-tile__label">{genre.label}</h3>
        {genre.count > 0 && (
          <span className="genre-tile__count">{genre.count.toLocaleString()} games</span>
        )}
      </div>
    </div>
  )
}

export default GenreTile
