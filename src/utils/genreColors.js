/**
 * Maps an IGDB genre name to one of the app's --genre-* data-viz tokens
 * (defined in src/styles/theme.css). Used by taste-match genre-overlap
 * visualizations on Discover (Recently activity cards, Because You Played)
 * so bars/chips read colors from the design system instead of hardcoded hex.
 *
 * Order matters — more specific patterns are checked before their broader
 * neighbors (e.g. "Real Time Strategy (RTS)" hits the strategy rule before
 * anything more generic could).
 */
const GENRE_TOKEN_RULES = [
  [/role-?playing|\brpg\b/i, '--genre-rpg'],
  [/shooter/i, '--genre-shooter'],
  [/real time strategy|turn-based strategy|\bstrategy\b|tactical/i, '--genre-strategy'],
  [/\bsport\b/i, '--genre-sports'],
  [/racing/i, '--genre-racing'],
  [/puzzle/i, '--genre-puzzle'],
  [/simulat/i, '--genre-simulation'],
  [/fighting|hack and slash|beat 'em up/i, '--genre-fighting'],
  [/platform/i, '--genre-platformer'],
  [/adventure/i, '--genre-adventure'],
  [/indie/i, '--genre-indie'],
  [/arcade|pinball/i, '--genre-arcade'],
  [/horror/i, '--genre-horror'],
  [/action|moba/i, '--genre-action'],
]

/** Returns the CSS custom-property NAME (e.g. "--genre-rpg") for a genre. */
export function genreToken(genreName) {
  if (!genreName) return '--genre-default'
  const match = GENRE_TOKEN_RULES.find(([re]) => re.test(genreName))
  return match ? match[1] : '--genre-default'
}

/** Returns a ready-to-use `var(--genre-*)` string for inline styles. */
export function genreColorVar(genreName) {
  return `var(${genreToken(genreName)})`
}
