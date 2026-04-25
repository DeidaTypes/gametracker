import React from 'react'
import './StatPills.css'

/**
 * StatPills — a row of metric pill cards showing library statistics.
 * Props:
 *   stats — { gamesPlayed, hoursPlayed, completed, reviews }
 */
function StatPills({ stats }) {
  const pills = [
    { value: stats.gamesPlayed, label: 'Played' },
    { value: stats.hoursPlayed, label: 'Hours' },
    { value: stats.completed, label: 'Finished' },
    { value: stats.reviews, label: 'Reviews' },
  ]

  return (
    <div className="stat-pills-row">
      {pills.map(({ value, label }) => (
        <div key={label} className="stat-pill">
          <span className="stat-pill-value">{value}</span>
          <span className="stat-pill-label">{label}</span>
        </div>
      ))}
    </div>
  )
}

export default StatPills
