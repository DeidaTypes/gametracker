// Shared timestamp formatter for every activity/social surface app-wide
// (Pulse feed, review cards, comment threads, activity timelines).
//
// Spec (emit-events-for-every-action sprint):
//   < 7 days  → compact relative ("2h", "3d", "just now")
//   >= 7 days → absolute date ("Jan 1, 2026")
//
// This deliberately replaces every bare `date-fns` `formatDistanceToNow` /
// `formatDistanceToNowStrict` call across these surfaces, which — with no
// upper bound — degrades into vague, low-signal copy like "about 2 months
// ago" for anything older than a few weeks. Route every new date display
// through this single function so that failure mode can't reappear.
//
// Out of scope: Sprint A's Now Playing hero (HomeNowPlayingHero.jsx) and
// its "last played" wording keep their own existing formatter untouched.

const MINUTE = 60
const HOUR = MINUTE * 60
const DAY = HOUR * 24

/**
 * @param {string|number|Date|null|undefined} timestamp
 * @param {{ compactAbsolute?: boolean }} [options] `compactAbsolute` swaps
 *   the >= 7 days branch for a numeric "7/15/26" date. Opt-in so the
 *   surfaces already reading the spelled-out form are untouched; the Home
 *   pulse card uses it because its timestamp sits in a small byline where
 *   "Jun 10, 2026" outweighs everything around it.
 * @returns {string} '' for missing/invalid input, otherwise a compact
 *   relative string under 7 days old, or an absolute date from 7 days old
 *   onward.
 */
export function formatActivityDate(timestamp, options = {}) {
  if (!timestamp) return ''
  const then = new Date(timestamp)
  const thenMs = then.getTime()
  if (Number.isNaN(thenMs)) return ''

  const seconds = Math.max(0, Math.floor((Date.now() - thenMs) / 1000))
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / MINUTE)
  if (seconds < HOUR) return `${minutes}m`

  const hours = Math.floor(seconds / HOUR)
  if (seconds < DAY) return `${hours}h`

  const days = Math.floor(seconds / DAY)
  if (days < 7) return `${days}d`

  return then.toLocaleDateString(
    'en-US',
    options.compactAbsolute
      ? { month: 'numeric', day: 'numeric', year: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

export default formatActivityDate
