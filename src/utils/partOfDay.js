/**
 * Time-of-day label for user-facing copy, using the device's local clock.
 *
 * @param {Date} [date=new Date()]
 * @returns {'tonight'|'this morning'|'this afternoon'|'this evening'}
 */
export function partOfDay(date = new Date()) {
  const h = date.getHours()
  if (h < 5) return 'tonight'
  if (h < 12) return 'this morning'
  if (h < 17) return 'this afternoon'
  if (h < 21) return 'this evening'
  return 'tonight'
}
