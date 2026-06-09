// useGameOfWeek — fetch the most recent active featured_games row,
// then resolve its IGDB data, community avg rating, and time-to-beat.
//
// Returns { featured, loading, error }
//   featured: null when no active row; otherwise:
//   {
//     igdbGameId, blurb, title, year, coverUrl,
//     avgRating,        — null when zero community reviews
//     reviewCount,      — number of reviews used for avg (≥1)
//     ttbNormallyHours, — null when IGDB has no TTB entry
//   }
//
// Only real data is surfaced. No fabrication.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../services/supabase'
import { igdbRequest } from '../services/igdb'
import { getReviewsForGame } from '../services/reviewService'
import { getTimeToBeat } from '../services/timeToBeatService'
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
      `fields name, cover.image_id, first_release_date;\nwhere id = ${igdbGameId};\nlimit 1;`
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
    title: igdbGame.name,
    year,
    coverUrl,
    bgUrl,
    avgRating,
    reviewCount: ratedReviews.length,
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
