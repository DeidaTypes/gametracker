import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { resolveBrowseTarget, fetchCategoryPage } from '../services/browseService'
import { getGenreName } from '../services/igdb'
import PillTabs from '../components/PillTabs'
import CoverGridTile, { CoverGridTileSkeleton } from '../components/CoverGridTile'
import EmptyState from '../components/EmptyState'
import ContentSwap, { Arrive } from '../components/motion/ContentSwap'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { MOTION } from '../motion/xMotion'
import { hapticImpact } from '../utils/haptics'
import './CategoryResults.css'

const SKELETON_COUNT = 12
const SKELETONS = Array.from({ length: SKELETON_COUNT }, (_, i) => i)

// The next page starts loading when the user is about two rows from the end.
const LOAD_AHEAD_TILES = 7

const VIEWS = [
  { id: 'popular', label: 'Popular now' },
  { id: 'top', label: 'Top rated' },
  { id: 'new', label: 'New' },
  { id: 'gems', label: 'Hidden gems' },
]

// What each view says when it has no games. Popular now and Top rated should
// never be empty; if one is, the data needs a look, so it says so quietly.
function emptyLine(view, label) {
  if (view === 'new') return label ? `No new ${label} games lately.` : 'No new games lately.'
  if (view === 'gems') return 'No hidden gems here yet.'
  return 'No games here yet.'
}

/* ---------------------------------------------------------------------------
   One visit = one history entry. Everything a visit loaded stays in memory,
   keyed by location.key (not the URL), so switching views back is instant and
   Back from a game returns to the same view and the same games, with the same
   scroll position (App restores the scroll once the page is tall enough).
   --------------------------------------------------------------------------- */
const MAX_VISITS = 20
const visits = new Map()

function getVisit(locationKey, startView) {
  let visit = visits.get(locationKey)
  if (!visit) {
    visit = { view: startView, views: {}, genreName: null }
    visits.set(locationKey, visit)
    if (visits.size > MAX_VISITS) visits.delete(visits.keys().next().value)
  }
  return visit
}

function newSlice() {
  return { games: [], ids: new Set(), page: 0, hasMore: true, widened: false, loaded: false, status: 'idle' }
}

function CategoryResultsPage() {
  const { categoryKey } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { reduced } = useMotionPreference()

  const target = resolveBrowseTarget(categoryKey)
  // A key nobody knows never shows its raw slug.
  const unknownKey = !target
  const genreId = target?.kind === 'genre' ? target.genreId : null

  // The genre name the chip carried, for an instant title. A cold link has
  // none and takes it from the IGDB genre catalog.
  const stateName = typeof location.state?.genreName === 'string' && location.state.genreName
    ? location.state.genreName
    : null

  const visit = getVisit(location.key, target?.view || 'popular')
  const [view, setView] = useState(visit.view)
  const [catalogName, setCatalogName] = useState(visit.genreName)
  const [nameChecked, setNameChecked] = useState(visit.genreName != null)
  const [, rerender] = useReducer((n) => n + 1, 0)

  const mountedRef = useRef(true)
  const pageRef = useRef(null)
  const gridRef = useRef(null)
  const scrollTimerRef = useRef(0)
  // Where the batch that just loaded starts, so only those tiles fade in.
  // Lives with this mount: a remount (Back) shows its tiles as they were.
  const arrivalRef = useRef({ view: null, from: -1 })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(scrollTimerRef.current)
    }
  }, [])

  const categoryLabel = genreId != null
    ? (stateName || catalogName || '')
    : (target?.label || '')

  useEffect(() => {
    if (genreId == null || stateName || visit.genreName != null) return undefined
    let cancelled = false
    getGenreName(genreId)
      .then((name) => {
        if (cancelled) return
        visit.genreName = name
        setCatalogName(name)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNameChecked(true) })
    return () => { cancelled = true }
  }, [genreId, stateName, visit])

  const loadPage = useCallback(async (viewName) => {
    const slice = visit.views[viewName] || (visit.views[viewName] = newSlice())
    if (slice.status === 'loading' || (slice.loaded && !slice.hasMore)) return
    slice.status = 'loading'
    rerender()
    try {
      const result = await fetchCategoryPage(categoryKey, viewName, slice.page, { widened: slice.widened })
      const before = slice.games.length
      for (const game of result.games) {
        if (slice.ids.has(game.id)) continue
        slice.ids.add(game.id)
        slice.games.push(game)
      }
      if (slice.page === 0) slice.widened = result.widened
      arrivalRef.current = { view: viewName, from: slice.page > 0 ? before : -1 }
      slice.page += 1
      slice.hasMore = result.hasMore
      slice.loaded = true
      slice.status = 'idle'
    } catch (err) {
      console.error('Failed to load category games:', err)
      slice.status = 'error'
    }
    if (mountedRef.current) rerender()
  }, [categoryKey, visit])

  // Open the active view. A view the visit already holds is not fetched again.
  useEffect(() => {
    if (unknownKey) return
    const slice = visit.views[view]
    if (!slice || (!slice.loaded && slice.status === 'idle')) loadPage(view)
  }, [view, unknownKey, visit, loadPage])

  const slice = visit.views[view]
  const games = slice?.games || []
  const loaded = !!slice?.loaded
  const hasMore = !!slice?.hasMore
  const status = slice?.status || 'idle'

  // About two rows from the end, the next page starts.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !loaded || !hasMore || status !== 'idle') return undefined
    const tile = grid.children[Math.max(0, games.length - LOAD_AHEAD_TILES)]
    if (!tile) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        const reached = entries.some((e) => (
          e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.bottom ?? window.innerHeight)
        ))
        if (reached) {
          io.disconnect()
          loadPage(view)
        }
      },
      { rootMargin: '0px 0px 160px 0px' },
    )
    io.observe(tile)
    return () => io.disconnect()
  }, [loaded, hasMore, status, games.length, view, loadPage])

  const handleViewChange = (next) => {
    if (next === view) return
    hapticImpact('Light')
    visit.view = next
    arrivalRef.current = { view: null, from: -1 }
    setView(next)
    // The grid goes back to the top once the old view has faded out.
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const scroller = pageRef.current?.closest('.main-content')
      if (scroller) scroller.scrollTop = 0
    }, reduced ? MOTION.reducedFade : MOTION.segOut)
  }

  // A genre id nobody knows: no name from the chip or the catalog, and no games.
  const unavailable = unknownKey || (
    genreId != null && nameChecked && !stateName && !catalogName && loaded && games.length === 0
  )

  // Back goes back. A cold deep link has no history entry behind it, so only
  // then does it fall back to Discover.
  const handleBack = () => {
    const idx = window.history.state?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate('/discover', { replace: true })
  }

  const retry = () => loadPage(view)

  let body
  if (status === 'error' && !loaded) {
    body = (
      <div className="category-results-error">
        <p>Could not load games for this category.</p>
        <button type="button" className="category-results-retry" onClick={retry}>Try again</button>
      </div>
    )
  } else if (loaded && games.length === 0) {
    body = <p className="category-results-quiet">{emptyLine(view, categoryLabel)}</p>
  } else {
    const arrival = arrivalRef.current
    body = (
      <>
        <div className="category-results-grid" ref={gridRef}>
          {games.map((game, i) => (
            <div
              key={game.id}
              className={arrival.view === view && arrival.from >= 0 && i >= arrival.from ? 'category-results-arriving' : undefined}
            >
              <CoverGridTile game={game} />
            </div>
          ))}
        </div>
        {hasMore && status !== 'error' && (
          <div className="category-results-more" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            Loading more
          </div>
        )}
        {status === 'error' && (
          <div className="category-results-more">
            <button type="button" className="category-results-retry" onClick={retry}>
              Could not load more. Try again
            </button>
          </div>
        )}
      </>
    )
  }

  const pane = unavailable ? (
    <EmptyState icon={SearchX} body="This category isn't available" />
  ) : (
    // The placeholder wears the results grid's own columns and padding, so
    // the box is already its final shape when the covers fade in.
    <Arrive
      ready={loaded || status === 'error'}
      placeholder={(
        <div className="category-results-grid">
          {SKELETONS.map((i) => <CoverGridTileSkeleton key={i} />)}
        </div>
      )}
    >
      {body}
    </Arrive>
  )

  return (
    <div className="category-results-page" ref={pageRef}>
      <div className={unknownKey ? 'category-results-header category-results-header--bare' : 'category-results-header'}>
        <div className="category-results-header__row">
          <button
            className="category-results-back"
            onClick={handleBack}
            type="button"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
          {categoryLabel && <h1 className="category-results-title">{categoryLabel}</h1>}
        </div>
        {!unknownKey && (
          <PillTabs
            items={VIEWS}
            value={view}
            onChange={handleViewChange}
            ariaLabel="Views"
          />
        )}
      </div>

      {unknownKey ? pane : <ContentSwap swapKey={view}>{pane}</ContentSwap>}
    </div>
  )
}

function CategoryResults() {
  // One page per history entry: a new entry never inherits another's state.
  const location = useLocation()
  return <CategoryResultsPage key={location.key} />
}

export default CategoryResults
