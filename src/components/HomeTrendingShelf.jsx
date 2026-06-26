import React, { useEffect, useRef, useState } from 'react'
import TrendingCard from './explore/TrendingCard'
import { getTrendingThisWeek } from '../services/communityService'
import './HomeTrendingShelf.css'

/**
 * HomeTrendingShelf — horizontal poster shelf of globally trending games.
 *
 * Fetches from `getTrendingThisWeek` (same data as Discover's trending tab).
 * Renders nothing when loading is complete but the community has no activity
 * data yet (no phantom empty shelves).
 */
export default function HomeTrendingShelf() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    getTrendingThisWeek(12)
      .then((data) => setItems(data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="hts-section" aria-hidden="true">
        <div className="hts-header">
          <div className="skeleton hts-sk-title" />
        </div>
        <div className="hts-rail">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="hts-sk-card">
              <div className="skeleton hts-sk-cover" />
              <div className="skeleton hts-sk-label" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) return null

  return (
    <section className="hts-section" aria-label="Trending this week">
      <div className="hts-header">
        <h2 className="hts-title">Trending this week</h2>
      </div>
      <div
        className="hts-rail"
        role="list"
        aria-label="Trending games"
      >
        {items.map((entry) => (
          <div key={entry.game.id} role="listitem">
            <TrendingCard entry={entry} />
          </div>
        ))}
      </div>
    </section>
  )
}
