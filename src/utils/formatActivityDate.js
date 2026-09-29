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
 * @param {{ compactAbsolute?: boolean, pulse?: boolean }} [options]
 *   `compactAbsolute` swaps the >= 7 days branch for a numeric "7/15/26"
 *   date (legacy opt-in). `pulse` is the Home pulse row/card format:
 *   "Aug 7", with the year appended only when the date is not in the
 *   current calendar year.
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

  if (options.pulse) {
    const now = new Date()
    const fmt = { month: 'short', day: 'numeric' }
    if (then.getFullYear() !== now.getFullYear()) fmt.year = 'numeric'
    return then.toLocaleDateString('en-US', fmt)
  }

  return then.toLocaleDateString(
    'en-US',
    options.compactAbsolute
      ? { month: 'numeric', day: 'numeric', year: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

/**
 * coarseRelativeBucket — V4-01 Pulse subline helper. Buckets a
 * timestamp into the coarsest of three labels so "{n} new since ___"
 * never reads more precisely than the subline warrants:
 *
 *   - today (any time before now, same calendar day)   → 'this morning'
 *     ('this morning' is used as the single today-bucket label per the
 *     spec's two named buckets — 'today' would read oddly for a viewer
 *     checking Home in the evening about a morning event)
 *   - yesterday (previous calendar day)                → 'yesterday'
 *   - anything older                                    → weekday name,
 *     e.g. 'Tuesday'
 *
 * Calendar-day math (not a rolling 24h/48h window) so "since yesterday"
 * means since the previous calendar day, matching how a person would
 * describe it, not since exactly 24-48h ago.
 *
 * @param {string|number|Date|null|undefined} timestamp
 * @returns {string} '' for missing/invalid input
 */
export function coarseRelativeBucket(timestamp) {
  if (!timestamp) return ''
  const then = new Date(timestamp)
  if (Number.isNaN(then.getTime())) return ''

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(new Date())
  const thenDay = startOfDay(then)
  const dayDiff = Math.round((today - thenDay) / (DAY * 1000))

  if (dayDiff <= 0) return 'this morning'
  if (dayDiff === 1) return 'yesterday'
  return then.toLocaleDateString('en-US', { weekday: 'long' })
}

export default formatActivityDate
