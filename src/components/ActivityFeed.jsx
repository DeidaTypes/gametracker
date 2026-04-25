import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRecentActivity, clearActivity, formatActivityMessage } from '../services/activityService'
import './ActivityFeed.css'

const TYPE_ICONS = {
  review: '★',
  hours_logged: '⏱',
  status_change: '↗',
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function ActivityFeed({ limit = 10 }) {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])

  useEffect(() => {
    const load = () => setEvents(getRecentActivity(limit))
    load()

    window.addEventListener('activityUpdated', load)
    window.addEventListener('reviewAdded', load)
    window.addEventListener('libraryUpdated', load)
    return () => {
      window.removeEventListener('activityUpdated', load)
      window.removeEventListener('reviewAdded', load)
      window.removeEventListener('libraryUpdated', load)
    }
  }, [limit])

  if (events.length === 0) {
    return (
      <div className="activity-feed-empty">
        <p>No activity yet. Rate a game, log some hours, or update your library to get started.</p>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      <ul className="activity-feed-list">
        {events.map((event) => (
          <li
            key={event.id}
            className={`activity-feed-item activity-feed-item--${event.type}`}
            onClick={() => navigate(`/game/${event.gameId}`)}
          >
            <span className="activity-feed-icon">{TYPE_ICONS[event.type] || '•'}</span>
            <div className="activity-feed-body">
              <span className="activity-feed-message">{formatActivityMessage(event)}</span>
              <span className="activity-feed-time">{timeAgo(event.timestamp)}</span>
            </div>
          </li>
        ))}
      </ul>
      <button className="activity-feed-clear" onClick={(e) => { e.stopPropagation(); clearActivity(); }}>
        Clear History
      </button>
    </div>
  )
}

export default ActivityFeed
