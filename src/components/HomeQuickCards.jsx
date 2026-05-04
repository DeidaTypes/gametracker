import React from 'react'
import { useNavigate } from 'react-router-dom'
import './HomeQuickCards.css'

function HomeQuickCards({ wantToPlayCover }) {
  const navigate = useNavigate()

  return (
    <div className="hqc-row">
      <button
        className="hqc-card hqc-card--wtp"
        onClick={() => navigate('/library')}
      >
        <div className="hqc-card-header">
          <span className="hqc-card-title">Want to Play</span>
          <span className="hqc-card-chevron">›</span>
        </div>
        <div className="hqc-wtp-body">
          {wantToPlayCover ? (
            <img
              src={wantToPlayCover}
              alt=""
              className="hqc-wtp-cover"
              onError={(e) => {
                e.target.style.display = 'none'
              }}
            />
          ) : (
            <div className="hqc-wtp-placeholder">
              <span className="hqc-wtp-placeholder-icon">🎯</span>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

export default HomeQuickCards
