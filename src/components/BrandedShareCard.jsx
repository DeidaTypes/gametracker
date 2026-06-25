import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { CARD_WIDTH, CARD_HEIGHT } from '../services/share'
import './BrandedShareCard.css'

/**
 * BrandedShareCard — multi-variant offscreen share card.
 *
 * Variants:
 *   game-score       Game cover + title + user rating + deep link
 *   profile-dna      Username + play/review/follow stats + deep link
 *   favorites-shelf  Up to 5 game covers in a shelf row + deep link
 *   quotable-review  Review excerpt + game title + rating + deep link
 *
 * All variants share:
 *   - 1080×1350px fixed canvas (4:5, Instagram-safe)
 *   - Deep navy background
 *   - GameTracker watermark (bottom-left)
 *   - QR code + short URL (bottom-right)
 *
 * Props:
 *   variant     one of the four keys above
 *   data        variant-specific data object (real data only)
 *   deepLinkUrl string  canonical URL embedded in QR + text
 *   qrDataUrl   string|null  pre-generated QR base64 image
 *   onReady     () => void   called after first render so the capturer
 *               knows images have had a chance to load
 */

const BrandedShareCard = forwardRef(function BrandedShareCard(
  { variant, data = {}, deepLinkUrl = '', qrDataUrl = null, onReady },
  ref
) {
  const rootRef = useRef(null)
  useImperativeHandle(ref, () => rootRef.current)

  // Signal readiness after mount + one paint cycle
  useEffect(() => {
    if (typeof onReady === 'function') {
      const t = window.setTimeout(onReady, 120)
      return () => window.clearTimeout(t)
    }
  }, [onReady])

  // Short URL label — strip protocol for display
  const shortUrl = deepLinkUrl.replace(/^https?:\/\//, '')

  return (
    <div ref={rootRef} className="bsc" aria-hidden="true">
      <div className="bsc__bg" />

      {/* Variant body */}
      <div className="bsc__body">
        {variant === 'game-score' && <GameScoreVariant data={data} />}
        {variant === 'profile-dna' && <ProfileDnaVariant data={data} />}
        {variant === 'favorites-shelf' && <FavoritesShelfVariant data={data} />}
        {variant === 'quotable-review' && <QuotableReviewVariant data={data} />}
        {variant === 'wrapped-summary' && <WrappedSummaryVariant data={data} />}
      </div>

      {/* Footer: watermark left, QR + URL right */}
      <div className="bsc__footer">
        <span className="bsc__watermark">GameTracker</span>
        <div className="bsc__qr-wrap">
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt=""
              crossOrigin="anonymous"
              className="bsc__qr"
            />
          )}
          <span className="bsc__url">{shortUrl}</span>
        </div>
      </div>
    </div>
  )
})

export default BrandedShareCard

/* ============================================================
   Variant: Game Score
   data: { game: { title, coverUrl, year, developer }, rating, username }
   ============================================================ */
function GameScoreVariant({ data }) {
  const { game = {}, rating = 0, username = '' } = data
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  const fillPct = (safeRating / 5) * 100

  return (
    <div className="bsc-game">
      <div className="bsc-game__cover-wrap">
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt=""
            crossOrigin="anonymous"
            className="bsc-game__cover"
          />
        ) : (
          <div className="bsc-game__cover bsc-game__cover--fallback" />
        )}
      </div>

      <h1 className="bsc-game__title">{game.title || 'Untitled'}</h1>

      {(game.developer || game.year) && (
        <p className="bsc-game__meta">
          {[game.developer, game.year].filter(Boolean).join(' · ')}
        </p>
      )}

      {safeRating > 0 && (
        <div className="bsc__stars-wrap">
          <div className="bsc__stars-base">
            {[0,1,2,3,4].map((i) => (
              <svg key={i} width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                  fill="none" stroke="rgba(148,168,212,0.25)" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            ))}
          </div>
          <div className="bsc__stars-fill" style={{ width: `${fillPct}%` }}>
            {[0,1,2,3,4].map((i) => (
              <svg key={i} width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                  fill="#f5b50a" stroke="#f5b50a" strokeWidth="1"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            ))}
          </div>
        </div>
      )}

      {safeRating > 0 && (
        <p className="bsc-game__score">{safeRating}<span className="bsc-game__score-denom">/5</span></p>
      )}

      {username && (
        <p className="bsc-game__byline">Reviewed by {username}</p>
      )}
    </div>
  )
}

/* ============================================================
   Variant: Profile DNA
   data: { username, displayName, avatarUrl, gamesPlayed, reviews, following, genres }
   genres: Array<{ name, count }>  (top genres, real data only)
   ============================================================ */
function ProfileDnaVariant({ data }) {
  const {
    username = '',
    displayName = '',
    avatarUrl = null,
    gamesPlayed = 0,
    reviews = 0,
    following = 0,
    genres = [],
  } = data

  return (
    <div className="bsc-profile">
      <div className="bsc-profile__avatar-wrap">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            crossOrigin="anonymous"
            className="bsc-profile__avatar"
          />
        ) : (
          <div className="bsc-profile__avatar bsc-profile__avatar--fallback">
            {(displayName || username || '?').charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <h1 className="bsc-profile__name">{displayName || username}</h1>
      {displayName && username && (
        <p className="bsc-profile__handle">@{username}</p>
      )}

      <div className="bsc-profile__stats">
        <div className="bsc-profile__stat">
          <span className="bsc-profile__stat-num">{gamesPlayed}</span>
          <span className="bsc-profile__stat-label">Played</span>
        </div>
        <div className="bsc-profile__stat-divider" />
        <div className="bsc-profile__stat">
          <span className="bsc-profile__stat-num">{reviews}</span>
          <span className="bsc-profile__stat-label">Reviews</span>
        </div>
        <div className="bsc-profile__stat-divider" />
        <div className="bsc-profile__stat">
          <span className="bsc-profile__stat-num">{following}</span>
          <span className="bsc-profile__stat-label">Following</span>
        </div>
      </div>

      {genres.length > 0 && (
        <div className="bsc-profile__genres">
          <p className="bsc-profile__genres-label">Top Genres</p>
          <div className="bsc-profile__genre-pills">
            {genres.slice(0, 5).map(({ name }) => (
              <span key={name} className="bsc-profile__genre-pill">{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Variant: Favorites Shelf
   data: { username, games: Array<{ title, coverUrl }> }  (max 5)
   ============================================================ */
function FavoritesShelfVariant({ data }) {
  const { username = '', games = [] } = data
  const shelf = games.slice(0, 5)

  return (
    <div className="bsc-shelf">
      <p className="bsc-shelf__eyebrow">Favorites</p>
      <h1 className="bsc-shelf__name">{username}</h1>

      <div className="bsc-shelf__row">
        {shelf.map((game, i) => (
          <div key={i} className="bsc-shelf__item">
            {game.coverUrl ? (
              <img
                src={game.coverUrl}
                alt=""
                crossOrigin="anonymous"
                className="bsc-shelf__cover"
              />
            ) : (
              <div className="bsc-shelf__cover bsc-shelf__cover--fallback" />
            )}
            <p className="bsc-shelf__game-title">{game.title}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   Variant: Wrapped Summary
   data: { periodLabel, playedCount, hoursPlayed, reviewCount,
           topGenre, topGame: { title, coverUrl } | null, avgRating }
   ============================================================ */
function WrappedSummaryVariant({ data }) {
  const {
    periodLabel = '',
    playedCount = 0,
    hoursPlayed = 0,
    reviewCount = 0,
    topGenre = null,
    topGame = null,
    avgRating = null,
  } = data

  return (
    <div className="bsc-wrapped">
      <p className="bsc-wrapped__eyebrow">Year in Games</p>
      <h1 className="bsc-wrapped__period">{periodLabel}</h1>

      <div className="bsc-wrapped__stats">
        <div className="bsc-wrapped__stat">
          <span className="bsc-wrapped__stat-num">{playedCount}</span>
          <span className="bsc-wrapped__stat-label">Played</span>
        </div>
        {hoursPlayed > 0 && (
          <div className="bsc-wrapped__stat">
            <span className="bsc-wrapped__stat-num">{hoursPlayed}</span>
            <span className="bsc-wrapped__stat-label">Hours</span>
          </div>
        )}
        {reviewCount > 0 && (
          <div className="bsc-wrapped__stat">
            <span className="bsc-wrapped__stat-num">{reviewCount}</span>
            <span className="bsc-wrapped__stat-label">Reviews</span>
          </div>
        )}
      </div>

      {topGame && (
        <div className="bsc-wrapped__top-game">
          <p className="bsc-wrapped__top-game-eyebrow">Most Played</p>
          <div className="bsc-wrapped__top-game-inner">
            {topGame.coverUrl ? (
              <img
                src={topGame.coverUrl}
                alt=""
                crossOrigin="anonymous"
                className="bsc-wrapped__top-game-cover"
              />
            ) : (
              <div className="bsc-wrapped__top-game-cover bsc-wrapped__top-game-cover--fallback" />
            )}
            <p className="bsc-wrapped__top-game-title">{topGame.title}</p>
          </div>
        </div>
      )}

      <div className="bsc-wrapped__badges">
        {topGenre && (
          <div className="bsc-wrapped__badge">
            <span className="bsc-wrapped__badge-label">Top Genre</span>
            <span className="bsc-wrapped__badge-value">{topGenre}</span>
          </div>
        )}
        {avgRating !== null && (
          <div className="bsc-wrapped__badge">
            <span className="bsc-wrapped__badge-label">Avg Rating</span>
            <span className="bsc-wrapped__badge-value">{avgRating}<span className="bsc-wrapped__badge-denom">/5</span></span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   Variant: Quotable Review
   data: { quote, game: { title, coverUrl }, rating, username }
   ============================================================ */
function QuotableReviewVariant({ data }) {
  const { quote = '', game = {}, rating = 0, username = '' } = data
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  const fillPct = (safeRating / 5) * 100
  // Trim quote to ~280 chars so it fits the card
  const displayQuote = quote.length > 280 ? quote.slice(0, 277) + '…' : quote

  return (
    <div className="bsc-quote">
      <div className="bsc-quote__header">
        {game.coverUrl && (
          <img
            src={game.coverUrl}
            alt=""
            crossOrigin="anonymous"
            className="bsc-quote__cover"
          />
        )}
        <div className="bsc-quote__game-info">
          <h2 className="bsc-quote__game-title">{game.title || ''}</h2>
          {safeRating > 0 && (
            <div className="bsc__stars-wrap bsc__stars-wrap--sm">
              <div className="bsc__stars-base">
                {[0,1,2,3,4].map((i) => (
                  <svg key={i} width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                      fill="none" stroke="rgba(148,168,212,0.25)" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                ))}
              </div>
              <div className="bsc__stars-fill" style={{ width: `${fillPct}%` }}>
                {[0,1,2,3,4].map((i) => (
                  <svg key={i} width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                      fill="#f5b50a" stroke="#f5b50a" strokeWidth="1"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bsc-quote__body">
        <span className="bsc-quote__mark" aria-hidden="true">"</span>
        <p className="bsc-quote__text">{displayQuote}</p>
        <span className="bsc-quote__mark bsc-quote__mark--close" aria-hidden="true">"</span>
      </div>

      {username && (
        <p className="bsc-quote__byline">— {username}</p>
      )}
    </div>
  )
}
