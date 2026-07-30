/**
 * Small display-only helpers for Your Gaming Map tiles. Nothing here
 * invents a genre, count, or rating — every value passed in already came
 * from getGamingMap; these just choose how to word it.
 */

/**
 * IGDB's formal genre names carry a parenthetical abbreviation
 * ("Role-playing (RPG)", "Real Time Strategy (RTS)"). Tiles read cleaner
 * with the full word form and drop the abbreviation.
 */
export function genreDisplayName(name) {
  if (!name) return ''
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export function formatGameCount(count) {
  const n = Number(count) || 0
  return `${n.toLocaleString()} game${n === 1 ? '' : 's'}`
}

export function formatBacklogCount(count) {
  const n = Number(count) || 0
  return `${n.toLocaleString()} backlogged`
}

/** Whole-hours label, or null when there's nothing worth showing. */
export function formatHoursShort(hours) {
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) return null
  const rounded = Math.round(h)
  return rounded < 1 ? '<1h' : `${rounded.toLocaleString()}h`
}

/**
 * Joins the stats line for a Home Turf / Exploring tile: "42 games · 380h"
 * and, when a rating exists, "· ★4.3". `includeRating` gates the star
 * segment — Exploring tiles never show one, per the map's tier spec.
 */
export function formatTierStatsLine(stats, { includeRating = false } = {}) {
  const parts = [formatGameCount(stats.gameCount)]
  const hoursLabel = formatHoursShort(stats.hours)
  if (hoursLabel) parts.push(hoursLabel)
  if (includeRating && stats.avgRating != null) parts.push(`★${stats.avgRating}`)
  return parts.join(' · ')
}

/**
 * The genre detail header's tier line: "You haven't ventured here yet",
 * "Your home turf", etc. Paired with the real IGDB total count by the
 * caller — this function only ever describes the user's OWN relationship
 * to the genre, never the genre's catalog size.
 */
export function genreDetailTierPhrase(tier, stats) {
  if (tier === 'home_turf') return 'Your home turf'
  if (tier === 'exploring') return "You're exploring this"
  if (tier === 'on_horizon') return formatBacklogCount(stats?.backlogCount || 0)
  return "You haven't ventured here yet"
}

/** "a" before a consonant-sound word, "an" before a vowel-sound one. */
export function articleFor(word) {
  if (!word) return 'a'
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a'
}

/**
 * "for a Role-playing player" — used by Venture Out, which speaks in the
 * genre's full display name.
 */
export function playerLabelFor(genreName) {
  const name = genreDisplayName(genreName)
  if (!name) return null
  return `${articleFor(name)} ${name} player`
}

// Genre detail's "Good places to start" strip speaks in the genre's short
// spoken form ("RPG", "RTS") rather than the full name, each paired with
// whichever article actually sounds right when the abbreviation is read
// aloud letter-by-letter (e.g. "an RPG", "a TBS"). Hand-picked per genre
// rather than derived — a generic vowel-letter check gets acronyms wrong
// (the letter "R" starts a vowel *sound*, "T" doesn't).
const SHORT_PLAYER_LABELS = {
  'point-and-click': { label: 'Point-and-click', article: 'a' },
  fighting: { label: 'Fighting', article: 'a' },
  shooter: { label: 'Shooter', article: 'a' },
  music: { label: 'Music', article: 'a' },
  platform: { label: 'Platformer', article: 'a' },
  puzzle: { label: 'Puzzle', article: 'a' },
  racing: { label: 'Racing', article: 'a' },
  'real-time-strategy-rts': { label: 'RTS', article: 'an' },
  'role-playing-rpg': { label: 'RPG', article: 'an' },
  simulator: { label: 'Sim', article: 'a' },
  sport: { label: 'Sports', article: 'a' },
  strategy: { label: 'Strategy', article: 'a' },
  'turn-based-strategy-tbs': { label: 'TBS', article: 'a' },
  tactical: { label: 'Tactics', article: 'a' },
  'hack-and-slash-beat-em-up': { label: 'Hack-and-slash', article: 'a' },
  'quiz-trivia': { label: 'Quiz', article: 'a' },
  pinball: { label: 'Pinball', article: 'a' },
  adventure: { label: 'Adventure', article: 'an' },
  indie: { label: 'Indie', article: 'an' },
  arcade: { label: 'Arcade', article: 'an' },
  'visual-novel': { label: 'Visual novel', article: 'a' },
  'card-and-board-game': { label: 'Board game', article: 'a' },
  moba: { label: 'MOBA', article: 'a' },
}

/** @returns {string|null} e.g. "for an RPG player" */
export function shortPlayerLabelFor(genreSlug) {
  const entry = SHORT_PLAYER_LABELS[genreSlug]
  if (!entry) return null
  return `for ${entry.article} ${entry.label} player`
}
