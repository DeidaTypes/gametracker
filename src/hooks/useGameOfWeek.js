// useGameOfWeek — weekly Game of the Week selection.
//
// Selection priority:
//   1. Community signal — the highest avg-rated game with ≥ MIN_WEEKLY_RATINGS
//      distinct ratings posted in the past 7 days.
//   2. Curated fallback — deterministic rotation through a pool of real
//      acclaimed games, seeded by ISO year×week so the pick changes each
//      week and is stable within the week. No fabrication: every ID in the
//      pool is a verified IGDB game ID.
//
// Returns { featured, loading, error }
//   featured: null when nothing resolves; otherwise the enriched game object.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../services/supabase'
import { igdbRequest } from '../services/igdb'
import { getReviewsForGame } from '../services/reviewService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { computeDNAPortrait } from '../services/dnaService'
import { APP_RESUMED_EVENT } from './useAppResume'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Minimum number of distinct ratings posted in the past 7 days for a game
 * to qualify as the community pick. Below this threshold the curated fallback
 * is used instead.
 */
const MIN_WEEKLY_RATINGS = 3

/**
 * Curated pool of real, critically acclaimed games by IGDB ID.
 * These are the only values ever shown via the fallback path.
 * Do NOT add fictional or unverified IDs — if IGDB can't resolve an ID the
 * code will skip it and try the next entry, so a bad ID degrades gracefully
 * but wastes a network round-trip.
 */
const CURATED_POOL = [
  119171, // Elden Ring (FromSoftware, 2022)
    1942, // The Witcher 3: Wild Hunt (CD Projekt, 2015)
   25076, // Red Dead Redemption 2 (Rockstar, 2018)
   26226, // God of War (Sony Santa Monica, 2018)
  134645, // Hades (Supergiant Games, 2020)
   36118, // Hollow Knight (Team Cherry, 2017)
  115288, // Baldur's Gate 3 (Larian Studios, 2023)
  103298, // Disco Elysium (ZA/UM, 2019)
  105049, // Celeste (Matt Makes Games, 2018)
   11133, // Dark Souls III (FromSoftware, 2016)
  101468, // Sekiro: Shadows Die Twice (FromSoftware, 2019)
    7346, // The Legend of Zelda: Breath of the Wild (Nintendo, 2017)
]

// ── ISO week seed ─────────────────────────────────────────────────────────────

/**
 * Returns a numeric seed that is unique per ISO year×week (e.g. 202626).
 * Advances each Monday; stays constant for the rest of the week.
 */
function getISOWeekSeed() {
  const now = new Date()
  // Work in UTC to avoid DST edge cases
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = d.getUTCDay() || 7 // Sun=0 → 7 so Monday=1 … Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // Shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return d.getUTCFullYear() * 100 + weekNum
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
}

function bgUrlFromCoverUrl(coverUrl) {
  if (!coverUrl) return null
  return coverUrl.replace('t_cover_big', 't_cover_big_2x')
}

/**
 * Fetch IGDB metadata, community reviews, and time-to-beat for one game,
 * then assemble the full featured-game object.
 *
 * Returns null when IGDB cannot resolve the game (unknown ID, network error).
 * All other fields degrade to null gracefully — nothing is fabricated.
 */
async function enrichGame(igdbGameId) {
  const [igdbResult, reviewsResult, ttbResult] = await Promise.allSettled([
    igdbRequest(
      'games',
      `fields name, cover.image_id, first_release_date, genres.name;\nwhere id = ${igdbGameId};\nlimit 1;`
    ),
    getReviewsForGame(igdbGameId),
    getTimeToBeat(igdbGameId),
  ])

  const igdbGame =
    igdbResult.status === 'fulfilled' ? igdbResult.value?.[0] ?? null : null
  if (!igdbGame) return null // IGDB data is mandatory; skip this game

  const coverUrl = igdbGame.cover?.image_id
    ? coverUrlFromImageId(igdbGame.cover.image_id)
    : null
  const bgUrl = bgUrlFromCoverUrl(coverUrl)
  const year = igdbGame.first_release_date
    ? new Date(igdbGame.first_release_date * 1000).getFullYear()
    : null

  const reviews =
    reviewsResult.status === 'fulfilled' ? reviewsResult.value ?? [] : []
  const ratedReviews = reviews.filter(
    (r) => r.rating != null && Number(r.rating) > 0
  )
  const avgRating =
    ratedReviews.length > 0
      ? ratedReviews.reduce((sum, r) => sum + Number(r.rating), 0) /
        ratedReviews.length
      : null

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weeklyReviewCount = reviews.filter(
    (r) => r.created_at && new Date(r.created_at).getTime() >= oneWeekAgo
  ).length

  let pickReason = null
  if (weeklyReviewCount >= 1) {
    pickReason =
      weeklyReviewCount === 1
        ? '1 review this week'
        : `${weeklyReviewCount} reviews this week`
  }

  // Taste link — compare game genres (IGDB) vs user's top genres (DNA portrait)
  const dna = computeDNAPortrait()
  const gameGenreNames = Array.isArray(igdbGame.genres)
    ? igdbGame.genres.map((g) => g.name).filter(Boolean)
    : []
  const userTopGenreNames = (dna.topGenres || []).map((g) => g.name)
  const tasteGenre =
    gameGenreNames.find((g) => userTopGenreNames.includes(g)) ?? null
  const personalizedBlurb = tasteGenre
    ? `A ${tasteGenre} pick — right in your wheelhouse.`
    : null

  const ttb = ttbResult.status === 'fulfilled' ? ttbResult.value : null
  const ttbNormallyHours =
    ttb?.normallySeconds != null
      ? Math.round(ttb.normallySeconds / 3600)
      : null

  return {
    igdbGameId,
    blurb: null,
    personalizedBlurb,
    title: igdbGame.name,
    year,
    coverUrl,
    bgUrl,
    avgRating,
    reviewCount: ratedReviews.length,
    weeklyReviewCount,
    pickReason,
    ttbNormallyHours,
  }
}

// ── Core data loader ─────────────────────────────────────────────────────────

async function loadFeaturedGame() {
  // ── 1. Community signal ──────────────────────────────────────────────────
  // Query all rated reviews from the past 7 days, aggregate per game, and
  // pick the highest avg-rated game that clears the minimum-ratings threshold.
  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentRatings } = await supabase
    .from('reviews')
    .select('igdb_game_id, rating')
    .gte('created_at', sinceIso)
    .not('rating', 'is', null)
    .gt('rating', 0)
    .limit(500)

  if (recentRatings && recentRatings.length > 0) {
    const byGame = new Map()
    for (const row of recentRatings) {
      if (row.igdb_game_id == null) continue
      const key = Number(row.igdb_game_id)
      const entry = byGame.get(key) ?? { sum: 0, count: 0 }
      entry.sum += Number(row.rating)
      entry.count += 1
      byGame.set(key, entry)
    }

    const qualified = Array.from(byGame.entries())
      .filter(([, v]) => v.count >= MIN_WEEKLY_RATINGS)
      .sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count))

    if (qualified.length > 0) {
      const [topGameId] = qualified[0]
      const enriched = await enrichGame(topGameId)
      if (enriched) return enriched
    }
  }

  // ── 2. Curated fallback — ISO-week-seeded rotation ───────────────────────
  // The seed advances each Monday so the featured game changes weekly.
  // We iterate from the seed position so a bad ID never silently blocks
  // the hero — the next valid game in the pool is shown instead.
  const seed = getISOWeekSeed()
  const startIdx = seed % CURATED_POOL.length
  for (let i = 0; i < CURATED_POOL.length; i++) {
    const igdbGameId = CURATED_POOL[(startIdx + i) % CURATED_POOL.length]
    const enriched = await enrichGame(igdbGameId)
    if (enriched) return enriched
  }

  return null
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useGameOfWeek() {
  const [featured, setFeatured] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadFeaturedGame()
      setFeatured(data)
    } catch (err) {
      console.error('[useGameOfWeek] error:', err)
      setError(err?.message ?? 'Failed to load')
      setFeatured(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadFeaturedGame()
      .then((data) => { if (!cancelled) setFeatured(data) })
      .catch((err) => {
        if (!cancelled) {
          console.error('[useGameOfWeek] error:', err)
          setError(err?.message ?? 'Failed to load')
          setFeatured(null)
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch on Capacitor foreground return
  useEffect(() => {
    const onResume = () => run().catch(() => {})
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [run])

  return { featured, loading, error }
}
