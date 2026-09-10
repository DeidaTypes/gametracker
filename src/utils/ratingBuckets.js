/**
 * Half-star histogram buckets (0.5–5.0).
 *
 * Do NOT snap with Math.round(rating). That sends 3.5 into the 4-star
 * bar while the mean readout still shows 3.5 — the number and the bars
 * disagree. Snap with Math.round(rating * 2) / 2 so a stored 3.5 stays
 * a 3.5 bucket.
 */

export const HALF_STAR_BUCKETS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

export function toHalfStarBucket(rating) {
  const n = Number(rating)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(5, Math.max(0.5, Math.round(n * 2) / 2))
}

export function emptyHalfStarCounts() {
  return Object.fromEntries(HALF_STAR_BUCKETS.map((b) => [b, 0]))
}
