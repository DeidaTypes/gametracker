import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCollections } from '../../hooks/useExploreData'
import CollectionCard from './CollectionCard'
import './SectionScaffold.css'
import './CollectionCard.css'

// Zero-state rule for this rail specifically: a collection with fewer than
// 5 games reads as an abandoned/half-started list rather than a real
// curated pick, so it never surfaces here — regardless of curated or
// community origin. (The /discover/collections browse-all page is out of
// scope for this rule and keeps listService's own gameCount > 0 filter.)
const MIN_RAIL_GAME_COUNT = 5

/**
 * CollectionsShelf — Discover "Collections" shelf.
 *
 * Renders curated ("by Checkpoint") lists mixed with popular public
 * community lists — each a 2×2 cover mosaic + title + curator + game
 * count + real save count. Tap a card to open the list; "See all" opens
 * the full browse page at /discover/collections.
 *
 * Hides entirely (no header, no placeholder) when neither pool has a
 * qualifying list.
 */
export default function CollectionsShelf() {
  const navigate = useNavigate()
  const { data, loading } = useCollections()

  const collections = useMemo(() => {
    const curated = data?.curated || []
    const community = data?.community || []
    return [...curated, ...community].filter((c) => c.gameCount >= MIN_RAIL_GAME_COUNT)
  }, [data])

  if (loading || collections.length === 0) return null

  return (
    <section className="explore-section" aria-label="Collections">
      <div className="explore-section__pad shelf-scaffold__head">
        <div>
          <h2 className="discover-section-title">Collections</h2>
          <p className="shelf-scaffold__subtitle">Curated lists worth playing through</p>
        </div>
      </div>

      <div className="explore-scroll-row">
        {collections.map((collection) => (
          <CollectionCard key={collection.id} collection={collection} />
        ))}
      </div>

      <button
        type="button"
        className="discover-see-all-btn"
        onClick={() => navigate('/discover/collections')}
      >
        See all collections
        <ChevronRight size={16} className="discover-see-all-btn__chevron" aria-hidden="true" />
      </button>
    </section>
  )
}
