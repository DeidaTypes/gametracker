import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Star, Gamepad2, Sparkles, BookmarkPlus } from 'lucide-react'
import {
  getGamingMap,
  getGenrePool,
  getGoodPlacesToStart,
  getGenreTotalCount,
  fetchGenrePageLive,
  GENRE_SORTS,
} from '../services/gamingMapService'
import { rankOnRamps } from '../services/onRamps'
import { getTasteVector } from '../services/tasteEngineService'
import { genreBySlug } from '../services/igdbGenres'
import { genreIcon } from '../utils/genreIcons'
import { genreColorVar } from '../utils/genreColors'
import {
  genreDisplayName,
  formatGameCount,
  genreDetailTierPhrase,
  shortPlayerLabelFor,
} from '../utils/gamingMapFormat'
import GenrePosterCard from '../components/explore/GenrePosterCard'
import { GameCardSkeletonGrid } from '../components/skeletons/GameCardSkeleton'
import './GenreDetail.css'

const PAGE_SIZE = 24

const SORT_CHIPS = [
  { key: 'top_rated', label: 'Top rated', Icon: Star },
  { key: 'popular', label: 'Popular', Icon: Gamepad2 },
  { key: 'new', label: 'New', Icon: Sparkles },
  { key: 'easy_start', label: 'Easy start', Icon: BookmarkPlus },
]

const SORT_LABEL_LOWER = {
  top_rated: 'top rated',
  popular: 'popular',
  new: 'new',
  easy_start: 'easy start',
}

/**
 * Genre detail — opened by tapping any tile on Your Gaming Map.
 *
 * Layout: header (genre name + real IGDB total count) → sort chips → a
 * "Good places to start" on-ramp strip → the full ranked poster grid,
 * paginating live once G2's cached pool for this (genre, sort) is
 * exhausted. Every read is a cache hit except two deliberate exceptions:
 * getGenreTotalCount (a single COUNT, not rows) and fetchGenrePageLive
 * (only once the cache reports exhausted).
 *
 * "Easy start" isn't one of G2's stored sort_keys — it re-ranks the
 * top_rated pool (and, once that's exhausted, live top_rated pages) with
 * rankOnRamps, the same on-ramp model the "Good places to start" strip
 * uses. That keeps "what counts as an easy start" defined in exactly one
 * place (src/services/onRamps.js).
 */
function GenreDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const genre = genreBySlug(slug)

  const [sort, setSort] = useState('top_rated')
  const [items, setItems] = useState([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [mapGenre, setMapGenre] = useState(null) // this genre's own tier/stats
  const [homeTurfGenre, setHomeTurfGenre] = useState(null)
  const [totalCount, setTotalCount] = useState(null)
  const [goodPlaces, setGoodPlaces] = useState(null) // null = loading, [] = none

  const cursorRef = useRef(null)
  const seenIdsRef = useRef(new Set())
  const fetchTokenRef = useRef(0)
  const isFetchingRef = useRef(false)
  const sentinelRef = useRef(null)

  // ── Header context: this genre's tier/stats + the user's top home-turf
  // genre (for "Good places to start · for an RPG player" personalization).
  useEffect(() => {
    if (!genre) return
    let cancelled = false
    getGamingMap().then((map) => {
      if (cancelled || !map) return
      setMapGenre(map.genres.find((g) => g.id === genre.id) || null)
      const homeTurf = map.genres
        .filter((g) => g.tier === 'home_turf')
        .sort((a, b) => a.tierRank - b.tierRank)[0]
      setHomeTurfGenre(homeTurf || null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [genre])

  useEffect(() => {
    if (!genre) return
    let cancelled = false
    getGenreTotalCount(genre.id).then((count) => { if (!cancelled) setTotalCount(count) })
    return () => { cancelled = true }
  }, [genre])

  useEffect(() => {
    if (!genre) return
    let cancelled = false
    getGoodPlacesToStart(genre.id, { limit: 12 })
      .then((rows) => { if (!cancelled) setGoodPlaces(rows) })
      .catch(() => { if (!cancelled) setGoodPlaces([]) })
    return () => { cancelled = true }
  }, [genre])

  // ── Main grid: cache-first pagination per sort, live fallback once the
  // cached pool reports exhausted. "easy_start" ranks the cached top_rated
  // pool locally instead of reading a stored sort_key.
  const loadPage = useCallback(async (sortKey, reset) => {
    if (!genre) return
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    const token = reset ? ++fetchTokenRef.current : fetchTokenRef.current

    if (reset) {
      cursorRef.current = { cacheOffset: 0, cacheExhausted: false, liveOffset: 0, rankedPool: null, rankedIdx: 0 }
      seenIdsRef.current = new Set()
      setItems([])
      setHasMore(true)
      setLoadingInitial(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const cur = cursorRef.current
      let pageGames = []
      let more = true

      if (sortKey === 'easy_start') {
        if (!cur.rankedPool) {
          const [pool, vector] = await Promise.all([
            getGenrePool(genre.id, 'top_rated', { limit: 100, offset: 0 }),
            getTasteVector().catch(() => null),
          ])
          cur.rankedPool = rankOnRamps(pool.games, vector)
          cur.rankedIdx = 0
        }
        if (cur.rankedIdx < cur.rankedPool.length) {
          pageGames = cur.rankedPool.slice(cur.rankedIdx, cur.rankedIdx + PAGE_SIZE)
          cur.rankedIdx += pageGames.length
          more = true
        } else {
          const [liveGames, vector] = await Promise.all([
            fetchGenrePageLive(genre.id, 'top_rated', { offset: cur.liveOffset, limit: PAGE_SIZE }),
            getTasteVector().catch(() => null),
          ])
          cur.liveOffset += liveGames.length
          pageGames = rankOnRamps(liveGames, vector)
          more = liveGames.length >= PAGE_SIZE
        }
      } else if (GENRE_SORTS.includes(sortKey)) {
        if (!cur.cacheExhausted) {
          const res = await getGenrePool(genre.id, sortKey, { limit: PAGE_SIZE, offset: cur.cacheOffset })
          cur.cacheOffset += res.games.length
          cur.cacheExhausted = res.exhausted
          pageGames = res.games
          if (pageGames.length === 0 && cur.cacheExhausted) {
            const liveGames = await fetchGenrePageLive(genre.id, sortKey, { offset: cur.liveOffset, limit: PAGE_SIZE })
            cur.liveOffset += liveGames.length
            pageGames = liveGames
            more = liveGames.length >= PAGE_SIZE
          }
        } else {
          const liveGames = await fetchGenrePageLive(genre.id, sortKey, { offset: cur.liveOffset, limit: PAGE_SIZE })
          cur.liveOffset += liveGames.length
          pageGames = liveGames
          more = liveGames.length >= PAGE_SIZE
        }
      }

      // A live page can overlap the tail of the cached pool it continues
      // from — dedupe defensively so scrolling deeper never repeats a tile.
      const fresh = pageGames.filter((g) => !seenIdsRef.current.has(g.id))
      for (const g of fresh) seenIdsRef.current.add(g.id)

      if (token !== fetchTokenRef.current) return
      setItems((prev) => (reset ? fresh : [...prev, ...fresh]))
      setHasMore(more && pageGames.length > 0)
    } catch (err) {
      console.error('[GenreDetail] loadPage failed:', err)
      if (token === fetchTokenRef.current) setHasMore(false)
    } finally {
      isFetchingRef.current = false
      if (token === fetchTokenRef.current) {
        setLoadingInitial(false)
        setLoadingMore(false)
      }
    }
  }, [genre])

  useEffect(() => {
    loadPage(sort, true)
  }, [sort, loadPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          loadPage(sort, false)
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, sort, loadPage])

  if (!genre) {
    return (
      <div className="genre-detail-page genre-detail-page--missing">
        <p>That genre couldn't be found.</p>
        <button type="button" onClick={() => navigate('/discover')}>Back to Discover</button>
      </div>
    )
  }

  const displayName = genreDisplayName(genre.name)
  const Icon = genreIcon(genre.name)
  const accent = genreColorVar(genre.name)
  const tierPhrase = genreDetailTierPhrase(mapGenre?.tier, mapGenre?.stats)
  const subtitle = totalCount != null
    ? `${tierPhrase} · ${formatGameCount(totalCount)}`
    : tierPhrase
  const onRampPersonalization = homeTurfGenre ? shortPlayerLabelFor(homeTurfGenre.slug) : null

  return (
    <div className="genre-detail-page" style={{ '--genre-accent': accent }}>
      <div className="genre-detail__header">
        <button
          type="button"
          className="genre-detail__back"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="genre-detail__heading">
          <h1 className="genre-detail__title">
            <Icon size={22} className="genre-detail__title-icon" aria-hidden="true" />
            {displayName}
          </h1>
          <p className="genre-detail__subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="genre-detail__chips" role="tablist" aria-label="Sort games">
        {SORT_CHIPS.map(({ key, label, Icon: ChipIcon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={sort === key}
            className={`genre-detail__chip${sort === key ? ' genre-detail__chip--active' : ''}`}
            onClick={() => setSort(key)}
          >
            <ChipIcon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {goodPlaces && goodPlaces.length > 0 && (
        <section className="genre-detail__onramp" aria-label="Good places to start">
          <div className="genre-detail__onramp-head">
            <span className="genre-detail__onramp-label">
              <BookmarkPlus size={14} aria-hidden="true" />
              Good places to start
            </span>
            {onRampPersonalization && (
              <span className="genre-detail__onramp-sub">{onRampPersonalization}</span>
            )}
          </div>
          <div className="genre-detail__onramp-row">
            {goodPlaces.map((game) => (
              <div className="genre-detail__onramp-item" key={game.id}>
                <GenrePosterCard game={game} />
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="genre-detail__all-label">
        All {displayName} · {SORT_LABEL_LOWER[sort]}
      </h2>

      {loadingInitial ? (
        <GameCardSkeletonGrid count={9} />
      ) : items.length === 0 ? (
        <div className="genre-detail__empty" role="status">
          <p>No games to show for this sort yet.</p>
        </div>
      ) : (
        <div className="genre-detail__grid">
          {items.map((game) => (
            <GenrePosterCard key={game.id} game={game} />
          ))}
        </div>
      )}

      {!loadingInitial && hasMore && (
        <div ref={sentinelRef} className="genre-detail__sentinel" aria-hidden="true" />
      )}
      {loadingMore && (
        <div className="genre-detail__loading-more" role="status" aria-label="Loading more games">
          <span className="genre-detail__spinner" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

export default GenreDetail
