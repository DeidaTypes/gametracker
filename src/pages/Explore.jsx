import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useFeaturedGame,
  useRecentReviews,
  useEditorialStats,
  useCurrentlyPlaying,
  useGenres,
} from '../hooks/useExploreData'
import SectionHeader from '../components/SectionHeader'
import HeroFeature from '../components/explore/HeroFeature'
import ReviewCard from '../components/explore/ReviewCard'
import EditorialStrip from '../components/explore/EditorialStrip'
import GenreTile from '../components/explore/GenreTile'
import GameCard from '../components/GameCard'
import './Explore.css'

function RowSkeleton({ count = 3, width = 280, height = 160 }) {
  return (
    <div className="explore-scroll-row">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ flex: `0 0 ${width}px`, width, minWidth: width, height, borderRadius: 14 }}
        />
      ))}
    </div>
  )
}

function GenreGridSkeleton() {
  return (
    <div className="explore-genre-grid">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton" style={{ aspectRatio: '1/1', borderRadius: 14 }} />
      ))}
    </div>
  )
}

function ExploreEmpty() {
  const navigate = useNavigate()
  return (
    <div className="explore-empty-state">
      <p className="explore-empty-state__title">Nothing to explore yet</p>
      <p className="explore-empty-state__body">Be the first to log a game and start building your library.</p>
      <button className="cta-button" onClick={() => navigate('/search')}>
        Find games
      </button>
    </div>
  )
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="explore-error-banner">
      <p>{message}</p>
      {onRetry && (
        <button className="explore-error-banner__retry" onClick={onRetry} type="button">
          Try again
        </button>
      )}
    </div>
  )
}

function Explore() {
  const navigate = useNavigate()
  const featured = useFeaturedGame()
  const reviews = useRecentReviews()
  const stats = useEditorialStats()
  const currentlyPlaying = useCurrentlyPlaying()
  const genres = useGenres()

  const anyLoading = featured.loading || reviews.loading || genres.loading
  const anyData = featured.data || reviews.data || stats.data || currentlyPlaying.data || genres.data
  const allDone = !featured.loading && !reviews.loading && !stats.loading && !currentlyPlaying.loading && !genres.loading

  if (allDone && !anyData && !featured.error && !genres.error) {
    return (
      <div className="explore-page">
        <ExploreEmpty />
      </div>
    )
  }

  let sectionIndex = 0

  return (
    <div className="explore-page">
      {/* Hero: featured game from real API */}
      {(featured.loading || featured.data) && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <HeroFeature game={featured.data} loading={featured.loading} />
        </section>
      )}
      {!featured.loading && featured.error && !featured.data && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <ErrorBanner message="Could not load featured game." />
          </div>
        </section>
      )}

      {/* Recent reviews from localStorage */}
      {!reviews.loading && reviews.data && reviews.data.length > 0 && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <SectionHeader
              title="Your recent reviews"
              action="See all"
              onAction={() => navigate('/reviews')}
            />
          </div>
          <div className="explore-scroll-row">
            {reviews.data.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        </section>
      )}
      {reviews.loading && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <SectionHeader title="Your recent reviews" />
          </div>
          <RowSkeleton count={3} width={280} height={160} />
        </section>
      )}

      {/* Editorial stat strip — real local counts */}
      {!stats.loading && stats.data && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <EditorialStrip stats={stats.data} loading={false} />
        </section>
      )}

      {/* Currently playing from local library */}
      {!currentlyPlaying.loading && currentlyPlaying.data && currentlyPlaying.data.length > 0 && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <SectionHeader
              title="Currently playing"
              action="See all"
              onAction={() => navigate('/currently-playing')}
            />
          </div>
          <div className="explore-scroll-row">
            {currentlyPlaying.data.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}

      {/* Browse by category — real data from RAWG/IGDB */}
      {(genres.loading || genres.data) && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <SectionHeader title="Browse by category" />
          </div>
          <div className="explore-section__pad">
            {genres.loading ? (
              <GenreGridSkeleton />
            ) : (
              <div className="explore-genre-grid">
                {genres.data.map((g) => (
                  <GenreTile key={g.key} genre={g} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}
      {!genres.loading && genres.error && !genres.data && (
        <section className={`explore-section explore-section--${sectionIndex++}`}>
          <div className="explore-section__pad">
            <ErrorBanner message="Could not load categories." />
          </div>
        </section>
      )}
    </div>
  )
}

export default Explore
