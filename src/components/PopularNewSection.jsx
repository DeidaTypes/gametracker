import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { fetchPopularThisWeek, fetchNewThisWeek } from '../services/igdb'
import './PopularNewSection.css'

/**
 * Sprint 5 P5 — Home → Popular / New This Week.
 *
 * Visual structure:
 *   ┌─ tab row ───────────────────────────── chevron-right ─┐
 *   │  Popular   New                                        │
 *   ├──────────────────────────────────────────────────────┤
 *   │  [cover] [cover] [cover] …  (horizontal, snap, 8)    │
 *   └──────────────────────────────────────────────────────┘
 *
 * Both Popular and New are pre-fetched in parallel on mount via
 * Promise.all so the toggle is instant. Skeleton (8 placeholder covers)
 * is shown while the initial fetch is in flight.
 *
 * Cover tap → /game/:id
 * Chevron tap → /trending (Popular) or /new-releases (New)
 */
const COVER_PLACEHOLDERS = Array.from({ length: 8 }, (_, i) => i)

function PopularNewSection() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('popular')
  const [popular, setPopular] = useState(null)
  const [news, setNews] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchPopularThisWeek(), fetchNewThisWeek()])
      .then(([pop, fresh]) => {
        if (cancelled) return
        setPopular(pop || [])
        setNews(fresh || [])
      })
      .catch((err) => {
        console.error('[PopularNewSection] prefetch failed:', err)
        if (!cancelled) {
          setPopular([])
          setNews([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const games = tab === 'popular' ? popular : news
  const initialLoading = popular === null || news === null

  const handleChevron = () => {
    navigate(tab === 'popular' ? '/trending' : '/new-releases')
  }

  return (
    <section
      className="pn-section"
      aria-labelledby="pn-section-heading"
    >
      <h2 id="pn-section-heading" className="sr-only">
        Popular and new this week
      </h2>

      <div className="pn-tab-row">
        <div className="pn-tabs" role="tablist" aria-label="Popular or new">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'popular'}
            className={`pn-tab${tab === 'popular' ? ' pn-tab--active' : ''}`}
            onClick={() => setTab('popular')}
          >
            Popular
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'new'}
            className={`pn-tab${tab === 'new' ? ' pn-tab--active' : ''}`}
            onClick={() => setTab('new')}
          >
            New
          </button>
        </div>

        <button
          type="button"
          className="pn-chevron-btn"
          onClick={handleChevron}
          aria-label={
            tab === 'popular' ? 'See all trending games' : 'See all new releases'
          }
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="pn-row" role="list">
        {initialLoading
          ? COVER_PLACEHOLDERS.map((i) => (
              <div className="pn-card pn-card--skeleton" key={`sk-${i}`} role="listitem" aria-hidden="true">
                <div className="skeleton pn-card__cover" />
                <div className="skeleton pn-card__line" />
                <div className="skeleton pn-card__line pn-card__line--short" />
              </div>
            ))
          : games.length === 0
            ? (
              <div className="pn-empty">
                Nothing to show yet.
              </div>
            )
            : games.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className="pn-card"
                  role="listitem"
                  onClick={() => navigate(`/game/${g.id}`)}
                >
                  <div className="pn-card__cover-wrap">
                    <img
                      src={g.coverUrl}
                      className="pn-card__cover"
                      alt=""
                      loading="lazy"
                    />
                  </div>
                  <div className="pn-card__name" title={g.name}>
                    {g.name}
                  </div>
                  {g.rating != null && (
                    <div className="pn-card__rating">
                      {g.rating.toFixed(1)}
                    </div>
                  )}
                </button>
              ))}
      </div>
    </section>
  )
}

export default PopularNewSection
