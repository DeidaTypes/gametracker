import { supabase } from './supabase'
import { getDominantColor } from './colorExtract'

/**
 * Game Color Service — cached dominant/accent color per game.
 *
 * Schema (game_colors — see supabase/migrations/20260731170000_game_colors_dominant_color.sql):
 *   igdb_game_id    bigint  PRIMARY KEY
 *   dominant_color  text    "R G B" space-separated triple (nullable)
 *   updated_at      timestamptz
 *
 * Cover art never changes for a given game, so the extracted color is a
 * pure function of `igdb_game_id` — one row is shared by every user who
 * ever finishes that game. The first finish (by anyone, on any device)
 * extracts and persists the color; every finish after that reads the
 * cached row and never re-runs the canvas extraction.
 *
 * Writes go through the upsert_game_color RPC (see
 * supabase/migrations/20260803000700_lock_game_colors_writes.sql), not a
 * direct table write — game_colors has no INSERT/UPDATE policy for
 * authenticated anymore, since "any signed-in user can overwrite any game's
 * cached color" was an open write path with no ownership check possible
 * (the table has no owner column). The RPC is SECURITY DEFINER and validates
 * the payload server-side before upserting.
 */

const TABLE = 'game_colors'

// In-memory session cache — avoids a redundant read for the same game
// within one page load (e.g. re-render, or a second celebration queued
// back-to-back).
const memCache = new Map()

function parseRgbTriple(value) {
  if (!value) return null
  const parts = String(value).trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  const [r, g, b] = parts
  return { r, g, b }
}

function toRgbTriple(rgb) {
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

/**
 * Get the dominant color for a game, extracting + persisting it on a
 * cache miss. Returns null when there's no cover to extract from or the
 * extraction fails — callers should fall back to a neutral, non-blue
 * token (e.g. --finish-fallback) rather than crash or guess.
 *
 * @param {number|string} igdbGameId
 * @param {string|null} imageUrl   cover art — only read on a cache miss
 * @returns {Promise<{ r: number, g: number, b: number } | null>}
 */
export async function getOrExtractGameColor(igdbGameId, imageUrl) {
  if (igdbGameId == null) return null
  const key = String(igdbGameId)

  if (memCache.has(key)) return memCache.get(key)

  // 1. Cached on the shared game_colors row?
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('dominant_color')
      .eq('igdb_game_id', Number(igdbGameId))
      .maybeSingle()

    if (error) {
      console.error('[gameColor] read failed:', error.message)
    } else if (data?.dominant_color) {
      const cached = parseRgbTriple(data.dominant_color)
      if (cached) {
        memCache.set(key, cached)
        return cached
      }
    }
  } catch (err) {
    console.error('[gameColor] read crashed:', err)
  }

  // 2. Cache miss — extract now (first finish of this game, ever) and
  //    persist so no one else has to re-extract it.
  if (!imageUrl) return null

  const extracted = await getDominantColor(imageUrl)
  if (!extracted) return null

  memCache.set(key, extracted)

  try {
    const { error } = await supabase.rpc('upsert_game_color', {
      p_igdb_game_id: Number(igdbGameId),
      p_dominant_color: toRgbTriple(extracted),
    })
    if (error) console.error('[gameColor] write failed:', error.message)
  } catch (err) {
    console.error('[gameColor] write crashed:', err)
  }

  return extracted
}
