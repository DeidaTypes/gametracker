import React from 'react'
import { useRecentFollowingActivity } from '../../hooks/useExploreData'
import RecentActivityCard from './RecentActivityCard'
import './SectionScaffold.css'
import './RecentActivityCard.css'

/**
 * FollowingShelf — Discover "From people you follow" → "Recently" feed.
 *
 * Real follow-graph activity: RATINGS + REVIEWS only (no list-adds —
 * Collections owns that surface). Each card shows the actor, the action,
 * a tappable game object, an algorithmic taste-match strip (hidden below
 * the engine's confidence threshold), and contextual actions (Add to
 * backlog, react, reply).
 *
 * Never empty when the platform has any qualifying activity — falls back
 * to broader community ratings/reviews when the viewer follows no one or
 * their circle has been quiet (see communityService.getRecentFollowingActivity).
 */
export default function FollowingShelf() {
  const { data, loading } = useRecentFollowingActivity()
  const items = data?.items || []
  const scope = data?.scope || 'following'

  if (!loading && items.length === 0) return null

  return (
    <section className="explore-section shelf-scaffold" aria-label="From people you follow">
      <div className="explore-section__pad shelf-scaffold__head">
        <div>
          <h2 className="discover-section-title">From people you follow</h2>
          <p className="shelf-scaffold__subtitle">
            {scope === 'community'
              ? 'Recently: ratings & reviews from the community'
              : 'Recently: ratings & reviews from your circle'}
          </p>
        </div>
      </div>

      <div className="explore-section__pad recent-activity-list">
        {loading
          ? Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="shelf-scaffold__placeholder shelf-scaffold__placeholder--tall"
                aria-hidden="true"
              />
            ))
          : items.map((item) => <RecentActivityCard key={item.id} item={item} />)}
      </div>
    </section>
  )
}
