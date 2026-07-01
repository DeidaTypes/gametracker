import React from 'react'
import { useNavigate } from 'react-router-dom'
import './CollectionCard.css'

function curatorName(collection) {
  if (collection.isCurated) return collection.curatorLabel || 'Checkpoint'
  return (
    collection.owner?.displayName?.trim() ||
    collection.owner?.username?.trim() ||
    'Unknown'
  )
}

/**
 * CollectionCard — 2×2 cover mosaic + title + curator + game count + save
 * count. Shared by the Discover "Collections" shelf and the
 * `/discover/collections` browse-all page — do not fork.
 *
 * Tap navigates straight to the list detail page. Curated ("by Checkpoint")
 * cards get a small badge; community cards show the owner's name instead.
 */
export default function CollectionCard({ collection }) {
  const navigate = useNavigate()
  const covers = collection.previewGames || []

  return (
    <button
      type="button"
      className="collection-card"
      onClick={() => navigate(`/list/${collection.id}`)}
      aria-label={`${collection.name} — ${collection.gameCount} game${collection.gameCount !== 1 ? 's' : ''}, ${collection.isCurated ? 'curated by' : 'by'} ${curatorName(collection)}`}
    >
      <div className="collection-card__mosaic">
        {Array.from({ length: 4 }, (_, i) => {
          const game = covers[i]
          return (
            <div
              key={i}
              className={`collection-card__cell${game?.image ? '' : ' collection-card__cell--empty'}`}
            >
              {game?.image && <img src={game.image} alt="" loading="lazy" />}
            </div>
          )
        })}
        {collection.isCurated && (
          <span className="collection-card__badge">Checkpoint</span>
        )}
      </div>

      <div className="collection-card__body">
        <p className="collection-card__title">{collection.name}</p>
        <p className="collection-card__curator">
          {collection.isCurated ? `Curated by ${curatorName(collection)}` : curatorName(collection)}
        </p>
        <p className="collection-card__meta">
          {collection.gameCount} game{collection.gameCount !== 1 ? 's' : ''}
          <span className="collection-card__dot" aria-hidden="true">·</span>
          {collection.saveCount} save{collection.saveCount !== 1 ? 's' : ''}
        </p>
      </div>
    </button>
  )
}
