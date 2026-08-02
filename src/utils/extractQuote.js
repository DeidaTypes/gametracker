/**
 * Pick the punchiest sentence from a review body.
 * Tries to find a sentence (ends in . ! ?) that is 40–280 chars.
 * Falls back to the first 200 chars trimmed to a word boundary.
 *
 * Shared by ReviewCard's kebab (Share quote) and the ReviewComments
 * screen-level header kebab, which relocates that same affordance for
 * the review-comments thread — see ReviewComments.jsx.
 */
export function extractQuote(body) {
  if (!body) return ''
  const text = body.trim()
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const s of sentences) {
    const t = s.trim()
    if (t.length >= 40 && t.length <= 280) return t
  }
  if (text.length <= 200) return text
  const cut = text.slice(0, 200)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + '\u2026'
}
