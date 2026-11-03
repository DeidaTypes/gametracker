import { useNavigate } from 'react-router-dom'
import { getSizedImageUrl } from '../services/imageUtils'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getGameNavStub } from '../utils/gameNavStub'
import './ProfileNowPlaying.css'

/** Whole hours, hidden under 1. 1,000 and up compact to one decimal ("1.2k hr"). */
function formatPlayingHours(hours) {
  const whole = Math.floor(Number(hours))
  if (!Number.isFinite(whole) || whole < 1) return null
  if (whole < 1000) return `${whole} hr`
  const k = whole / 1000
  const compact = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')
  return `${compact}k hr`
}

function playingAriaLabel({ title, hours, live }) {
  const name = title || 'this game'
  const whole = Math.floor(Number(hours))
  const now = live ? ' now' : ''
  const hoursPart =
    Number.isFinite(whole) && whole >= 1
      ? `, ${whole.toLocaleString('en-US')} ${whole === 1 ? 'hour' : 'hours'}`
      : ''
  return `Playing ${name}${now}${hoursPart}. Open game.`
}

/**
 * Frosted row under the profile bio: the game this person is Currently
 * Playing, with a pulsing dot while a session is live. Renders nothing
 * when there is no game to open.
 */
export default function ProfileNowPlaying({ gameId, title, image, hours, live }) {
  const navigate = useNavigate()
  if (gameId == null || !title) return null

  const hoursLabel = formatPlayingHours(hours)
  const src = getSizedImageUrl(image, 40) || image || COVER_FALLBACK

  return (
    <button
      type="button"
      className="pnp"
      aria-label={playingAriaLabel({ title, hours, live })}
      onClick={() =>
        navigate(`/game/${gameId}`, {
          state: getGameNavStub({ id: gameId, title, image }),
        })
      }
    >
      <img
        className="pnp__cover"
        src={src}
        alt=""
        onError={(e) => {
          e.currentTarget.src = COVER_FALLBACK
        }}
      />
      <span className="pnp__text">
        <span className="pnp__label">
          {live && <span className="pnp__dot" aria-hidden="true" />}
          {live ? 'Playing now' : 'Playing'}
        </span>
        <span className="pnp__title">{title}</span>
      </span>
      {hoursLabel && <span className="pnp__hours">{hoursLabel}</span>}
    </button>
  )
}
