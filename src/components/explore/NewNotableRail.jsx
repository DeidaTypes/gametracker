import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useDiscoverGamesNew } from '../../hooks/useExploreData'
import CleanGameTile from './CleanGameTile'
import DiscoverSectionHeader from './DiscoverSectionHeader'
import ReservedSlot from '../ReservedSlot'
import { Arrive } from '../motion/ContentSwap'
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
 * The section header opens the same gated list, newest release first, at
 * /discover/new. Hides entirely when the cache has nothing rather than
 * showing an empty rail.
 */
function NewNotablePlaceholder() {
  return (
    <>
      <div className="explore-section__pad">
        <div className="discover-section-entry discover-section-entry--static">
          <div className="discover-section-entry__left">
            <h2 className="discover-section-title">&nbsp;</h2>
            <p className="discover-section-entry__subtitle">&nbsp;</p>
          </div>
        </div>
      </div>
      <div className="explore-scroll-row">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="clean-tile" key={i}>
            <div className="clean-tile__cover skeleton" />
            <span className="clean-tile__title">&nbsp;<br />&nbsp;</span>
          </div>
        ))}
      </div>
    </>
  )
}

export default function NewNotableRail() {
  const navigate = useNavigate()
  const { data, loading } = useDiscoverGamesNew()

  const games = data || []
  const open = loading || games.length > 0

  return (
    <ReservedSlot open={open} className="explore-section">
      <Arrive ready={!loading && games.length > 0} placeholder={<NewNotablePlaceholder />}>
      {!loading && games.length > 0 ? (
    <section aria-label="New & Notable">
      <div className="explore-section__pad">
        <DiscoverSectionHeader
          title="New & Notable"
          subtitle="Just released"
          visibleCount={games.length}
          totalCount={null}
          destinationLabel="New releases"
          onNavigate={() => navigate('/discover/new')}
        />
      </div>

      <div className="explore-scroll-row">
        {games.map((game) => (
          <CleanGameTile key={game.id} game={game} tag={game.tag} />
        ))}
      </div>
    </section>
      ) : null}
      </Arrive>
    </ReservedSlot>
  )
}
