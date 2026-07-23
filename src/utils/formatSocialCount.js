// Zero-state rule for social-proof counts (likes, comments, saves, plays,
// reactions, presence). Never reveal a low-volume count — 0, 1, or 2 reads
// as "nobody cares yet" and actively discourages engagement. Below the
// threshold we show only the icon/action affordance; the numeral appears
// once the count is "real" (>= 3).
//
// Usage:
//   {shouldShowCount(count) && <span>{count}</span>}
//
// Never render `{count || 0}` / `{count ?? 0}` for these — that pattern is
// exactly what produces "0 likes" / "0 saves".
export const COUNT_VISIBILITY_THRESHOLD = 3

/**
 * Returns true when a social-proof count should be rendered as a number.
 * Counts below COUNT_VISIBILITY_THRESHOLD (i.e. 0, 1, 2) return false —
 * callers should render the bare icon/affordance with no numeral instead.
 *
 * @param {number|null|undefined} count
 * @returns {boolean}
 */
export function shouldShowCount(count) {
  const n = Number(count)
  return Number.isFinite(n) && n >= COUNT_VISIBILITY_THRESHOLD
}
