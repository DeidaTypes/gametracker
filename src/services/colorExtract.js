import { Vibrant } from 'node-vibrant/browser'

// ── In-memory session cache ─────────────────────────────────────────────────
// Two namespaces so getDominantColor and getGameSwatches don't collide.
const memCache = new Map()

// ── WCAG relative luminance (linearised sRGB) ───────────────────────────────
function getLuminance(r, g, b) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// ── localStorage LRU helpers (swatches only) ────────────────────────────────
const LS_KEY = 'gameColorCache_v1'
const MAX_ENTRIES = 200

function loadLSCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { order: [], data: {} }
    return JSON.parse(raw)
  } catch {
    return { order: [], data: {} }
  }
}

function saveLSCache(cache) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    // Storage quota exceeded — silently drop
  }
}

function readFromLS(gameId) {
  const cache = loadLSCache()
  if (!(gameId in cache.data)) return undefined
  // Promote to most-recently-used
  cache.order = [gameId, ...cache.order.filter((id) => id !== gameId)]
  saveLSCache(cache)
  return cache.data[gameId]
}

function writeToLS(gameId, value) {
  const cache = loadLSCache()
  cache.order = [gameId, ...cache.order.filter((id) => id !== gameId)]
  cache.data[gameId] = value
  while (cache.order.length > MAX_ENTRIES) {
    const oldest = cache.order.pop()
    delete cache.data[oldest]
  }
  saveLSCache(cache)
}

// ── RGB → HSL helper ────────────────────────────────────────────────────────
function rgbToHsl(r, g, b) {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = d / (1 - Math.abs(2 * l - 1))

  let h = 0
  if (max === rf) h = ((gf - bf) / d) % 6
  else if (max === gf) h = (bf - rf) / d + 2
  else h = (rf - gf) / d + 4

  h = ((h * 60) + 360) % 360
  return { h, s, l }
}

// ── HSL → RGB helper (inverse of rgbToHsl above) ────────────────────────────
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r1 = 0, g1 = 0, b1 = 0
  if (h < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

// A raw extracted swatch can be too dark or too desaturated (reads as
// gray, not "the game's color") to double as BOTH a text color on the
// dark app background AND a button fill behind dark-ink text. The
// luminance a given hue needs to clear 4.5:1 (WCAG AA) varies a lot —
// e.g. a saturated blue needs to be much lighter than a saturated
// yellow to read the same contrast — so a single fixed lightness clamp
// either washes out every color to the palest hue's requirement or
// still fails AA on the worst ones (blue/red). normalizeAccentColor
// below binary-searches lightness PER HUE instead, preserving the
// game's actual hue/saturation and only lifting lightness as far as
// that specific hue needs.
const ACCENT_MIN_SATURATION = 0.40
const AA_TARGET_CONTRAST = 4.5

// The app's dark navy background AND the Done button's dark-ink text
// (--color-bg-primary, #0a0f1f) are effectively the same luminance, so
// one target luminance clears AA for both "accent text on navy" and
// "dark ink on accent fill" simultaneously.
const BG_LUMINANCE = getLuminance(10, 15, 31)
const ACCENT_TARGET_LUMINANCE = AA_TARGET_CONTRAST * (BG_LUMINANCE + 0.05) - 0.05

/**
 * Normalize a raw extracted { r, g, b } swatch into a UI-safe accent for
 * use as BOTH a text color (eyebrow, on dark navy) and a button fill
 * (Done button, under dark ink text) — preserving the game's actual hue
 * while guaranteeing WCAG AA (4.5:1) either way. Pass-through of
 * null/undefined so callers can chain without a guard.
 */
export function normalizeAccentColor(rgb) {
  if (!rgb) return null
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const safeS = Math.max(ACCENT_MIN_SATURATION, s)

  // Binary-search the minimal lightness (for this hue/saturation) that
  // clears the target luminance. Converges in a handful of iterations;
  // 16 is generous headroom.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    const candidate = hslToRgb(h, safeS, mid)
    const lum = getLuminance(candidate.r, candidate.g, candidate.b)
    if (lum < ACCENT_TARGET_LUMINANCE) lo = mid
    else hi = mid
  }
  return hslToRgb(h, safeS, hi)
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract the visually dominant { r, g, b } swatch from a game cover using a
 * canvas histogram.
 *
 * Algorithm:
 *   1. Draw the cover to a 32×32 offscreen canvas (fast, enough pixels).
 *   2. Convert each pixel to HSL.
 *   3. Discard near-black (L < 10%), near-white (L > 90%), and near-gray
 *      (S < 20%) — these are backgrounds/borders, never the dominant art hue.
 *   4. Quantise the remaining hues into 18 buckets (one per 20°).
 *   5. The bucket with the most votes wins; average its original RGB values
 *      for a representative color.
 *   6. If no qualifying pixels exist, fall back to deep navy { 40, 50, 80 }.
 *
 * Results are cached in the module-level `memCache` Map so repeated mounts
 * of the same cover do not re-extract.
 */
export async function getDominantColor(imageUrl) {
  if (!imageUrl) return null
  const key = `dom:${imageUrl}`
  if (memCache.has(key)) return memCache.get(key)

  const FALLBACK = { r: 40, g: 50, b: 80 }

  try {
    const result = await new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onerror = () => reject(new Error('Image load failed'))

      img.onload = () => {
        try {
          const SIZE = 32
          const canvas = document.createElement('canvas')
          canvas.width = SIZE
          canvas.height = SIZE
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, SIZE, SIZE)

          const { data } = ctx.getImageData(0, 0, SIZE, SIZE)

          // 18 hue buckets × 20° — accumulate r/g/b sums and pixel counts
          const buckets = Array.from({ length: 18 }, () => ({
            count: 0,
            r: 0,
            g: 0,
            b: 0,
          }))

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const a = data[i + 3]

            if (a < 128) continue // skip transparent/semi-transparent

            const { h, s, l } = rgbToHsl(r, g, b)

            // Discard near-black, near-white, and desaturated (gray) pixels
            if (l < 0.10 || l > 0.90 || s < 0.20) continue

            const bucket = Math.floor(h / 20) % 18
            buckets[bucket].count += 1
            buckets[bucket].r += r
            buckets[bucket].g += g
            buckets[bucket].b += b
          }

          // Find the hue bucket with the most qualifying pixels
          let bestIdx = -1
          let bestCount = 0
          for (let i = 0; i < 18; i++) {
            if (buckets[i].count > bestCount) {
              bestCount = buckets[i].count
              bestIdx = i
            }
          }

          if (bestIdx === -1) {
            // No saturated pixels found — extremely dark/monochrome cover
            resolve(FALLBACK)
            return
          }

          const { count, r: rSum, g: gSum, b: bSum } = buckets[bestIdx]
          resolve({
            r: Math.round(rSum / count),
            g: Math.round(gSum / count),
            b: Math.round(bSum / count),
          })
        } catch (err) {
          reject(err)
        }
      }

      img.src = imageUrl
    })

    memCache.set(key, result)
    return result
  } catch {
    // Image failed to load (CORS, 404, etc.) — cache null so we don't retry
    memCache.set(key, null)
    return null
  }
}

/**
 * Extract and persist the full swatch palette for a game cover image.
 *
 * Returns { vibrant, vibrantDark, muted } — each field is { r, g, b } —
 * or null when:
 *   • extraction fails (CORS, no image)
 *   • the vibrant swatch's luminance is below 0.18 (dark cover → would
 *     make chrome elements unreadable on the dark app background)
 *
 * Caching strategy:
 *   1. In-memory (session) — avoids redundant Vibrant passes.
 *   2. localStorage LRU (up to 200 entries) — survives re-visits.
 *      Key is igdbGameId; cover art doesn't change so TTL is indefinite.
 */
export async function getGameSwatches(imageUrl, gameId) {
  if (!imageUrl || !gameId) return null

  const memKey = `sw:${gameId}`
  if (memCache.has(memKey)) return memCache.get(memKey)

  // Persistent cache hit
  const persisted = readFromLS(gameId)
  if (persisted !== undefined) {
    memCache.set(memKey, persisted)
    return persisted
  }

  try {
    const palette = await Vibrant.from(imageUrl).getPalette()
    const vibrantSwatch = palette.Vibrant
    const darkSwatch = palette.DarkVibrant
    const mutedSwatch = palette.Muted || palette.DarkMuted

    if (!vibrantSwatch) {
      writeToLS(gameId, null)
      memCache.set(memKey, null)
      return null
    }

    const [vr, vg, vb] = vibrantSwatch.rgb
    // Dark covers: luminance < 0.18 would make tinted chrome unreadable
    if (getLuminance(vr, vg, vb) < 0.18) {
      writeToLS(gameId, null)
      memCache.set(memKey, null)
      return null
    }

    const vibrant = { r: Math.round(vr), g: Math.round(vg), b: Math.round(vb) }

    // DarkVibrant is usually a darker shade of the same hue — ideal for
    // gradient bottoms. Fall back to a 65% brightness version of vibrant.
    const vibrantDark = darkSwatch
      ? {
          r: Math.round(darkSwatch.rgb[0]),
          g: Math.round(darkSwatch.rgb[1]),
          b: Math.round(darkSwatch.rgb[2]),
        }
      : {
          r: Math.round(vr * 0.65),
          g: Math.round(vg * 0.65),
          b: Math.round(vb * 0.65),
        }

    const muted = mutedSwatch
      ? {
          r: Math.round(mutedSwatch.rgb[0]),
          g: Math.round(mutedSwatch.rgb[1]),
          b: Math.round(mutedSwatch.rgb[2]),
        }
      : null

    const result = { vibrant, vibrantDark, muted }
    writeToLS(gameId, result)
    memCache.set(memKey, result)
    return result
  } catch {
    writeToLS(gameId, null)
    memCache.set(memKey, null)
    return null
  }
}
