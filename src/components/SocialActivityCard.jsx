import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getReviewsFromFollowing } from '../services/reviewService'
import { getFollowingCount } from '../services/followService'
import { getListsFromFollowing, getFollowingFavorites } from '../services/userService'
import { getSessionsFromFollowing } from '../services/sessionService'
import FindFriendsModal from './FindFriendsModal'
import './SocialActivityCard.css'

const TABS = ['activity', 'lists', 'favorites']
const TAB_LABELS = { activity: 'Activity', lists: 'Lists', favorites: 'Favorites' }
const TIMEOUT_MS = 10_000

/** Resolves to `fallback` after `ms` ms — never hangs forever. */
function safeWithTimeout(promise, fallback, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function triggerLightHaptic() {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // Non-native or haptics unavailable — silent.
  }
}

/* ── Duration + relative-day helpers ─────────────────────────────────────── */

/** Formats seconds into "45m", "2h", or "2h 30m". */
function formatDuration(seconds) {
  if (!seconds || seconds < 60) return '<1m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Returns "today", "yesterday", "3 days ago", or a short date like "Jun 3". */
function formatRelativeDay(dateStr) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  if (dateStr === todayStr) return 'today'
  if (dateStr === yesterdayStr) return 'yesterday'

  // Compare calendar dates as strings (both YYYY-MM-DD, same TZ context)
  const diffMs = new Date(todayStr + 'T00:00:00').getTime() - new Date(dateStr + 'T00:00:00').getTime()
  const diffDays = Math.round(diffMs / 86_400_000)
  if (diffDays > 0 && diffDays <= 6) return `${diffDays} days ago`

  // Older than a week — show short date
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/* ── Session tile ─────────────────────────────────────────────────────────── */

function SessionTile({ item, navigate }) {
  const duration = formatDuration(item.totalSeconds)
  const when = formatRelativeDay(item.playedOn)
  const gameTitle = item.gameTitle || 'Unknown game'
  return (
    <button
      type="button"
      className="sac-friend-tile"
      onClick={() =>
        navigate(`/game/${item.igdbGameId}`, {
          state: item.gameImage ? { coverImage: item.gameImage } : undefined,
        })
      }
      aria-label={`${item.username} played ${gameTitle} for ${duration} ${when}`}
    >
      <div className="sac-friend-tile__cover">
        {item.gameImage ? (
          <img src={item.gameImage} alt="" loading="lazy" />
        ) : (
          <span className="sac-friend-tile__cover-fallback">
            {gameTitle.charAt(0)}
          </span>
        )}
      </div>
      <div className="sac-friend-tile__meta">
        <p className="sac-friend-tile__title">{gameTitle}</p>
        <p className="sac-friend-tile__author">
          @{item.username}
        </p>
        <p className="sac-session-line">played {duration} {when}</p>
      </div>
    </button>
  )
}

/* ── Compact review tile ──────────────────────────────────────────────────── */

function ActivityTile({ row, navigate }) {
  const username = row.users?.username || row.users?.display_name || 'someone'
  const rating = Number(row.rating) || 0
  return (
    <button
      type="button"
      className="sac-friend-tile"
      onClick={() =>
        navigate(`/game/${row.igdb_game_id}`, {
          state: row.game_image ? { coverImage: row.game_image } : undefined,
        })
      }
      aria-label={`${row.game_title || 'Game'} reviewed by ${username}`}
    >
      <div className="sac-friend-tile__cover">
        {row.game_image ? (
          <img src={row.game_image} alt="" loading="lazy" />
        ) : (
          <span className="sac-friend-tile__cover-fallback">
            {(row.game_title || '?').charAt(0)}
          </span>
        )}
      </div>
      <div className="sac-friend-tile__meta">
        <p className="sac-friend-tile__title">{row.game_title || 'Unknown game'}</p>
        <p className="sac-friend-tile__author">@{username}</p>
        {rating > 0 && (
          <p className="sac-friend-tile__rating" aria-label={`${rating} stars`}>
            {'★'.repeat(Math.floor(rating))}
            {rating % 1 >= 0.5 ? '½' : ''}
          </p>
        )}
      </div>
    </button>
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

function ActivityContent({ status, items, navigate, onFindPeople }) {
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

  if (status === 'empty' || items.length === 0) {
    return (
      <SacEmpty
        message="The people you follow haven't been active yet."
        ctaLabel="Find more people to follow"
        onCta={onFindPeople}
      />
    )
  }

  return (
    <div className="sac-friends-list">
      {items.map((item) =>
        item._type === 'session' ? (
          <SessionTile
            key={`s-${item.userId}-${item.igdbGameId}-${item.playedOn}`}
            item={item}
            navigate={navigate}
          />
        ) : (
          <ActivityTile key={item.id} row={item} navigate={navigate} />
        )
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
 * Activity   Recent reviews from people you follow. Lazy-fetched on first view.
 * Lists      Public lists created by people you follow. Lazy-fetched on first view.
 * Favorites  Favorited games of people you follow. Lazy-fetched on first view.
 *
 * Swipe left/right or tap the tabs to switch modes. Each tab has an empty
 * state with a "Find people to follow" CTA that opens the FindFriendsModal.
 * No fabricated data is shown anywhere.
 */
function SocialActivityCard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('activity')
  const [findFriendsOpen, setFindFriendsOpen] = useState(false)

  // Track which tabs have already been fetched so we don't re-fetch on
  // every render or tab switch.
  const loadedRef = useRef(new Set())

  // ── Activity tab state ───────────────────────────────────────────────────
  const [activityStatus, setActivityStatus] = useState('idle')
  const [activityItems, setActivityItems] = useState([])

  // ── Lists tab state ──────────────────────────────────────────────────────
  const [listsStatus, setListsStatus] = useState('idle')
  const [listsItems, setListsItems] = useState([])

  // ── Favorites tab state ──────────────────────────────────────────────────
  const [favoritesStatus, setFavoritesStatus] = useState('idle')
  const [favoritesItems, setFavoritesItems] = useState([])

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadActivity = useCallback(async () => {
    if (!user || loadedRef.current.has('activity')) return
    loadedRef.current.add('activity')
    setActivityStatus('loading')
    try {
      const followCount = await safeWithTimeout(getFollowingCount(user.id), 0)
      if (followCount === 0) {
        setActivityStatus('no-follows')
        return
      }

      // Fetch reviews and play sessions in parallel
      const [{ items: reviews }, sessions] = await Promise.all([
        safeWithTimeout(
          getReviewsFromFollowing({ page: 1, limit: 6 }),
          { items: [], hasMore: false }
        ),
        safeWithTimeout(getSessionsFromFollowing({ limit: 60 }), []),
      ])

      // Tag reviews with type + sort date for interleaving
      const reviewItems = (reviews || []).map(r => ({
        ...r,
        _type: 'review',
        _sortDate: r.created_at?.slice(0, 10) || '',
      }))

      // Sessions from getSessionsFromFollowing already carry _type + _sortDate
      const merged = [...reviewItems, ...sessions]
        .sort((a, b) => b._sortDate.localeCompare(a._sortDate))
        .slice(0, 8)

      setActivityItems(merged)
      setActivityStatus(merged.length === 0 ? 'empty' : 'loaded')
    } catch (err) {
      console.error('[SocialActivityCard] loadActivity failed:', err)
      loadedRef.current.delete('activity')
      setActivityStatus('empty')
    }
  }, [user])

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

  // Load Activity tab on mount; other tabs load lazily on first activation.
  useEffect(() => {
    loadActivity()
  }, [loadActivity])

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
              items={activityItems}
              navigate={navigate}
              onFindPeople={openFindFriends}
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
