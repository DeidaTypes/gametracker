import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Heart } from 'lucide-react'
import { useHiddenGems } from '../../hooks/useExploreData'
import { addGameToBacklog } from '../../services/libraryService'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './SectionScaffold.css'
import './HiddenGemsRail.css'

/**
 * The one line of real signal a hidden-gem card is allowed to show:
 * "94% loved it · only 812 ratings" — built straight from
 * totalRating/totalRatingCount, never a fabricated match percentage.
 * Returns null if either number is missing so the card never prints a
 * half-true line.
 */
function ratingSignalLine(totalRating, totalRatingCount) {
  if (totalRating == null || totalRatingCount == null) return null
  const pct = Math.round(totalRating)
  const count = Math.round(totalRatingCount)
  return `${pct}% loved it · only ${count.toLocaleString()} rating${count === 1 ? '' : 's'}`
}

function HiddenGemCard({ game, matchedTag }) {
  const navigate = useNavigate()
  const img = game.image || COVER_FALLBACK
  const [added, setAdded] = useState(false)
  const [adding, setAdding] = useState(false)
  const signal = ratingSignalLine(game.totalRating, game.totalRatingCount)

  const handleBacklog = async (e) => {
    e.stopPropagation()
    if (adding || added) return
    setAdding(true)
    const ok = await addGameToBacklog({ id: game.id, title: game.title, image: game.image })
    setAdding(false)
    if (ok) setAdded(true)
  }

  return (
    <Pressable
      as="div"
      className="hidden-gem-card"
      onClick={() => navigate(`/game/${game.id}`)}
      aria-label={`View ${game.title}${signal ? `. ${signal}` : ''}`}
    >
      <div className="hidden-gem-card__cover-wrap">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img src={img} alt="" className="hidden-gem-card__cover" loading="lazy" />
        </SharedCover>
        <button
          type="button"
          className={`hidden-gem-card__backlog-btn${added ? ' hidden-gem-card__backlog-btn--added' : ''}`}
          onClick={handleBacklog}
          disabled={adding || added}
          aria-label={added ? `${game.title} added to backlog` : `Add ${game.title} to backlog`}
        >
          <Heart size={15} aria-hidden="true" fill={added ? 'currentColor' : 'none'} />
        </button>
        {matchedTag && <span className="hidden-gem-card__tag">{matchedTag}</span>}
      </div>
      <p className="hidden-gem-card__title">{game.title}</p>
      {signal && <p className="hidden-gem-card__signal">{signal}</p>}
    </Pressable>
  )
}

/**
 * HiddenGemsRail — Discover page closer.
 *
 * Replaces "Because you played X". Instead of anchoring to one seed
 * game's IGDB similar_games (which kept surfacing titles the user
 * already knew — a mid-70s match % on a mainstream game carries no
 * information), every card here is a high-total_rating, LOW-
 * total_rating_count game scoped to one of the genres/themes the user's
 * OWN behavioral taste vector actually shows affinity for — a
 * niche-indie player gets indies, a sports player gets sports, a horror
 * fan gets horror (see getTasteVector / getHiddenGems).
 *
 * Each card shows the real signal, never an invented number: "94% loved
 * it · only 812 ratings", built straight from totalRating/
 * totalRatingCount. A small pill names the exact affinity (e.g. "Indie",
 * "Sport") this pick matched, so the section visibly tracks the user's
 * own behavior rather than a black-box score.
 *
 * The refresh control and every mount/resume advance a persisted
 * per-user cursor through fixed-size SLICES of the user's cached pool —
 * same forward, non-random sequence as the old rail's seed rotation,
 * just over rank order instead of seeds. Purely a cache read; NEVER
 * calls IGDB. Hides entirely when the engine has too little behavioral
 * signal to personalize for this user (honest empty state — never a
 * fallback to generic popular games).
 */
export default function HiddenGemsRail() {
  const { data, loading, refetch } = useHiddenGems()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refetch()
    } catch {
      // soft-fail — rail just keeps showing whatever it already had
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, refetch])

  if (!loading && !data) return null

  return (
    <section className="explore-section shelf-scaffold" aria-label="Hidden gems for you">
      <div className="explore-section__pad shelf-scaffold__head hg-head">
        <div>
          <h2 className="discover-section-title">Hidden gems for you</h2>
          <p className="shelf-scaffold__subtitle">Loved by a few, matched to your taste</p>
        </div>
        {!loading && data && (
          <button
            type="button"
            className={`hg-refresh-btn${refreshing ? ' hg-refresh-btn--spinning' : ''}`}
            onClick={handleRefresh}
            aria-label="Show a different set of hidden gems"
            disabled={refreshing}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="explore-scroll-row">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="explore-poster-skeleton shelf-scaffold__placeholder"
                aria-hidden="true"
              />
            ))
          : data.items.map((it) => (
              <HiddenGemCard key={it.game.id} game={it.game} matchedTag={it.matchedTag} />
            ))}
      </div>
    </section>
  )
}
