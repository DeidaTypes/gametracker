import React from 'react'
import GameCard from './GameCard'
import './CoverGridTile.css'

/**
 * A game cover with its title and year under it. The title never sits on the
 * cover, so it reads on every theme. The cover keeps GameCard's tap and
 * shared-element push; the text block always holds two title lines, so every
 * tile in a row is the same height whether or not its title wraps (and a
 * skeleton tile is exactly the size of a real one).
 *
 * Used by the genre pages and the Developer page; lay tiles out in a grid and
 * give it the columns.
 */
function CoverGridTile({ game }) {
  return (
    <div className="cover-grid-tile">
      <GameCard game={game} titleOverlay={false} />
      <div className="cover-grid-tile__meta">
        <span className="cover-grid-tile__title">{game.title}</span>
        {game.year ? <span className="cover-grid-tile__year">{game.year}</span> : null}
      </div>
    </div>
  )
}

/** The final size of a CoverGridTile, for a loading grid. */
export function CoverGridTileSkeleton() {
  return (
    <div className="cover-grid-tile" aria-hidden="true">
      <div className="cover-grid-tile__cover skeleton" />
      <div className="cover-grid-tile__meta">
        <span className="cover-grid-tile__bar cover-grid-tile__bar--title skeleton" />
        <span className="cover-grid-tile__bar cover-grid-tile__bar--year skeleton" />
      </div>
    </div>
  )
}

export default CoverGridTile
