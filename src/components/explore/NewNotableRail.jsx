import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useDiscoverGamesNew } from '../../hooks/useExploreData'
import CleanGameTile from './CleanGameTile'
import './SectionScaffold.css'

/**
 * NewNotableRail — Discover slot 3.
 *
 * ALREADY-RELEASED games from the last few months that clear one of two
 * notability lanes (AAA volume of attention, or acclaimed-indie quality —
 * see supabase/functions/new-notable/lanes.ts), taste-ordered, as covers and
 * titles with no numeric scores. Nothing upcoming: "New" means out, not
 * announced.
 *
 * Each tile carries a small lane pill ("Popular" / "Acclaimed") instead of a
 * number: it explains WHY a game is here without turning browsing into
 * judging.
 *
 * "See all" continues the same gated list, newest release first, at
 * /discover/new. Hides entirely when the cache has nothing rather than
 * showing an empty rail.
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
          <CleanGameTile key={game.id} game={game} tag={game.tag} />
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
