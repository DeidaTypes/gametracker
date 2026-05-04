import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import SharedCover from './SharedCover'
import './HeroCurrentlyPlaying.css'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getTimeOfDayLabel() {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) return 'MORNING SESSION'
  if (h >= 12 && h < 18) return 'PICK UP WHERE YOU LEFT OFF'
  if (h >= 18 && h < 23) return 'TONIGHT\'S GAME'
  return 'ONE MORE LEVEL'
}

function humanTimeAgo(dateStr) {
  if (!dateStr) return null
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
  } catch {
    return null
  }
}

/**
 * Swap the IGDB image-size token in a URL.
 * e.g. upgradeIgdbUrl(url, 't_1080p') for the blurred background
 *      upgradeIgdbUrl(url, 't_cover_big') for the foreground cover
 */
function upgradeIgdbUrl(url, token) {
  if (!url) return url
  // Match any t_<word> token and replace it
  return url.replace(/t_[a-z0-9_]+/, token)
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HeroEmpty() {
  const navigate = useNavigate()
  return (
    <div className="hcp-empty">
      <div className="hcp-empty-icon" aria-hidden="true">🎮</div>
      <p className="hcp-empty-title">Pick something to play</p>
      <p className="hcp-empty-body">
        Mark a game as Playing and it will show up here.
      </p>
      <div className="hcp-empty-actions">
        <button
          className="hcp-empty-cta"
          onClick={() => navigate('/library')}
        >
          Your Library
        </button>
        <button
          className="hcp-empty-cta hcp-empty-cta--secondary"
          onClick={() => navigate('/search')}
        >
          Search Games
        </button>
      </div>
    </div>
  )
}

function SecondaryCard({ game, onClick }) {
  return (
    <button className="hcp-mini-card" onClick={onClick}>
      <div className="hcp-mini-cover-wrap">
        <SharedCover gameId={game.id} imageSrc={game.image}>
          <img
            src={game.image}
            alt={game.title}
            className="hcp-mini-cover"
            loading="lazy"
            onError={(e) => {
              e.target.src =
                'https://via.placeholder.com/100x150/1a1a2e/ffffff?text=' +
                encodeURIComponent(game.title)
            }}
          />
        </SharedCover>
      </div>
      <span className="hcp-mini-title">{game.title}</span>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function HeroCurrentlyPlaying({ games }) {
  const navigate = useNavigate()
  const eyebrow = useMemo(getTimeOfDayLabel, [])

  if (!games || games.length === 0) {
    return (
      <div className="hcp">
        <HeroEmpty />
      </div>
    )
  }

  const [spotlight, ...others] = games

  const bgSrc = upgradeIgdbUrl(spotlight.image, 't_1080p')
  const coverSrc = upgradeIgdbUrl(spotlight.image, 't_cover_big')

  const pct = spotlight.progressPercent ?? 0
  const hours = spotlight.hoursPlayed
  const hasProgress = pct > 0 || (hours != null && hours > 0)
  const timeAgo = humanTimeAgo(spotlight.lastPlayedAt || spotlight.addedAt)

  function goToSpotlight(e) {
    e.stopPropagation()
    navigate(`/game/${spotlight.id}`, {
      state: { coverImage: spotlight.image },
    })
  }

  return (
    <div className="hcp">
      {/* ── Hero ── */}
      <div
        className="hcp-hero"
        role="button"
        tabIndex={0}
        onClick={goToSpotlight}
        onKeyDown={(e) => e.key === 'Enter' && goToSpotlight(e)}
        aria-label={`Continue playing ${spotlight.title}`}
      >
        {/* Blurred background */}
        <div className="hcp-bg" aria-hidden="true">
          <img
            src={bgSrc || spotlight.image}
            alt=""
            className="hcp-bg-img"
            loading="eager"
          />
          <div className="hcp-bg-gradient" />
        </div>

        {/* Foreground */}
        <div className="hcp-fg">
          {/* Cover */}
          <div className="hcp-cover-wrap">
            <SharedCover gameId={spotlight.id} imageSrc={coverSrc || spotlight.image}>
              <img
                src={coverSrc || spotlight.image}
                alt={spotlight.title}
                className="hcp-cover"
                loading="eager"
                onError={(e) => {
                  e.target.src =
                    'https://via.placeholder.com/120x180/1a1a2e/ffffff?text=' +
                    encodeURIComponent(spotlight.title)
                }}
              />
            </SharedCover>
          </div>

          {/* Info stack */}
          <div className="hcp-info">
            <span className="hcp-eyebrow">{eyebrow}</span>
            <h2 className="hcp-title">{spotlight.title}</h2>
            {timeAgo && <span className="hcp-timestamp">{timeAgo}</span>}

            {hasProgress && (
              <div className="hcp-progress-block">
                <div className="hcp-progress-meta">
                  {pct > 0 && <span className="hcp-pct">{pct}% complete</span>}
                  {hours > 0 && <span className="hcp-hours">{hours}h played</span>}
                </div>
                <div className="hcp-bar-track">
                  <div
                    className="hcp-bar-fill"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            <button
              className="hcp-continue-btn"
              type="button"
              onClick={goToSpotlight}
            >
              Continue
            </button>
          </div>
        </div>
      </div>

      {/* ── Secondary carousel ── */}
      {others.length > 0 && (
        <div className="hcp-secondary">
          <h3 className="hcp-secondary-heading">Also in progress</h3>
          <div className="hcp-secondary-rail">
            {others.map((game) => (
              <SecondaryCard
                key={game.id}
                game={game}
                onClick={() =>
                  navigate(`/game/${game.id}`, {
                    state: { coverImage: game.image },
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
