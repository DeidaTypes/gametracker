import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveThemedDrop } from '../../hooks/useExploreData'
import { nextDropLabel } from '../../utils/dropSchedule'
import { getBestImageUrl } from '../../services/imageUtils'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import Pressable from '../Pressable'
import ReservedSlot from '../ReservedSlot'
import './ThemedDropCard.css'

// Four covers is enough to read the theme at a glance; the rest are a
// count, not a scroll. The whole point of the slot is one tight card.
const PREVIEW_COUNT = 4

/**
 * ThemedDropCard — Discover slot 2, directly under the swipe deck.
 *
 * One card for the one drop that is live right now: kicker, theme, a
 * one-line pitch, four covers and how many more are inside. Tapping it
 * opens the full drop at /discover/drop.
 *
 * Nothing here decides what the drop is — the theme, its copy and its
 * games all come from getActiveThemedDrop(), which reads a schedule the
 * themed-drops job wrote days ago. When no drop is live the section is
 * absent, not empty: a placeholder would teach people the slot is
 * decoration, and the drop only works if its presence means something.
 */
function ThemedDropPlaceholder() {
  return (
    <div className="explore-section__pad">
      <div className="themed-drop-card" aria-hidden="true">
        <div className="themed-drop-card__top">
          <span className="themed-drop-card__kicker">&nbsp;</span>
        </div>
        <h2 className="themed-drop-card__title">&nbsp;</h2>
        <p className="themed-drop-card__subtitle">&nbsp;</p>
        <div className="themed-drop-card__covers">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="themed-drop-card__cover skeleton" key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ThemedDropCard() {
  const navigate = useNavigate()
  const { data: drop, loading } = useActiveThemedDrop()

  const games = drop?.games || []
  const hasDrop = !loading && drop?.active && drop.theme && games.length > 0
  const open = loading || hasDrop

  const preview = games.slice(0, PREVIEW_COUNT)
  const remaining = games.length - preview.length
  const nextDrop = hasDrop ? nextDropLabel(drop.expiresAt) : null

  return (
    <ReservedSlot open={open} className="explore-section">
      {!hasDrop ? (
        <ThemedDropPlaceholder />
      ) : (
    <section aria-label="This week's drop">
      <div className="explore-section__pad">
        <Pressable
          className="themed-drop-card"
          onClick={() => navigate('/discover/drop')}
          aria-label={`Open this week's drop: ${drop.theme.displayName}`}
        >
          <div className="themed-drop-card__top">
            <span className="themed-drop-card__kicker">This week&apos;s drop</span>
            {nextDrop && (
              <span className="themed-drop-card__next">{nextDrop}</span>
            )}
          </div>

          <h2 className="themed-drop-card__title">{drop.theme.displayName}</h2>
          {drop.theme.subtitle && (
            <p className="themed-drop-card__subtitle">{drop.theme.subtitle}</p>
          )}

          <div className="themed-drop-card__covers">
            {preview.map((game) => (
              <div className="themed-drop-card__cover" key={game.id}>
                <img
                  src={getBestImageUrl(game, 74) || COVER_FALLBACK}
                  alt=""
                  width={74}
                  height={111}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
                />
              </div>
            ))}
            {remaining > 0 && (
              <div className="themed-drop-card__more">+{remaining}</div>
            )}
          </div>
        </Pressable>
      </div>
    </section>
      )}
    </ReservedSlot>
  )
}
