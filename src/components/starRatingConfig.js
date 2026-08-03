/**
 * Shared config between the two star-rating components:
 *   - StarRatingDisplay.jsx        (read-only rating display)
 *   - forms/StarRatingInput.jsx    (interactive rating input)
 *
 * They are intentionally NOT merged into one component — display and
 * input are genuinely different jobs (one renders a stored value, the
 * other captures a gesture) — but they share ONE size scale and ONE
 * rounding policy so a given rating/size looks identical no matter
 * which surface renders it.
 */

export const STAR_ICON_PATH =
  'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z'

/**
 * ONE t-shirt size scale (px), replacing the 8 ad-hoc pixel values that
 * used to be hardcoded at individual call sites (11–24px for the
 * display component; 20/32/40px for the input). Both components accept
 * one of these step names via their `size` prop.
 */
export const STAR_RATING_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
}

export function resolveStarRatingSize(size) {
  if (typeof size === 'number') return size
  return STAR_RATING_SIZES[size] ?? STAR_RATING_SIZES.md
}

/**
 * ROUNDING POLICY — TRUE FRACTIONAL FILL (see StarRatingDisplay.jsx for
 * the full writeup and how to reverse this decision if the product call
 * differs). This is the ONLY place fill percentage is computed for
 * read-only star display — every screen must go through this function
 * rather than re-implementing its own rounding.
 */
export function getStarRatingFillPercent(rating) {
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  return (safeRating / 5) * 100
}
