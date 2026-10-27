import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollections } from '../../hooks/useExploreData'
import CollectionCard from './CollectionCard'
import DiscoverSectionHeader from './DiscoverSectionHeader'
import ReservedSlot from '../ReservedSlot'
import { Arrive } from '../motion/ContentSwap'
import './SectionScaffold.css'
import './CollectionCard.css'

// Zero-state rule for this rail specifically: a collection with fewer than
// 5 games reads as an abandoned/half-started list rather than a real
// curated pick, so it never surfaces here — regardless of curated or
// community origin. (The /discover/collections browse-all page is out of
// scope for this rule and keeps listService's own gameCount > 0 filter.)
const MIN_RAIL_GAME_COUNT = 5

const CURATED_LIMIT = 8
const COMMUNITY_LIMIT = 12

/**
 * CollectionsShelf — Discover "Collections" shelf.
 *
 * Renders curated ("by Checkpoint") lists mixed with popular public
 * community lists — each a 2×2 cover mosaic + title + curator + game
 * count + real save count. Tap a card to open the list; the section
 * header opens the full browse page at /discover/collections.
 *
 * Hides entirely (no header, no placeholder) when neither pool has a
 * qualifying list.
 */
function CollectionsPlaceholder() {
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
        {Array.from({ length: 2 }, (_, i) => (
          <div className="collection-card" key={i}>
            <div className="collection-card__mosaic">
              {Array.from({ length: 4 }, (_, cell) => (
                <div key={cell} className="collection-card__cell collection-card__cell--empty" />
              ))}
            </div>
            <div className="collection-card__body">
              <p className="collection-card__title">&nbsp;</p>
              <p className="collection-card__curator">&nbsp;</p>
              <p className="collection-card__meta">&nbsp;</p>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function CollectionsShelf() {
  const navigate = useNavigate()
  const { data, loading } = useCollections()

  const curated = data?.curated || []
  const community = data?.community || []

  const collections = useMemo(() => {
    return [...curated, ...community].filter((c) => c.gameCount >= MIN_RAIL_GAME_COUNT)
  }, [curated, community])

  const browseTotal = curated.length + community.length
  const totalKnown = curated.length < CURATED_LIMIT && community.length < COMMUNITY_LIMIT
  const totalCount = totalKnown ? browseTotal : null

  const open = loading || collections.length > 0

  return (
    <ReservedSlot open={open} className="explore-section">
      <Arrive ready={!loading && collections.length > 0} placeholder={<CollectionsPlaceholder />}>
      {!loading && collections.length > 0 ? (
    <section aria-label="Collections">
      <div className="explore-section__pad">
        <DiscoverSectionHeader
          title="Collections"
          subtitle="Curated lists worth playing through"
          visibleCount={collections.length}
          totalCount={totalCount}
          destinationLabel="Collections"
          onNavigate={() => navigate('/discover/collections')}
        />
      </div>

      <div className="explore-scroll-row">
        {collections.map((collection) => (
          <CollectionCard key={collection.id} collection={collection} />
        ))}
      </div>
    </section>
      ) : null}
      </Arrive>
    </ReservedSlot>
  )
}
