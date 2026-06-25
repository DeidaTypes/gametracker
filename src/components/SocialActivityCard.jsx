import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getFollowingCount } from '../services/followService'
import { getListsFromFollowing, getFollowingFavorites } from '../services/userService'
import {
  formatActivityEventMessage,
  getActivityEventHref,
} from '../services/activityEventsService'
import { useCircleActivity } from '../hooks/useCircleActivity'
import Reactions from './Reactions'
import FindFriendsModal from './FindFriendsModal'
import './SocialActivityCard.css'

const TABS = ['activity', 'lists', 'favorites']
const TAB_LABELS = { activity: 'Activity', lists: 'Lists', favorites: 'Favorites' }
const TIMEOUT_MS = 10_000

// Activity feed pagination — first page small so the card stays
// scannable; "Show more" loads additional pages of the same size via
// the cursor-based useCircleActivity hook.
const ACTIVITY_PAGE_SIZE = 12

/** Resolves to `fallback` after `ms` ms — never hangs forever. */
function safeWithTimeout(promise, fallback, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * Compact "just now / 5m / 2h / 1d / Jun 12" formatter for the activity
 * feed row's right-aligned timestamp. Kept local (vs reusing
 * ActivityFeed.relativeTime) so this card can ship without taking a
 * dependency on the Profile timeline component.
 */
function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1d'
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function triggerLightHaptic() {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // Non-native or haptics unavailable — silent.
  }
}

/* ── Activity event row ───────────────────────────────────────────────────── */

/**
 * EventRow — one worded activity_events row in the Followers' picks
 * Activity tab.
 *
 *   [cover] <actor> <verb> <game> <qualifier>          <relative time>
 *           <reactions row (inline F3 pills + add button)>
 *
 * Tapping the row navigates to the per-type deep-link from
 * getActivityEventHref. Tapping inside the reactions row never bubbles
 * up to the row-level navigation — handled by stopPropagation on the
 * reactions container.
 */
function EventRow({ event, navigate }) {
  const href = getActivityEventHref(event)
  const sentence = formatActivityEventMessage(event)
  const meta = event.metadata || {}
  const cover = meta.game_image || null
  const title = meta.game_title || ''
  const when = relativeTime(event.created_at)

  const onActivate = () => {
    if (!href) return
    navigate(href, cover ? { state: { coverImage: cover } } : undefined)
  }

  const onKeyDown = (e) => {
    if (!href) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }

  return (
    <div
      className={`sac-event-row${href ? '' : ' sac-event-row--static'}`}
      onClick={href ? onActivate : undefined}
      onKeyDown={href ? onKeyDown : undefined}
      role={href ? 'button' : undefined}
      tabIndex={href ? 0 : undefined}
      aria-label={sentence}
    >
      <div className="sac-event-row__cover">
        {cover ? (
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <span className="sac-event-row__cover-fallback">
            {(title || event.type || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="sac-event-row__body">
        <p className="sac-event-row__sentence">{sentence}</p>
        {/* Reactions sit inside the row but swallow clicks so the
            picker / pill toggles don't trigger deep-link navigation. */}
        <div
          className="sac-event-row__reactions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Reactions targetType="activity" targetId={event.id} />
        </div>
      </div>
      <span className="sac-event-row__time" aria-hidden="true">{when}</span>
    </div>
  )
}

/* ── Compact list tile ────────────────────────────────────────────────────── */

function ListTile({ list, navigate }) {
  const covers = (list.previewGames || []).slice(0, 4)
  const authorLabel = list.author?.displayName || list.author?.username || ''
  return (
    <button
      type="button"
      className="sac-list-tile"
      onClick={() => navigate(`/list/${list.id}`)}
      aria-label={list.name}
    >
      <div className="sac-list-tile__mosaic">
        {Array.from({ length: 4 }, (_, i) => {
          const g = covers[i]
          return (
            <div
              key={i}
              className={`sac-list-tile__cell${g ? '' : ' sac-list-tile__cell--empty'}`}
            >
              {g?.image && <img src={g.image} alt="" loading="lazy" />}
            </div>
          )
        })}
      </div>
      <div className="sac-list-tile__info">
        <p className="sac-list-tile__name">{list.name}</p>
        <p className="sac-list-tile__count">
          {list.gameCount} game{list.gameCount !== 1 ? 's' : ''}
          {authorLabel ? ` · ${authorLabel}` : ''}
        </p>
      </div>
    </button>
  )
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */

function SacSkeleton({ rows = 3 }) {
  return (
    <div className="sac-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sac-skeleton-row">
          <div className="skeleton sac-skeleton-cover" />
          <div className="sac-skeleton-lines">
            <div className="skeleton sac-skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton sac-skeleton-line" style={{ width: '38%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Empty state ──────────────────────────────────────────────────────────── */

function SacEmpty({ message, ctaLabel, onCta }) {
  return (
    <div className="sac-empty">
      <p className="sac-empty__text">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" className="sac-empty__cta" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  )
}

/* ── Tab content ──────────────────────────────────────────────────────────── */

function ActivityContent({
  status,
  events,
  navigate,
  onFindPeople,
  hasMore,
  loadingMore,
  onLoadMore,
}) {
  if (status === 'idle' || status === 'loading') return <SacSkeleton rows={3} />

  if (status === 'no-follows') {
    return (
      <SacEmpty
        message="Follow people to see their recent activity here."
        ctaLabel="Find people to follow"
        onCta={onFindPeople}
      />
    )
  }

  if (status === 'empty' || events.length === 0) {
    return (
      <SacEmpty
        message="The people you follow haven't been active yet."
        ctaLabel="Find more people to follow"
        onCta={onFindPeople}
      />
    )
  }

  return (
    <div className="sac-event-list">
      {events.map((event) => (
        <EventRow key={event.id} event={event} navigate={navigate} />
      ))}
      {hasMore && (
        <button
          type="button"
          className="sac-event-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading\u2026' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function ListsContent({ status, items, navigate, onFindPeople }) {
  if (status === 'idle' || status === 'loading') return <SacSkeleton rows={3} />

  if (status === 'no-follows') {
    return (
      <SacEmpty
        message="Follow people to see their lists here."
        ctaLabel="Find people to follow"
        onCta={onFindPeople}
      />
    )
  }

  if (status === 'empty' || items.length === 0) {
    return (
      <SacEmpty
        message="The people you follow haven't made any public lists yet."
        ctaLabel="Find more people to follow"
        onCta={onFindPeople}
      />
    )
  }

  return (
    <div className="sac-lists-grid">
      {items.map((list) => (
        <ListTile key={list.id} list={list} navigate={navigate} />
      ))}
    </div>
  )
}

function FavoritesContent({ status, items, navigate, onFindPeople }) {
  if (status === 'idle' || status === 'loading') return <SacSkeleton rows={2} />

  if (status === 'no-follows') {
    return (
      <SacEmpty
        message="Follow people to see their favorite games here."
        ctaLabel="Find people to follow"
        onCta={onFindPeople}
      />
    )
  }

  if (status === 'empty' || items.length === 0) {
    return (
      <SacEmpty
        message="The people you follow haven't set favorite games yet."
        ctaLabel="Find more people to follow"
        onCta={onFindPeople}
      />
    )
  }

  return (
    <div className="sac-favorites-grid">
      {items.slice(0, 8).map((entry, idx) => {
        const { game, owner } = entry
        const label = `${game.title} · favorited by ${owner.displayName || owner.username}`
        return (
          <button
            key={`${owner.id}-${game.id}-${idx}`}
            type="button"
            className="sac-fav-card"
            onClick={() =>
              navigate(
                `/game/${game.id}`,
                game.image ? { state: { coverImage: game.image } } : undefined
              )
            }
            aria-label={label}
          >
            {game.image ? (
              <img src={game.image} alt="" loading="lazy" className="sac-fav-card__img" />
            ) : (
              <span className="sac-fav-card__fallback">{game.title?.charAt(0) || '?'}</span>
            )}
            <span className="sac-fav-card__title">{game.title}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────────────────── */

/**
 * SocialActivityCard — a swipeable three-tab card for the Home screen.
 *
 * All three tabs source data from people the current user FOLLOWS:
 *
 * Activity   Worded `activity_events` rows authored by followees (played /
 *            started / completed / dropped / reviewed / favorited / listed
 *            / goal_hit). Cursor-paginated newest-first via
 *            useCircleActivity; each row is deep-linked + carries inline
 *            emoji reactions (F3).
 * Lists      Public lists created by people you follow. Lazy-fetched on first view.
 * Favorites  Favorited games of people you follow. Lazy-fetched on first view.
 *
 * Swipe left/right or tap the tabs to switch modes. Each tab has an empty
 * state with a "Find people to follow" CTA that opens the FindFriendsModal.
 * No fabricated data is shown anywhere — every row corresponds to a real
 * `activity_events` row authored by a followee.
 */
function SocialActivityCard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('activity')
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)

  // Track which tabs have already been fetched so we don't re-fetch on
  // every render or tab switch.
  const loadedRef = useRef(new Set())

  // ── Activity tab — sourced from the F1 activity_events feed ──────────────
  //
  // We delegate to useCircleActivity which already handles cursor-based
  // pagination, realtime inserts, app-resumed refresh, and FK-disambiguated
  // joins. The hook fetches eagerly on mount, which is what we want here
  // since Activity is the default-visible tab.
  const {
    events: activityEvents,
    loading: activityLoading,
    loadingMore: activityLoadingMore,
    hasMore: activityHasMore,
    loadMore: loadMoreActivity,
  } = useCircleActivity({ pageSize: ACTIVITY_PAGE_SIZE })

  // 'no-follows' is a distinct UI state from 'empty' — followers count
  // is cheap and we want the CTA copy to differ. Fetched once per
  // session, cached in a ref so tab switches don't re-query.
  const [followCount, setFollowCount] = useState(null)
  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    safeWithTimeout(getFollowingCount(user.id), 0).then((count) => {
      if (!cancelled) setFollowCount(Number(count) || 0)
    })
    return () => { cancelled = true }
  }, [user])

  // Derive the renderer status from raw hook state. The hook never
  // exposes a 'no-follows' bit (it's a feed-level concern), so we
  // combine it with followCount here.
  const activityStatus = useMemo(() => {
    if (!user) return 'idle'
    if (activityLoading && activityEvents.length === 0) return 'loading'
    if (followCount === 0) return 'no-follows'
    if (activityEvents.length === 0) return 'empty'
    return 'loaded'
  }, [user, activityLoading, activityEvents.length, followCount])

  // ── Lists tab state ──────────────────────────────────────────────────────
  const [listsStatus, setListsStatus] = useState('idle')
  const [listsItems, setListsItems] = useState([])

  // ── Favorites tab state ──────────────────────────────────────────────────
  const [favoritesStatus, setFavoritesStatus] = useState('idle')
  const [favoritesItems, setFavoritesItems] = useState([])

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadLists = useCallback(async () => {
    if (!user || loadedRef.current.has('lists')) return
    loadedRef.current.add('lists')
    setListsStatus('loading')
    try {
      const followCount = await safeWithTimeout(getFollowingCount(user.id), 0)
      if (followCount === 0) {
        setListsStatus('no-follows')
        return
      }
      const lists = await safeWithTimeout(getListsFromFollowing(user.id, 6), [])
      setListsItems(lists)
      setListsStatus(lists.length === 0 ? 'empty' : 'loaded')
    } catch (err) {
      console.error('[SocialActivityCard] loadLists failed:', err)
      loadedRef.current.delete('lists')
      setListsStatus('empty')
    }
  }, [user])

  const loadFavorites = useCallback(async () => {
    if (!user || loadedRef.current.has('favorites')) return
    loadedRef.current.add('favorites')
    setFavoritesStatus('loading')
    try {
      const followCount = await safeWithTimeout(getFollowingCount(user.id), 0)
      if (followCount === 0) {
        setFavoritesStatus('no-follows')
        return
      }
      const items = await safeWithTimeout(getFollowingFavorites(user.id, 8), [])
      setFavoritesItems(items)
      setFavoritesStatus(items.length === 0 ? 'empty' : 'loaded')
    } catch (err) {
      console.error('[SocialActivityCard] loadFavorites failed:', err)
      loadedRef.current.delete('favorites')
      setFavoritesStatus('empty')
    }
  }, [user])

  // Activity tab is driven by useCircleActivity (mounts once); other
  // tabs load lazily on first activation.
  useEffect(() => {
    if (activeTab === 'lists') loadLists()
    if (activeTab === 'favorites') loadFavorites()
  }, [activeTab, loadLists, loadFavorites])

  // ── Tab switch with haptic ────────────────────────────────────────────────
  const handleTabChange = useCallback((tab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    triggerLightHaptic()
  }, [activeTab])

  // ── Swipe gesture ─────────────────────────────────────────────────────────
  const touchStartX = useRef(null)

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) < 60) return
    const idx = TABS.indexOf(activeTab)
    if (delta < 0 && idx < TABS.length - 1) {
      handleTabChange(TABS[idx + 1])
    } else if (delta > 0 && idx > 0) {
      handleTabChange(TABS[idx - 1])
    }
  }

  const openFindFriends = useCallback(() => setFindFriendsOpen(true), [])

  return (
    <>
      <div
        className="sac-card"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* ── Card header ── */}
        <div className="sac-header">
          <h2 className="sac-header__title">Followers&apos; picks</h2>
        </div>

        {/* ── Tab strip ── */}
        <div className="sac-tab-row" role="tablist" aria-label="Following activity tabs">
          {TABS.map((tab) => {
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`sac-tab${isActive ? ' sac-tab--active' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {TAB_LABELS[tab]}
                {isActive && <span className="sac-tab-indicator" aria-hidden="true" />}
              </button>
            )
          })}
        </div>

        {/* ── Content ── */}
        <div className="sac-content">
          {activeTab === 'activity' && (
            <ActivityContent
              status={activityStatus}
              events={activityEvents}
              navigate={navigate}
              onFindPeople={openFindFriends}
              hasMore={activityHasMore}
              loadingMore={activityLoadingMore}
              onLoadMore={loadMoreActivity}
            />
          )}
          {activeTab === 'lists' && (
            <ListsContent
              status={listsStatus}
              items={listsItems}
              navigate={navigate}
              onFindPeople={openFindFriends}
            />
          )}
          {activeTab === 'favorites' && (
            <FavoritesContent
              status={favoritesStatus}
              items={favoritesItems}
              navigate={navigate}
              onFindPeople={openFindFriends}
            />
          )}
        </div>
      </div>

      <FindFriendsModal
        isOpen={findFriendsOpen}
        onClose={() => setFindFriendsOpen(false)}
        currentUserId={user?.id ?? null}
      />
    </>
  )
}

export default SocialActivityCard
