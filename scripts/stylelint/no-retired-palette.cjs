/**
 * Stylelint rule: gametracker/no-retired-palette
 *
 * GameTracker's accent is cobalt blue (#3b82f6). The original
 * orange/amber/copper palette is RETIRED — but it keeps drifting back,
 * one hardcoded hex at a time, because "just this one warm highlight"
 * looks fine in isolation and nothing catches it in review.
 *
 * This rule catches it. Two detection passes:
 *
 *   1. Exact match against the known retired hexes (below), so the
 *      historical values are named and unambiguous in the warning.
 *   2. Hue analysis of every other hex literal. Any sufficiently
 *      saturated color whose hue lands in the red-orange → amber-gold
 *      band (10°–58°) is flagged, which catches new warm values nobody
 *      has seen before — the whole point of linting this instead of
 *      writing it down as a convention.
 *
 * The Ambassador copper accent theme has been retired — there is no
 * longer an "opt-in" warm accent anywhere in the app. With it gone, the
 * only remaining justified ORANGE is the accessibility exception in the
 * deutan/protan color-blind blocks (--status-want-to-play: #f97316),
 * which substitutes for the red/green axis those color-blindness types
 * can't distinguish. Rating-star gold (--star) and tier bronze/gold
 * (--tier-bronze / --tier-gold) are separate, unrelated warm exceptions
 * (gold/bronze, not orange) that remain flagged for their own future
 * palette decision — see DESIGN_SYSTEM.md#retired-palette. All of the
 * above live in src/styles/theme.css, which the config exempts from
 * this rule since token files are where hex literals are supposed to
 * live. If you need a new warm color anywhere else, define it as a
 * token there and justify it rather than inlining a hex in component
 * CSS.
 */

const stylelint = require('stylelint')

const ruleName = 'gametracker/no-retired-palette'

const messages = stylelint.utils.ruleMessages(ruleName, {
  retired: (hex, name) =>
    `Retired palette color "${hex}" (${name}). The orange/amber/copper palette was replaced by cobalt — use var(--accent) or another token from src/styles/theme.css.`,
  warmHue: (hex, hue) =>
    `Hardcoded warm color "${hex}" (hue ${hue}°) falls in the retired orange/amber/copper band. Use a token from src/styles/theme.css; if a warm color is genuinely required, add it there as a named token first.`,
})

const meta = { url: 'DESIGN_SYSTEM.md#retired-palette' }

/** Known values from the pre-cobalt palette, by their historical names. */
const RETIRED_HEXES = new Map([
  ['#c8813a', 'copper accent'],
  ['#d4924f', 'copper hover'],
  ['#a8622a', 'copper press'],
  ['#b8732a', 'copper dark'],
  ['#e8a860', 'copper light'],
  ['#f5a623', 'amber'],
  ['#fbbf24', 'amber warning'],
  ['#f59e0b', 'amber 500'],
  ['#f97316', 'orange 500'],
  ['#ff8c42', 'orange highlight'],
  ['#ffa500', 'orange'],
  ['#ffd700', 'gold'],
  ['#cd7f32', 'bronze'],
])

/** Hue band that reads as red-orange → amber-gold. Pure red sits at 0°. */
const WARM_HUE_MIN = 10
const WARM_HUE_MAX = 58
/** Below these, a "warm" hue is really a near-neutral brown/grey. */
const MIN_SATURATION = 0.2
const MIN_LIGHTNESS = 0.12
const MAX_LIGHTNESS = 0.94

const HEX_PATTERN = /#([0-9a-f]{3,8})\b/gi

function expandHex(raw) {
  // #rgb / #rgba → #rrggbb(aa); ignore anything that isn't a color literal.
  if (raw.length === 3 || raw.length === 4) {
    return raw
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (raw.length === 6 || raw.length === 8) return raw.slice(0, 6)
  return null
}

function toHsl(hex6) {
  const r = parseInt(hex6.slice(0, 2), 16) / 255
  const g = parseInt(hex6.slice(2, 4), 16) / 255
  const b = parseInt(hex6.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return { hue: 0, saturation: 0, lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))

  let hue
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue = Math.round(hue * 60)
  if (hue < 0) hue += 360

  return { hue, saturation, lightness }
}

const ruleFunction = (primary) => (root, result) => {
  const validOptions = stylelint.utils.validateOptions(result, ruleName, {
    actual: primary,
    possible: [true, false],
  })
  if (!validOptions || !primary) return

  root.walkDecls((decl) => {
    const offset = decl.toString().indexOf(decl.value)
    let match

    HEX_PATTERN.lastIndex = 0
    while ((match = HEX_PATTERN.exec(decl.value)) !== null) {
      const literal = match[0]
      const expanded = expandHex(match[1])
      if (!expanded) continue

      const index = offset + match.index
      const endIndex = index + literal.length
      const retiredName = RETIRED_HEXES.get(`#${expanded.toLowerCase()}`)

      if (retiredName) {
        stylelint.utils.report({
          message: messages.retired(literal, retiredName),
          node: decl,
          index,
          endIndex,
          result,
          ruleName,
        })
        continue
      }

      const { hue, saturation, lightness } = toHsl(expanded)
      const isWarm =
        hue >= WARM_HUE_MIN &&
        hue <= WARM_HUE_MAX &&
        saturation >= MIN_SATURATION &&
        lightness >= MIN_LIGHTNESS &&
        lightness <= MAX_LIGHTNESS

      if (isWarm) {
        stylelint.utils.report({
          message: messages.warmHue(literal, hue),
          node: decl,
          index,
          endIndex,
          result,
          ruleName,
        })
      }
    }
  })
}

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = meta

module.exports = stylelint.createPlugin(ruleName, ruleFunction)
