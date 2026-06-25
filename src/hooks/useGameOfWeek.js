// useGameOfWeek — fetch the most recent active featured_games row,
// then resolve its IGDB data, community avg rating, and time-to-beat.
//
// Returns { featured, loading, error }
//   featured: null when no active row; otherwise:
//   {
//     igdbGameId, blurb, title, year, coverUrl,
//     avgRating,          — null when zero community reviews
//     reviewCount,        — number of reviews used for avg (≥1)
//     weeklyReviewCount,  — reviews posted in the past 7 days
//     pickReason,         — "N reviews this week" or null on quiet week
//     personalizedBlurb,  — taste-keyed blurb or null when no link
//     ttbNormallyHours,   — null when IGDB has no TTB entry
//   }
//
// Only real data is surfaced. No fabrication.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../services/supabase'
import { igdbRequest } from '../services/igdb'
import { getReviewsForGame } from '../services/reviewService'
import { getTimeToBeat } from '../services/timeToBeatService'
import { computeDNAPortrait } from '../services/dnaService'
import { APP_RESUMED_EVENT } from './useAppResume'

// ── Helpers ─────────────────────────────────────────────────────────────────

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
}

/**
 * Given a cover_big URL, return a 2x version for the blurred background.
 * Falls back to the original URL if the replacement fails.
 */
function bgUrlFromCoverUrl(coverUrl) {
  if (!coverUrl) return null
  return coverUrl.replace('t_cover_big', 't_cover_big_2x')
}

// ── Core data loader ─────────────────────────────────────────────────────────

async function loadFeaturedGame() {
  // 1. Fetch most recent active featured_games row
  const { data: row, error: dbErr } = await supabase
    .from('featured_games')
    .select('id, igdb_game_id, blurb, created_at')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (dbErr) throw dbErr
  if (!row) return null // no active row → hero hides

  const igdbGameId = row.igdb_game_id

  // 2. Parallel: IGDB metadata, community reviews, time-to-beat
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

  // IGDB data is required — without it we can't show cover/title
  if (!igdbGame) return null

  const coverUrl = igdbGame.cover?.image_id
    ? coverUrlFromImageId(igdbGame.cover.image_id)
    : null
  const bgUrl = bgUrlFromCoverUrl(coverUrl)
  const year = igdbGame.first_release_date
    ? new Date(igdbGame.first_release_date * 1000).getFullYear()
    : null

  // Avg rating — only from real community reviews
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

  // Weekly review count — reviews posted in the last 7 days
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weeklyReviewCount = reviews.filter(
    (r) => r.created_at && new Date(r.created_at).getTime() >= oneWeekAgo
  ).length

  // Pick reason — surfaced only when there is genuine community activity
  // this week; null on a quiet week (no fabrication).
  let pickReason = null
  if (weeklyReviewCount >= 1) {
    pickReason =
      weeklyReviewCount === 1
        ? '1 review this week'
        : `${weeklyReviewCount} reviews this week`
  }

  // Taste link — compare game genres (IGDB) vs user's top genres (DNA portrait).
  // computeDNAPortrait() is synchronous and reads only from localStorage / library
  // cache; it degrades to empty arrays when no library data exists.
  const dna = computeDNAPortrait()
  const gameGenreNames = Array.isArray(igdbGame.genres)
    ? igdbGame.genres.map((g) => g.name).filter(Boolean)
    : []
  const userTopGenreNames = (dna.topGenres || []).map((g) => g.name)
  const tasteGenre =
    gameGenreNames.find((g) => userTopGenreNames.includes(g)) ?? null

  // Personalized blurb — only when a genuine genre overlap exists.
  const personalizedBlurb = tasteGenre
    ? `A ${tasteGenre} pick — right in your wheelhouse.`
    : null

  // Time-to-beat "normally" in whole hours — null when IGDB has no entry
  const ttb =
    ttbResult.status === 'fulfilled' ? ttbResult.value : null
  const ttbNormallyHours =
    ttb?.normallySeconds != null
      ? Math.round(ttb.normallySeconds / 3600)
      : null

  return {
    igdbGameId,
    blurb: row.blurb ?? null,
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

  // Load on mount
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

  // Refetch on app resume (Capacitor foreground return)
  useEffect(() => {
    const onResume = () => run().catch(() => {})
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [run])

  return { featured, loading, error }
}
