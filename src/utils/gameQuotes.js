/**
 * Short, iconic in-game lines shown in Venture Out's loading slot while a
 * fresh pick is "found." Purely decorative flavor text — never attributed,
 * never claimed as a stat, and never blocking: the slot resolves whether or
 * not this list ever renders a quote at all.
 */
const GAME_QUOTES = [
  'A man chooses. A slave obeys.',
  'War. War never changes.',
  'It\'s dangerous to go alone. Take this.',
  'Praise the sun!',
  'The cake is a lie.',
  'Would you kindly?',
  'Stay awhile and listen.',
  'A hunter must hunt.',
  'This is the way.',
  'Do a barrel roll!',
  'Nothing is true, everything is permitted.',
  'You have died of dysentery.',
  'Get over here!',
  'The right man in the wrong place can make all the difference in the world.',
]

/**
 * A shuffled subset of quotes to cycle through during one loading window.
 * `count` is generous relative to how many will actually be shown before
 * the pick resolves — cycling just needs fresh-feeling variety, not a
 * complete traversal.
 */
export function getQuoteSequence(count = 5) {
  const shuffled = [...GAME_QUOTES].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}
