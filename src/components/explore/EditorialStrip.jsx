import React from 'react'
import './EditorialStrip.css'

function EditorialStrip({ stats, loading }) {
  if (loading) return null
  if (!stats) return null

  const parts = []
  if (stats.totalGamesLogged > 0) {
    parts.push(`${stats.totalGamesLogged} ${stats.totalGamesLogged === 1 ? 'game' : 'games'} in your library`)
  }
  if (stats.reviewsThisWeek > 0) {
    parts.push(`${stats.reviewsThisWeek} ${stats.reviewsThisWeek === 1 ? 'review' : 'reviews'} written this week`)
  }

  if (parts.length === 0) return null

  return (
    <div className="editorial-strip">
      <p className="editorial-strip__text">{parts.join(' \u00B7 ')}</p>
    </div>
  )
}

export default EditorialStrip
