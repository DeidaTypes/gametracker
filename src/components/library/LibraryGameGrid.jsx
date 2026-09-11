import React from 'react'
import SharedCover from '../SharedCover'
import { COVER_FALLBACK } from '../../utils/coverFallback'

export function LibraryGameCard({
  game,
  onClick,
  cardRef,
  coverRef,
  cardClassName = '',
  coverClassName = '',
  onCoverPointerDown,
  onCoverPointerMove,
  onCoverPointerUp,
  onCoverPointerCancel,
}) {
  return (
    <button
      ref={cardRef}
      type="button"
      className={`lib-gamecard${cardClassName ? ` ${cardClassName}` : ''}`}
      onClick={onClick}
      aria-label={game.title ? `Open ${game.title}` : 'Open game'}
    >
      <div
        ref={coverRef}
        className={`lib-cov${coverClassName ? ` ${coverClassName}` : ''}`}
        onPointerDown={onCoverPointerDown}
        onPointerMove={onCoverPointerMove}
        onPointerUp={onCoverPointerUp}
        onPointerCancel={onCoverPointerCancel}
      >
        <SharedCover gameId={game.id} imageSrc={game.image || COVER_FALLBACK}>
          <img
            src={game.image || COVER_FALLBACK}
            alt=""
            className="lib-cov-img"
            loading="lazy"
            draggable={false}
            onError={(e) => { e.target.src = COVER_FALLBACK }}
          />
        </SharedCover>
      </div>
      <p className="lib-gamecard-title">{game.title || '—'}</p>
    </button>
  )
}

export default function LibraryGameGrid({
  games,
  onGameClick,
  gridRef,
  dragging = false,
  hasMore = false,
  onLoadMore,
  renderCard,
  ariaLabel = 'Games',
}) {
  return (
    <>
      <div
        className={`lib-grid3${dragging ? ' lib-grid3--dragging' : ''}`}
        ref={gridRef}
        aria-label={ariaLabel}
      >
        {renderCard
          ? games.map(renderCard)
          : games.map((g) => (
              <LibraryGameCard
                key={g.id}
                game={g}
                onClick={() => onGameClick?.(g)}
              />
            ))}
      </div>
      {hasMore && (
        <button
          type="button"
          className="lib-loadmore"
          onClick={onLoadMore}
        >
          Show more
        </button>
      )}
    </>
  )
}
