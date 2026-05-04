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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract the dominant swatch { r, g, b } from a game cover.
 * Used by the existing poster-glow / backdrop feature.
 * Failures are cached so we never retry in the same session.
 */
export async function getDominantColor(imageUrl) {
  if (!imageUrl) return null
  const key = `dom:${imageUrl}`
  if (memCache.has(key)) return memCache.get(key)

  try {
    const palette = await Vibrant.from(imageUrl).getPalette()
    const swatch =
      palette.Vibrant ||
      palette.Muted ||
      palette.DarkVibrant ||
      palette.DarkMuted

    if (!swatch) {
      memCache.set(key, null)
      return null
    }

    const [r, g, b] = swatch.rgb
    const result = { r: Math.round(r), g: Math.round(g), b: Math.round(b) }
    memCache.set(key, result)
    return result
  } catch {
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
