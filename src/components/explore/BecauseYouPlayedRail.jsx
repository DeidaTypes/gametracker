import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useBecauseYouPlayed } from '../../hooks/useExploreData'
import SharedCover from '../SharedCover'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './SectionScaffold.css'
import './BecauseYouPlayedRail.css'

function BecauseYouPlayedCard({ game, matchScore }) {
  const navigate = useNavigate()
  const img = game.image || COVER_FALLBACK

  return (
    <Pressable
      as="div"
      className="byp-card"
      onClick={() => navigate(`/game/${game.id}`)}
      aria-label={`View ${game.title} — ${Math.round(matchScore)}% match`}
    >
      <div className="byp-card__cover-wrap">
        <SharedCover gameId={game.id} imageSrc={img}>
          <img src={img} alt="" className="byp-card__cover" loading="lazy" />
        </SharedCover>
        <span className="byp-card__badge">{Math.round(matchScore)}% match</span>
      </div>
      <p className="byp-card__title">{game.title}</p>
    </Pressable>
  )
}

/**
 * BecauseYouPlayedRail — Discover page closer.
 *
 * NARROW + precise by design (the deliberate contrast with SwipeDeck,
 * which now draws broadly across the whole taste vector): every card here
 * is a real, taste-ranked E0 recommendation anchored to exactly ONE named
 * seed game — "if you loved {seed}, try these." Passive/scannable rail,
 * no swipe gestures or skip/backlog decision loop. Works from the user's
 * own library regardless of the follow graph.
 *
 * The seed shown here is one of the user's cached multi-seed set (up to
 * 10-15, precomputed by the daily job — see tasteEngineService). Every
 * mount/re-entry already rotates forward through that cached set; the
 * refresh control lets the user manually step to the NEXT cached seed on
 * demand, same forward sequence, so repeated taps walk through different
 * seeds rather than reshuffling randomly. Both paths read purely from
 * cache — neither ever triggers an IGDB call.
 *
 * Hides entirely when the engine has no qualifying seed for this user yet
 * (honest empty state, matching SwipeDeck's philosophy — never a
 * fabricated pick or seed).
 */
export default function BecauseYouPlayedRail() {
  const { data, loading, refetch } = useBecauseYouPlayed()
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
    <section className="explore-section shelf-scaffold" aria-label="Because you played">
      <div className="explore-section__pad shelf-scaffold__head byp-head">
        <div>
          <h2 className="discover-section-title">
            {loading ? 'Because you played\u2026' : `Because you played ${data.seed.title}`}
          </h2>
          <p className="shelf-scaffold__subtitle">If you loved it, try these next</p>
        </div>
        {!loading && data && (
          <button
            type="button"
            className={`byp-refresh-btn${refreshing ? ' byp-refresh-btn--spinning' : ''}`}
            onClick={handleRefresh}
            aria-label="Show a different seed's recommendations"
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
              <BecauseYouPlayedCard key={it.game.id} game={it.game} matchScore={it.matchScore} />
            ))}
      </div>
    </section>
  )
}
