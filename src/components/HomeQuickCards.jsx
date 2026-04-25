import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRecentActivity } from '../services/activityService'
import './HomeQuickCards.css'

function buildHeatmap() {
  const events = getRecentActivity(50)
  const today = new Date()
  const grid = []

  for (let i = 27; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const count = events.filter(
      (e) => e.timestamp && e.timestamp.slice(0, 10) === key,
    ).length
    grid.push({ date: key, count })
  }

  return grid
}

function HeatmapGrid() {
  const grid = useMemo(buildHeatmap, [])

  return (
    <div className="hqc-heatmap">
      {grid.map((cell) => (
        <div
          key={cell.date}
          className={`hqc-cell hqc-cell--${Math.min(cell.count, 4)}`}
          title={`${cell.date}: ${cell.count} activities`}
        />
      ))}
    </div>
  )
}

function HomeQuickCards({ wantToPlayCover }) {
  const navigate = useNavigate()

  return (
    <div className="hqc-row">
      {/* Want to Play card */}
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

      {/* Stats card */}
      <button
        className="hqc-card hqc-card--stats"
        onClick={() => navigate('/profile')}
      >
        <div className="hqc-card-header">
          <span className="hqc-card-title">Stats</span>
          <span className="hqc-card-chevron">›</span>
        </div>
        <div className="hqc-stats-body">
          <HeatmapGrid />
        </div>
      </button>
    </div>
  )
}

export default HomeQuickCards
