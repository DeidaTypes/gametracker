/**
 * Freshness copy for the themed drop.
 *
 * The drop is an event, not a shelf: what makes it worth opening today is
 * knowing it will be gone. So the card names the day the next one lands
 * rather than counting down seconds.
 *
 * The day comes from the live drop's own `expiresAt` — the instant the
 * current window closes is by definition the instant the next one opens,
 * so this stays correct if the schedule ever changes shape. Named in UTC
 * because the rotation boundaries are UTC midnight (weekend slot Thu →
 * Mon, weekday slot Mon → Thu); using the viewer's local day would call
 * the same handover "Sunday" or "Monday" depending on their timezone.
 */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/**
 * @param {Date|null|undefined} expiresAt
 * @returns {string|null} e.g. "new drop Monday", or null when the drop
 *   carries no expiry (nothing honest to say — caller renders no cue).
 */
export function nextDropLabel(expiresAt) {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) return null
  return `new drop ${WEEKDAYS[expiresAt.getUTCDay()]}`
}
