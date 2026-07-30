// @ts-nocheck
// supabase/functions/new-notable/publishers.ts
//
// LANE A reinforcement only — "optionally reinforced by a recognized
// publisher" (see lanes.ts). Never a lane on its own: a recognized
// publisher with zero rating volume still needs SOME real signal to
// qualify (see LANE_A_PUBLISHER_MIN_RATING_COUNT), so a shovelware title
// from a big publisher can't ride the name alone.
//
// Hardcoded, not IGDB-driven, on the same principle as MOOD_CHIPS and the
// DLC title patterns elsewhere in this codebase: this is a small, stable
// list of real-world publisher names, not something that benefits from a
// database table. Matched case-insensitively as a substring against
// involved_companies where `publisher = true`, since IGDB company names
// carry regional suffixes ("Sony Interactive Entertainment Europe") that
// an exact match would miss.
export const KNOWN_PUBLISHERS = [
  'electronic arts',
  'ea sports',
  'ubisoft',
  'activision',
  'blizzard',
  'bethesda',
  'zenimax',
  'sony interactive',
  'playstation',
  'xbox game studios',
  'microsoft studios',
  'nintendo',
  'square enix',
  'capcom',
  'bandai namco',
  'sega',
  'take-two',
  'rockstar games',
  '2k games',
  'warner bros',
  'cd projekt',
  'epic games',
  'konami',
  'focus entertainment',
  'devolver digital',
  'annapurna interactive',
  'private division',
]

/**
 * @param involvedCompanies raw IGDB `involved_companies` rows, each
 *   `{ publisher: boolean, company: { name: string } }`
 */
export function hasRecognizedPublisher(involvedCompanies) {
  if (!Array.isArray(involvedCompanies)) return false
  for (const ic of involvedCompanies) {
    if (!ic?.publisher) continue
    const name = (ic.company?.name || '').toLowerCase()
    if (KNOWN_PUBLISHERS.some((k) => name.includes(k))) return true
  }
  return false
}
