import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useDiscoverGamesNew } from '../../hooks/useExploreData'
import CleanGameTile from './CleanGameTile'
import './SectionScaffold.css'

/**
 * NewNotableRail — Discover slot 3.
 *
 * Recent releases, newest first, as covers and titles — no scores. A new
 * game hasn't been rated by enough people to mean anything yet, so a
 * number here would be noise pretending to be a signal.
 *
 * "See all" continues the same list backward in time at /discover/new.
 * Hides entirely when IGDB returns nothing rather than showing an empty
 * rail.
 */
export default function NewNotableRail() {
  const navigate = useNavigate()
  const { data, loading } = useDiscoverGamesNew()

  const games = data || []
  if (loading || games.length === 0) return null

  return (
    <section className="explore-section" aria-label="New & Notable">
      <div className="explore-section__pad shelf-scaffold__head">
        <h2 className="discover-section-title">New &amp; Notable</h2>
        <p className="shelf-scaffold__subtitle">Just released</p>
      </div>

      <div className="explore-scroll-row">
        {games.map((game) => (
          <CleanGameTile key={game.id} game={game} />
        ))}
      </div>

      <button
        type="button"
        className="discover-see-all-btn"
        onClick={() => navigate('/discover/new')}
      >
        See all new releases
        <ChevronRight size={16} className="discover-see-all-btn__chevron" aria-hidden="true" />
      </button>
    </section>
  )
}
