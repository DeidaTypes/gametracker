// Shared progress computation helper.
//
// Pure function — no side effects, no imports. Every screen that needs to
// display a progress bar (Home, Library, GameDetail) calls this instead of
// duplicating the math. Tests can call it without any mocking.
//
// Priority rules:
//   1. progressOverride != null  → use it directly (user's manual override)
//   2. normallySeconds > 0 && hoursPlayed > 0  → derive % from TTB data
//   3. otherwise → percent = null, showBar = false (hours-only display)

/**
 * Clamp n into [min, max].
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

/**
 * Compute display-ready progress state from raw tracker + TTB data.
 *
 * @param {{
 *   hoursPlayed: number,
 *   progressOverride: number|null,
 *   normallySeconds: number|null,
 * }} params
 *
 * @returns {{
 *   hoursPlayed: number,
 *   mainHours: number|null,
 *   percent: number|null,
 *   showBar: boolean,
 *   label: string,
 * }}
 */
export function computeProgress({ hoursPlayed, progressOverride, normallySeconds }) {
  const hrs = Number(hoursPlayed) || 0
  const mainHours = normallySeconds != null && normallySeconds > 0
    ? Math.round(normallySeconds / 3600)
    : null

  let percent = null
  let showBar = false

  if (progressOverride != null) {
    percent = clamp(Number(progressOverride), 0, 100)
    showBar = true
  } else if (normallySeconds != null && normallySeconds > 0 && hrs > 0) {
    percent = clamp((hrs / (normallySeconds / 3600)) * 100, 0, 100)
    showBar = true
  }

  const label = mainHours != null
    ? `${Math.round(hrs)} / ~${mainHours} hrs`
    : `${Math.round(hrs)} hrs`

  return { hoursPlayed: hrs, mainHours, percent, showBar, label }
}
