import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuBell } from 'react-icons/lu'
import { Search, ChevronRight } from 'lucide-react'
import AppShell from '../components/AppShell'
import HomeFAB from '../components/HomeFAB'
import PullToRefresh from '../components/PullToRefresh'
import HomeWeekRow from '../components/home/HomeWeekRow'
import HomeNowPlayingHero from '../components/home/HomeNowPlayingHero'
import LogSheet from '../components/home/LogSheet'
import RatingSheet from '../components/RatingSheet'
import HomePulseFeed from '../components/home/HomePulseFeed'
import TrackerSearchModal from '../components/TrackerSearchModal'
import { getContinuePlayingGames, getGamesFromList } from '../services/libraryService'
import { completeGameWithRating } from '../services/completionService'
import { getFollowingCount } from '../services/followService'
import { logSession } from '../services/sessionService'
import { showToast } from '../components/Toast'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Home.css'

// ── New-user topper ───────────────────────────────────────────────────────────

/**
 * LogFirstGameTopper — slim CTA shown in place of the weekly rhythm row +
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
      <div className="home-sk-single home-sk-week-row">
        <div className="skeleton home-sk-week-cell" />
        <div className="skeleton home-sk-week-cell" />
      </div>
      <div className="home-sk-single">
        <div className="skeleton home-sk-single-card" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Home — feed-first community spine (v3), now-playing pass.
 *
 * Section spine, top to bottom:
 *   a. Header — compact single row: wordmark left, search icon (opens
 *      search-to-log overlay) + notification bell right. No greeting.
 *   b. Now Playing hero — the active Playing game: cover, title,
 *      "Just started" or relative last-played time, and Log a session /
 *      Finish. Falls back to a backlog nudge when there's no active
 *      game, and hides entirely when the backlog is empty too.
 *   c. Weekly rhythm row — "This week" card (real sessions-this-week +
 *      total hours from play_sessions, tap to open the week-detail sheet;
 *      "Calendar ›" keeps the entry point into the full /activity screen)
 *      beside a "{year} goal" card that hides entirely when no goal is
 *      set. Replaces the old daily streak strip — a daily streak punishes
 *      deep multi-week playthroughs, weekly rhythm rewards them. Always
 *      visible for users with account history; a zero-session week reads
 *      as a neutral "No sessions yet this week", never fabricated data.
 *   d. The pulse — the feed, promoted to lead content. Defaults to
 *      community scope for users with no follows (see getHomeFeed).
 *
 * State-adaptive: brand-new users (no follows AND no logged games) skip
 * (b) and (c) entirely in favor of a single "Log your first game" topper;
 * everyone else always sees (c), even in a zero-session week,
 * and the feed's own community fallback + "Find people to follow" row
 * carries the social-proof job normally.
 *
 * "The pulse" is intentionally NOT reviews-only: getHomeFeed unions the
 * `reviews` table (written reviews + bare star ratings) with `activity_events`
 * rows (finished, started, added-to-list, logged-a-session) into one
 * recency-ordered stream, so the feed reads as "what your circle is up
 * to", not just "who wrote something".
 */
function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [continuePlaying, setContinuePlaying] = useState([])
  const [backlogGame, setBacklogGame] = useState(null)
  const [loggedGamesCount, setLoggedGamesCount] = useState(0)
  const [followCount, setFollowCount] = useState(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState('currently')

  const openAdd = useCallback((status) => {
    setAddStatus(status)
    setAddOpen(true)
  }, [])

  // ── LogSheet — the one log-a-session modal, launched from the hero ────
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logSheetGame, setLogSheetGame] = useState(null)

  const openLogSheet = useCallback((game) => {
    setLogSheetGame(game)
    setLogSheetOpen(true)
  }, [])

  // Fire-and-forget write with toast-with-retry. Declared as a stable
  // function (not useCallback) so the retry closure can call it by name.
  function submitLoggedSession({ game, hours, notes, mood }) {
    logSession({
      gameId: game.id,
      hours,
      notes,
      mood,
      gameTitle: game.title,
      gameImage: game.image,
    }).then((result) => {
      if (result) {
        hapticImpact('Medium')
        showToast(`Logged ${hours}h of ${game.title}`, 'success')
      } else {
        showToast('Could not log session — try again', 'error', 5000, {
          label: 'Retry',
          onClick: () => submitLoggedSession({ game, hours, notes, mood }),
        })
      }
    })
  }

  // ── RatingSheet — the Finish button now opens this FIRST; the actual
  // completion write (setGameStatus + optional rating) happens when the
  // sheet resolves (Done, Skip, or any dismissal — see RatingSheet.jsx's
  // header comment for why dismiss === Skip). ─────────────────────────
  const [ratingSheetOpen, setRatingSheetOpen] = useState(false)
  const [ratingSheetGame, setRatingSheetGame] = useState(null)

  const openRatingSheet = useCallback((game) => {
    setRatingSheetGame(game)
    setRatingSheetOpen(true)
  }, [])

  const finishGame = useCallback(async (game, rating, hoursPlayed) => {
    if (!game) return
    const { ok, ratingError } = await completeGameWithRating({
      gameId: game.id,
      game,
      rating,
      hoursPlayed,
    })
    if (!ok) {
      showToast('Could not update — try again', 'error')
      return
    }
    hapticSuccess()
    showToast(`Marked "${game.title}" as Played`, 'success')
    if (ratingError) {
      showToast('Could not save your rating — try again', 'error', 5000, {
        label: 'Retry',
        onClick: () => finishGame(game, rating, hoursPlayed),
      })
    }
  }, [])

  const handleRatingSheetResolve = useCallback(({ rating, hoursPlayed }) => {
    finishGame(ratingSheetGame, rating, hoursPlayed)
  }, [ratingSheetGame, finishGame])

  const handleWriteReviewFromRatingSheet = useCallback((game) => {
    if (!game) return
    navigate(`/review/new?gameId=${game.id}`, { state: { game } })
  }, [navigate])

  const { unreadCount: notifUnread } = useNotifications()

  // The pulse feed owns its own useHomeFeed() call (and the swrCache-
  // bypassing `refresh` it exposes) — this ref is only so pull-to-
  // refresh here can trigger that refetch without lifting the hook up.
  const pulseFeedRef = useRef(null)

  // `background: true` updates the same state in place without dropping the
  // page back to its skeleton. Every caller other than the initial mount is
  // a refresh over content the user is already looking at — pull-to-refresh,
  // a library write, app resume — and none of them should blank the screen.
  // The reads here are synchronous localStorage anyway, so there is nothing
  // for a loading state to cover.
  const loadHomeData = useCallback(({ background = false } = {}) => {
    try {
      if (!background) setLoading(true)
      setContinuePlaying(getContinuePlayingGames())
      setLoggedGamesCount(
        getGamesFromList('currently-playing').length +
        getGamesFromList('played').length +
        getGamesFromList('dropped').length
      )
      const backlog = getGamesFromList('want-to-play')
      setBacklogGame(
        backlog.length
          ? [...backlog].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))[0]
          : null
      )
    } catch (err) {
      console.error('Error loading home data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeData()

    const handleUpdate = () => loadHomeData({ background: true })
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

  // Pull-to-refresh: reload the local tracker/backlog snapshot (already
  // a live localStorage read, nothing to bypass), the follow count, and
  // force the pulse feed's own swrCache-bypassing refetch, in parallel.
  const handlePullToRefresh = useCallback(async () => {
    loadHomeData({ background: true })
    const tasks = [pulseFeedRef.current?.refresh?.()]
    if (user?.id) {
      tasks.push(
        getFollowingCount(user.id)
          .then((count) => setFollowCount(Number(count) || 0))
          .catch(() => {})
      )
    }
    await Promise.all(tasks)
  }, [loadHomeData, user?.id])

  const pageReady = !loading && followCount !== null
  const isNewUser = pageReady && followCount === 0 && loggedGamesCount === 0
  // Always show for anyone with account history — even a zero-session week
  // gets a neutral "No sessions yet this week" state (see HomeWeekCard).
  // Hidden only for the true new-user empty state (same gate as the
  // first-game topper).
  const showWeekRow = pageReady && !isNewUser
  // Gated on real content so the section wrapper never renders empty.
  // Also gated behind !isNewUser so a brand-new user sees only the
  // "Log your first game" topper, not a redundant backlog nudge.
  const showNowPlayingHero = pageReady && !isNewUser && (!!continuePlaying[0] || !!backlogGame)

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
      <PullToRefresh onRefresh={handlePullToRefresh}>
      <div className="home">
        <div className="home-body">

          {/* ── a. Header — compact single row ────────────────────────────
              Wordmark left, search icon (routes to the Search screen)
              + notification bell right. No greeting.
          ──────────────────────────────────────────────────────────────── */}
          <header className="home-section home-section-padded home-header-block">
            <div className="home-header-row">
              <span className="home-wordmark">Checkpoint</span>
              <div className="home-header-actions">
                <button
                  type="button"
                  className="home-search-btn"
                  onClick={() => navigate('/search')}
                  aria-label="Search"
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
              slim CTA in place of the weekly rhythm row + Continue breadcrumb.
          ──────────────────────────────────────────────────────────────── */}
          {isNewUser && (
            <section className="home-section home-section-padded">
              <LogFirstGameTopper onLogGame={() => openAdd('currently')} />
            </section>
          )}

          {/* ── b. Now Playing hero ───────────────────────────────────────
              Active Playing game: cover, title, Just started / last-played,
              Log a session / Finish. Falls back to a backlog nudge, then
              hides — never an empty shell.
          ──────────────────────────────────────────────────────────────── */}
          {showNowPlayingHero && (
            <section className="home-section home-section-padded">
              <HomeNowPlayingHero
                activeGame={continuePlaying[0] || null}
                backlogGame={backlogGame}
                onLogSession={openLogSheet}
                onFinish={openRatingSheet}
              />
            </section>
          )}

          {/* ── c. Weekly rhythm row ───────────────────────────────────────
              "This week" (real sessions + hours, tap for detail) beside a
              "{year} goal" card that hides when no goal is set. Always
              shown for users with account history — a zero-session week
              reads as a neutral state, not a guilt-trippy empty grid.
          ──────────────────────────────────────────────────────────────── */}
          {showWeekRow && (
            <section className="home-section home-section-padded">
              <HomeWeekRow />
            </section>
          )}

          {/* ── d. The pulse — the feed, promoted to lead content ────────
              getHomeFeed() + HomeReviewCard, infinite scroll. Defaults to
              community scope for followee-less viewers (new-user social
              proof), with a "Find people to follow" row alongside it.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section--feed">
            <HomePulseFeed ref={pulseFeedRef} />
          </section>

        </div>
      </div>
      </PullToRefresh>

      <HomeFAB />

      <TrackerSearchModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        status={addStatus}
      />

      <LogSheet
        isOpen={logSheetOpen}
        onClose={() => setLogSheetOpen(false)}
        game={logSheetGame}
        onLogIt={submitLoggedSession}
      />

      <RatingSheet
        isOpen={ratingSheetOpen}
        game={ratingSheetGame}
        onResolve={handleRatingSheetResolve}
        onClose={() => setRatingSheetOpen(false)}
        onWriteReview={handleWriteReviewFromRatingSheet}
      />
    </AppShell>
  )
}

export default Home
