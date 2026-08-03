import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers } from 'lucide-react'
import CollectionCard from '../components/explore/CollectionCard'
import EmptyState from '../components/EmptyState'
import { useCollections } from '../hooks/useExploreData'
import './DiscoverCollectionsAll.css'

function SkeletonTile() {
  return (
    <div className="dca-skeleton-tile" aria-hidden="true">
      <div className="dca-sk-mosaic skeleton" />
      <div className="dca-sk-line skeleton" style={{ width: '70%' }} />
      <div className="dca-sk-line skeleton" style={{ width: '45%' }} />
    </div>
  )
}

function CollectionGrid({ items }) {
  return (
    <div className="collections-browse-grid">
      {items.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} />
      ))}
    </div>
  )
}

/**
 * DiscoverCollectionsAll — "See all" destination for the Discover
 * Collections shelf. Route: /discover/collections.
 *
 * Two sections: curated ("by Checkpoint") collections, then popular
 * community lists ranked by real save count. Same non-empty / public /
 * non-blocked filtering as the shelf — a section with nothing to show
 * simply doesn't render.
 */
export default function DiscoverCollectionsAll() {
  const navigate = useNavigate()
  const { data, loading } = useCollections()

  const curated = data?.curated || []
  const community = data?.community || []
  const isEmpty = !loading && curated.length === 0 && community.length === 0

  return (
    <div className="dca-page">
      <div className="dca-header">
        <button
          className="dca-header-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="dca-header-title">Collections</h1>
        <div className="dca-header-spacer" aria-hidden="true" />
      </div>

      <div className="dca-content">
        {loading ? (
          <div className="collections-browse-grid">
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
          </div>
        ) : isEmpty ? (
          <EmptyState icon={Layers} body="No collections yet — check back later." />
        ) : (
          <>
            {curated.length > 0 && (
              <section className="dca-section">
                <h2 className="dca-section-title">Curated by Checkpoint</h2>
                <CollectionGrid items={curated} />
              </section>
            )}

            {community.length > 0 && (
              <section className="dca-section">
                <h2 className="dca-section-title">From the community</h2>
                <CollectionGrid items={community} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
