import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuBell } from 'react-icons/lu'
import { Search, ChevronRight } from 'lucide-react'
import AppShell from '../components/AppShell'
import HomeFAB from '../components/HomeFAB'
import HomeStreakStrip from '../components/home/HomeStreakStrip'
import HomeFreshReviews from '../components/home/HomeFreshReviews'
import TrackerSearchModal from '../components/TrackerSearchModal'
import { getContinuePlayingGames, getGamesFromList } from '../services/libraryService'
import { getFollowingCount } from '../services/followService'
import { getProfile } from '../services/profileService'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { useSearchOverlay } from '../contexts/SearchOverlayContext'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { useTodayData } from '../hooks/useTodayData'
import './Home.css'

// ── Time-aware greeting ───────────────────────────────────────────────────────

function getGreetingPhrase() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12)  return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Up late'
}

// ── Continue breadcrumb ───────────────────────────────────────────────────────

/**
 * ContinueBreadcrumb — single-line "Continue · {game} ›" row.
 *
 * Replaces the old full Continue Playing hero. Deliberately minimal (text
 * + chevron, no cover) — shown only when the user has an active (Playing)
 * game; the parent hides this entirely otherwise.
 */
function ContinueBreadcrumb({ game }) {
  const navigate = useNavigate()

  if (!game) return null

  return (
    <button
      type="button"
      className="home-continue-breadcrumb"
      onClick={() =>
        navigate(`/game/${game.id}`, game.image ? { state: { coverImage: game.image } } : undefined)
      }
      aria-label={`Continue playing ${game.title}`}
    >
      <span className="home-continue-breadcrumb__text">
        Continue <span className="home-continue-breadcrumb__sep">·</span>{' '}
        <span className="home-continue-breadcrumb__game">{game.title}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  )
}

// ── New-user topper ───────────────────────────────────────────────────────────

/**
 * LogFirstGameTopper — slim CTA shown in place of the streak strip +
 * Continue breadcrumb for brand-new users (no follows, no logged games).
 */
function LogFirstGameTopper({ onLogGame }) {
  return (
    <button type="button" className="home-first-game-topper" onClick={onLogGame}>
      <span>Log your first game</span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HomeSkeleton() {
  return (
    <div className="home-skeleton">
      <div className="home-sk-heading">
        <div className="skeleton home-sk-heading-block" />
      </div>
      <div className="home-sk-single">
        <div className="skeleton home-sk-strip" />
      </div>
      <div className="home-sk-single">
        <div className="skeleton home-sk-single-card" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Home — feed-first community spine (v3).
 *
 * Section spine, top to bottom:
 *   a. Header — time-aware greeting + search icon (opens search-to-log
 *      overlay) + notification bell.
 *   b. Compact streak strip — flame + "N-day streak" + 7 day-pips +
 *      "Calendar ›". Hidden when the streak is 0 (never a 0/7 grid).
 *   c. Continue breadcrumb — "Continue · {game} ›", shown only when the
 *      user has an active Playing game. No hero, no cover.
 *   d. Fresh reviews — the feed, promoted to lead content. Defaults to
 *      community scope for users with no follows (see getHomeFeed).
 *
 * State-adaptive: brand-new users (no follows AND no logged games) skip
 * (b) and (c) entirely in favor of a single "Log your first game" topper,
 * and the feed's own community fallback + "Find people to follow" row
 * carries the social-proof job normally.
 *
 * TODO(home-backlog-removal): "Your Backlog" was removed from Home as part
 * of the v3 feed-first pass — it already lives on the Want to Play tracker
 * tile in Library. Flagging here in case Library's treatment needs a
 * follow-up pass once this ships.
 */
function Home() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const { open: openSearchOverlay } = useSearchOverlay()
  const [loading, setLoading] = useState(true)
  const [continuePlaying, setContinuePlaying] = useState([])
  const [loggedGamesCount, setLoggedGamesCount] = useState(0)
  const [followCount, setFollowCount] = useState(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState('currently')

  const openAdd = useCallback((status) => {
    setAddStatus(status)
    setAddOpen(true)
  }, [])

  const { unreadCount: notifUnread } = useNotifications()
  const { streak, weekCells } = useTodayData()

  const greeting = useMemo(getGreetingPhrase, [])
  const displayName =
    profile?.display_name?.trim() ||
    getProfile()?.displayName?.trim() ||
    'player'

  const loadHomeData = useCallback(() => {
    try {
      setLoading(true)
      setContinuePlaying(getContinuePlayingGames())
      setLoggedGamesCount(
        getGamesFromList('currently-playing').length +
        getGamesFromList('played').length +
        getGamesFromList('dropped').length
      )
    } catch (err) {
      console.error('Error loading home data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeData()

    const handleUpdate = () => loadHomeData()
    window.addEventListener('libraryUpdated', handleUpdate)
    window.addEventListener('reviewAdded', handleUpdate)
    window.addEventListener('storage', handleUpdate)
    window.addEventListener('activityUpdated', handleUpdate)
    window.addEventListener(APP_RESUMED_EVENT, handleUpdate)

    return () => {
      window.removeEventListener('libraryUpdated', handleUpdate)
      window.removeEventListener('reviewAdded', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
      window.removeEventListener('activityUpdated', handleUpdate)
      window.removeEventListener(APP_RESUMED_EVENT, handleUpdate)
    }
  }, [loadHomeData])

  // Follow count — determines the new-user state alongside loggedGamesCount.
  useEffect(() => {
    if (!user?.id) {
      setFollowCount(0)
      return undefined
    }
    let cancelled = false
    getFollowingCount(user.id)
      .then((count) => { if (!cancelled) setFollowCount(Number(count) || 0) })
      .catch(() => { if (!cancelled) setFollowCount(0) })
    return () => { cancelled = true }
  }, [user?.id])

  const pageReady = !loading && followCount !== null
  const isNewUser = pageReady && followCount === 0 && loggedGamesCount === 0
  const showStreakStrip = pageReady && !isNewUser && streak.current > 0
  const showContinueBreadcrumb = pageReady && !isNewUser && !!continuePlaying[0]

  if (!pageReady) {
    return (
      <AppShell>
        <div className="home">
          <HomeSkeleton />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="home">
        <div className="home-body">

          {/* ── a. Header — greeting + search icon + bell ────────────────
              Time-aware greeting ("Good morning / afternoon / evening /
              Up late, {name}"). Search opens the search-to-log overlay;
              bell persists for notification access.
          ──────────────────────────────────────────────────────────────── */}
          <header className="home-section home-section-padded home-greeting-block">
            <div className="home-greeting-row">
              <h1 className="home-greeting">{greeting}, {displayName}</h1>
              <div className="home-header-actions">
                <button
                  type="button"
                  className="home-search-btn"
                  onClick={openSearchOverlay}
                  aria-label="Search games to log"
                >
                  <Search size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="home-notif-btn"
                  onClick={() => navigate('/notifications')}
                  aria-label={
                    notifUnread > 0
                      ? `${notifUnread} unread notification${notifUnread !== 1 ? 's' : ''}`
                      : 'Notifications'
                  }
                >
                  <LuBell size={22} />
                  {notifUnread > 0 && (
                    <span className="home-notif-badge" aria-hidden="true">
                      {notifUnread > 99 ? '99+' : notifUnread}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </header>

          {/* ── New-user topper ───────────────────────────────────────────
              Brand-new users (no follows, no logged games) get a single
              slim CTA in place of the streak strip + Continue breadcrumb.
          ──────────────────────────────────────────────────────────────── */}
          {isNewUser && (
            <section className="home-section home-section-padded">
              <LogFirstGameTopper onLogGame={() => openAdd('currently')} />
            </section>
          )}

          {/* ── b. Compact streak strip ───────────────────────────────────
              Flame + "N-day streak" · 7 day-pips · "Calendar ›".
              Hidden whenever the streak is 0 — never a 0/7 empty grid.
          ──────────────────────────────────────────────────────────────── */}
          {showStreakStrip && (
            <section className="home-section home-section-padded">
              <HomeStreakStrip streak={streak.current} weekCells={weekCells} />
            </section>
          )}

          {/* ── c. Continue breadcrumb ────────────────────────────────────
              "Continue · {game} ›" — shown only when there's an active
              Playing game. Hidden otherwise (no fallback hero).
          ──────────────────────────────────────────────────────────────── */}
          {showContinueBreadcrumb && (
            <section className="home-section home-section-padded">
              <ContinueBreadcrumb game={continuePlaying[0]} />
            </section>
          )}

          {/* ── d. Fresh reviews — the feed, promoted to lead content ────
              getHomeFeed() + HomeReviewCard, infinite scroll. Defaults to
              community scope for followee-less viewers (new-user social
              proof), with a "Find people to follow" row alongside it.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section--feed">
            <HomeFreshReviews />
          </section>

        </div>
      </div>

      <HomeFAB />

      <TrackerSearchModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        status={addStatus}
      />
    </AppShell>
  )
}

export default Home
