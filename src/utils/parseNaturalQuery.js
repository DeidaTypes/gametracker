/**
 * Natural-language query parser for the Games search tab.
 *
 * Extracts recognized modifier keywords from the user's raw query and maps
 * them to real IGDB filter clauses.  Whatever is left after stripping
 * keywords becomes the `remainder` text that is forwarded to the IGDB
 * full-text `search "…"` endpoint.
 *
 * All IGDB entity IDs are real, cross-checked against the igdb.js
 * MOOD_CHIPS comments and the public IGDB entity-reference docs.
 *
 * Verified IGDB IDs
 * ─────────────────
 *  game_modes: 2 = Multiplayer, 3 = Co-operative
 *  themes:     1 = Action,      17 = Fantasy,  18 = Science fiction,
 *             19 = Horror,      21 = Survival,  23 = Stealth,
 *             31 = Drama,       33 = Sandbox,   38 = Open world,
 *             40 = Party
 *  genres:     5 = Shooter,     9 = Puzzle,    12 = Role-playing (RPG),
 *             14 = Sport,       15 = Strategy,  31 = Adventure,
 *             32 = Indie
 */

// Multi-word phrases must come before their single-word components so that
// "open world" is consumed before "open" or "world" can be matched alone.
const KEYWORD_RULES = [
  // ── multi-word phrases ──────────────────────────────────────────────────
  {
    pattern: /\bopen[\s-]?world\b/i,
    fragment: 'themes = (38)',
    label: 'open world',
  },
  {
    pattern: /\bco[\s-]?op\b|\bcooperative\b/i,
    fragment: 'game_modes = (3)',
    label: 'co-op',
  },
  {
    pattern: /\bsci[\s-]?fi\b|\bscience[\s-]fiction\b/i,
    fragment: 'themes = (18)',
    label: 'sci-fi',
  },
  {
    pattern: /\brole[\s-]?playing\b/i,
    fragment: 'genres = (12)',
    label: 'role-playing',
  },
  // ── single words ────────────────────────────────────────────────────────
  { pattern: /\bhorror\b|\bscary\b|\bspooky\b/i, fragment: 'themes = (19)', label: 'horror' },
  { pattern: /\bsandbox\b/i,                      fragment: 'themes = (33)', label: 'sandbox' },
  { pattern: /\bfantasy\b/i,                      fragment: 'themes = (17)', label: 'fantasy' },
  { pattern: /\bemotional\b|\bdrama\b/i,           fragment: 'themes = (31)', label: 'emotional' },
  { pattern: /\bpuzzle\b/i,                        fragment: 'genres = (9)',  label: 'puzzle' },
  { pattern: /\bshooter\b|\bfps\b/i,              fragment: 'genres = (5)',  label: 'shooter' },
  { pattern: /\bstrategy\b/i,                      fragment: 'genres = (15)', label: 'strategy' },
  { pattern: /\badventure\b/i,                     fragment: 'genres = (31)', label: 'adventure' },
  { pattern: /\bindie\b/i,                         fragment: 'genres = (32)', label: 'indie' },
  { pattern: /\bsurvival\b/i,                      fragment: 'themes = (21)', label: 'survival' },
  { pattern: /\bstealth\b/i,                       fragment: 'themes = (23)', label: 'stealth' },
  { pattern: /\bparty\b/i,                         fragment: 'themes = (40)', label: 'party' },
  { pattern: /\bmultiplayer\b/i,                   fragment: 'game_modes = (2)', label: 'multiplayer' },
  { pattern: /\brpg\b/i,                           fragment: 'genres = (12)', label: 'rpg' },
  { pattern: /\bsports?\b/i,                       fragment: 'genres = (14)', label: 'sport' },
  // action: test last — it's a common word and genres prefer explicit theme=1
  { pattern: /\baction\b/i,                        fragment: 'themes = (1)',  label: 'action' },
]

// "short" / "quick" trigger a time-to-beat lookup (handled by useSearch)
// rather than a direct where clause.
const TTB_PATTERN = /\bshort\b|\bquick\b|\bbrief\b/i

// Filler words to strip from the remainder so "short co-op games" → ""
const STOP_WORDS = /\bgames?\b|\btitles?\b|\bvideogames?\b/gi

/**
 * Parse a raw search query into IGDB filter fragments + leftover text.
 *
 * @param {string} query  Raw user input
 * @returns {{
 *   whereFragments: string[],   IGDB where-clause fragments (joined with ' & ' by caller)
 *   remainder:      string,     Leftover text for IGDB full-text search
 *   hasTtb:         boolean,    True when "short"/"quick"/"brief" was detected
 *   hasFilters:     boolean,    True when any filter (where or ttb) was extracted
 *   labels:         string[],   Human-readable labels of matched filters
 * }}
 */
export function parseNaturalQuery(query) {
  let working = query || ''
  const whereFragments = []
  const labels = []
  const seenFragments = new Set()

  // Check for TTB keywords first and strip them
  const hasTtb = TTB_PATTERN.test(working)
  if (hasTtb) {
    working = working.replace(TTB_PATTERN, ' ')
    labels.push('short')
  }

  // Apply keyword rules
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(working)) {
      working = working.replace(rule.pattern, ' ')
      if (!seenFragments.has(rule.fragment)) {
        seenFragments.add(rule.fragment)
        whereFragments.push(rule.fragment)
        labels.push(rule.label)
      }
    }
  }

  const remainder = working
    .replace(STOP_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    whereFragments,
    remainder,
    hasTtb,
    hasFilters: whereFragments.length > 0 || hasTtb,
    labels,
  }
}
