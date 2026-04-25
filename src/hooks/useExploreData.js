import { useState, useEffect } from 'react'
import { fetchGamesByCategory } from '../services/exploreService'
import { getAllReviews } from '../services/reviewService'
import { getGamesFromList, getLibrary } from '../services/libraryService'
import { getProfile } from '../services/profileService'
import { rawgRequest } from '../services/rawg'
import { getCategoryDefinitions, fetchBrowseCategories } from '../services/browseService'
import { getBestImageUrl } from '../services/imageUtils'

export function useFeaturedGame() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const games = await fetchGamesByCategory('popular', 5)
        if (cancelled) return

        if (!games || games.length === 0) {
          setData(null)
          return
        }

        const top = games[0]
        const heroImage = getBestImageUrl(top, 1920) || top.image
        const rawDesc = top.description || ''
        const plainDesc = rawDesc.replace(/<[^>]*>/g, '').trim()
        const blurb = plainDesc
          ? plainDesc.slice(0, 140).trim() + (plainDesc.length > 140 ? '\u2026' : '')
          : ''

        const library = getLibrary()
        let logsThisWeek = 0
        if (library && library.lists) {
          const weekAgo = Date.now() - 7 * 86400000
          for (const list of Object.values(library.lists)) {
            for (const g of list.games || []) {
              if (g.addedAt && new Date(g.addedAt).getTime() > weekAgo) {
                logsThisWeek++
              }
            }
          }
        }

        setData({
          id: top.id,
          title: top.title,
          image: top.image,
          heroImage,
          eyebrow: 'MOST POPULAR',
          blurb,
          rating: parseFloat(top.rating) || 0,
          logsThisWeek,
          genre: top.genre || '',
        })
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load featured game')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

export function useRecentReviews() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const allReviews = getAllReviews()
    if (!allReviews || allReviews.length === 0) {
      setData(null)
      setLoading(false)
      return
    }

    const profile = getProfile()
    const userName = profile?.displayName || profile?.username || 'You'
    const userAvatar = profile?.avatar || null

    const now = Date.now()
    const weekAgo = now - 7 * 86400000
    const monthAgo = now - 30 * 86400000

    let filtered = allReviews.filter(
      (r) => r.date && new Date(r.date).getTime() > weekAgo
    )
    if (filtered.length < 3) {
      filtered = allReviews.filter(
        (r) => r.date && new Date(r.date).getTime() > monthAgo
      )
    }
    if (filtered.length === 0) {
      filtered = allReviews.slice()
    }

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date))

    const mapped = filtered.slice(0, 10).map((r, i) => ({
      id: `review-${i}-${r.gameId}`,
      user: {
        name: r.userName || userName,
        avatar: userAvatar,
      },
      timeAgo: formatTimeAgo(r.date),
      game: {
        id: r.gameId,
        title: r.gameTitle,
        image: r.gameImage || null,
      },
      excerpt: r.text || '',
      rating: Math.round(parseFloat(r.rating) || 0),
    }))

    setData(mapped.length > 0 ? mapped : null)
    setLoading(false)
  }, [])

  return { data, loading }
}

export function useEditorialStats() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const library = getLibrary()
    const allReviews = getAllReviews()

    let totalGamesLogged = 0
    if (library && library.lists) {
      for (const list of Object.values(library.lists)) {
        totalGamesLogged += (list.games || []).length
      }
    }
    if (library && library.customLists) {
      for (const list of Object.values(library.customLists)) {
        totalGamesLogged += (list.games || []).length
      }
    }

    const weekAgo = Date.now() - 7 * 86400000
    const reviewsThisWeek = (allReviews || []).filter(
      (r) => r.date && new Date(r.date).getTime() > weekAgo
    ).length

    if (totalGamesLogged === 0 && reviewsThisWeek === 0) {
      setData(null)
    } else {
      setData({ totalGamesLogged, reviewsThisWeek })
    }
    setLoading(false)
  }, [])

  return { data, loading }
}

export function useCurrentlyPlaying() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const games = getGamesFromList('currently-playing')
    if (!games || games.length === 0) {
      setData(null)
    } else {
      setData(games)
    }
    setLoading(false)
  }, [])

  return { data, loading }
}

export function useGenres() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const categories = await fetchBrowseCategories()
        if (cancelled) return

        const tiles = categories
          .filter((c) => c.games && c.games.length > 0)
          .map((c) => ({
            key: c.key,
            label: c.label,
            count: c.games.length,
            image: c.coverImage || (c.games[0] ? c.games[0].image : null),
          }))

        setData(tiles.length > 0 ? tiles : null)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load genres')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}
