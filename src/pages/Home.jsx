import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuBell } from 'react-icons/lu'
import { ChevronRight } from 'lucide-react'
import AppShell from '../components/AppShell'
import HomeSearchBar from '../components/HomeSearchBar'
import TodayCard from '../components/TodayCard'
import BacklogSection from '../components/BacklogSection'
import HomeFAB from '../components/HomeFAB'
import HomeFeed from '../components/HomeFeed'
import HomeTrendingShelf from '../components/HomeTrendingShelf'
import HeroCurrentlyPlaying from '../components/HeroCurrentlyPlaying'
import TrackerSearchModal from '../components/TrackerSearchModal'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getContinuePlayingGames, getGamesFromList } from '../services/libraryService'
import { getProfile } from '../services/profileService'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import useGameOfWeek from '../hooks/useGameOfWeek'
import './Home.css'
import '../components/HomeShelf.css'

// ── Time-aware greeting ───────────────────────────────────────────────────────

function getGreetingPhrase() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12)  return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Up late'
}

// ── Hero rotation variants ────────────────────────────────────────────────────

/**
 * BacklogNudgeHero — shown when the user has no active game but has a backlog.
 * Shows up to 3 backlog covers + a CTA to scroll down or pick via roulette.
 */
function BacklogNudgeHero({ games }) {
  const navigate = useNavigate()
  const preview = games.slice(0, 3)

  return (
    <div className="hero-nudge hero-nudge--backlog">
      <div className="hero-nudge__body">
        <span className="hero-nudge__eyebrow">Your Backlog</span>
        <h2 className="hero-nudge__title">
          {games.length === 1
            ? '1 game waiting for you'
            : `${games.length} games waiting for you`}
        </h2>
        <p className="hero-nudge__sub">Pick something up and make it your current game.</p>
        <button
          type="button"
          className="hero-nudge__cta"
          onClick={() => navigate('/list/want-to-play', { state: { selectedListId: 'want-to-play' } })}
          aria-label="Open your backlog"
        >
          Browse backlog <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      {preview.length > 0 && (
        <div className="hero-nudge__covers" aria-hidden="true">
          {preview.map((g) => (
            <div key={g.id} className="hero-nudge__cover-wrap">
              <img
                src={g.image || COVER_FALLBACK}
                alt=""
                className="hero-nudge__cover"
                loading="lazy"
                onError={(e) => { e.target.src = COVER_FALLBACK }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * CommunityHighlightHero — shown when the user has no active game and no backlog.
 * Uses useGameOfWeek to surface a community-picked or curated game.
 */
function CommunityHighlightHero() {
  const navigate = useNavigate()
  const { featured, loading } = useGameOfWeek()

  if (loading) {
    return (
      <div className="hero-nudge hero-nudge--community" aria-hidden="true">
        <div className="skeleton hero-nudge__skeleton" />
      </div>
    )
  }

  if (!featured) {
    return (
      <div className="hero-nudge hero-nudge--community">
        <div className="hero-nudge__body">
          <span className="hero-nudge__eyebrow">Get started</span>
          <h2 className="hero-nudge__title">What are you playing?</h2>
          <p className="hero-nudge__sub">Add a game to your library and track your progress here.</p>
        </div>
      </div>
    )
  }

  const coverSrc = featured.coverUrl || COVER_FALLBACK

  return (
    <button
      type="button"
      className="hero-nudge hero-nudge--community hero-nudge--clickable"
      onClick={() => navigate(`/game/${featured.igdbGameId}`, featured.coverUrl ? { state: { coverImage: featured.coverUrl } } : undefined)}
      aria-label={`Community highlight: ${featured.title}`}
    >
      <div className="hero-nudge__body">
        <span className="hero-nudge__eyebrow">Community highlight</span>
        <h2 className="hero-nudge__title">{featured.title}</h2>
        {featured.pickReason && (
          <p className="hero-nudge__sub">{featured.pickReason}</p>
        )}
        <span className="hero-nudge__cta-text">
          View game <ChevronRight size={14} aria-hidden="true" />
        </span>
      </div>
      {featured.coverUrl && (
        <div className="hero-nudge__cover-wrap hero-nudge__cover-wrap--single">
          <img
            src={coverSrc}
            alt=""
            className="hero-nudge__cover"
            loading="eager"
            onError={(e) => { e.target.src = COVER_FALLBACK }}
          />
        </div>
      )}
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
      <div className="skeleton home-sk-hero" />
      <div className="home-sk-single">
        <div className="skeleton home-sk-single-card" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Home — personalized dashboard.
 *
 * Section spine, top to bottom:
 *   a. Time-aware greeting + inline search + notification bell
 *   b. CONTINUE PLAYING hero (active game cover, last-played, progress, Resume CTA)
 *      → rotation: if no active game → backlog nudge; if neither → community highlight
 *   c. Streak + calendar (compact TodayCard with now-playing hidden)
 *   d. Trending this week — horizontal poster shelf
 *   e. Your Backlog — horizontal shelf
 *   f. THE FEED — full-width activity feed (people you follow + cold-start community fallback)
 */
function Home() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [continuePlaying, setContinuePlaying] = useState([])
  const [wantToPlayGames, setWantToPlayGames] = useState([])

  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState('currently')

  const openAdd = useCallback((status) => {
    setAddStatus(status)
    setAddOpen(true)
  }, [])

  const { unreadCount: notifUnread } = useNotifications()

  const greeting = useMemo(getGreetingPhrase, [])
  const displayName =
    profile?.display_name?.trim() ||
    getProfile()?.displayName?.trim() ||
    'player'

  const loadHomeData = useCallback(() => {
    try {
      setLoading(true)
      setContinuePlaying(getContinuePlayingGames())
      setWantToPlayGames(getGamesFromList('want-to-play'))
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

  if (loading) {
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

          {/* ── a. Greeting + inline search ──────────────────────────────
              Time-aware ("Good morning / afternoon / evening / Up late, {name}")
              Bell persists for notification access.
          ──────────────────────────────────────────────────────────────── */}
          <header className="home-section home-section-padded home-greeting-block">
            <div className="home-greeting-row">
              <h1 className="home-greeting">{greeting}, {displayName}</h1>
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
            <HomeSearchBar />
          </header>

          {/* ── b. Continue Playing hero ──────────────────────────────────
              Active game → full HeroCurrentlyPlaying with cover + progress.
              No active game + backlog → BacklogNudgeHero.
              Neither → CommunityHighlightHero (game of the week).
              Never empty.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section--bleed">
            {continuePlaying.length > 0 ? (
              <HeroCurrentlyPlaying
                games={continuePlaying}
                onAddGame={() => openAdd('currently')}
                boxed={false}
              />
            ) : wantToPlayGames.length > 0 ? (
              <div className="home-section-padded">
                <BacklogNudgeHero games={wantToPlayGames} />
              </div>
            ) : (
              <div className="home-section-padded">
                <CommunityHighlightHero />
              </div>
            )}
          </section>

          {/* ── c. Streak + calendar (compact) ───────────────────────────
              TodayCard with now-playing hidden — the hero above owns that slot.
              Streak ember ring + 7-day week row + streak nudge.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section-padded">
            <TodayCard hideNowPlaying />
          </section>

          {/* ── d. Trending this week ────────────────────────────────────
              Horizontal poster shelf, same data source as Discover's trending tab.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section">
            <HomeTrendingShelf />
          </section>

          {/* ── e. Your Backlog ──────────────────────────────────────────
              Horizontal shelf with mood shelves / roulette.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section-padded">
            <BacklogSection
              games={wantToPlayGames}
              onAddGame={() => openAdd('want')}
            />
          </section>

          {/* ── f. The Feed ───────────────────────────────────────────────
              Full-width vertical activity feed.
              Leads with live presence rows, then follow activity.
              Cold-start fallback: broader community activity rows.
              Never renders an empty island.
          ──────────────────────────────────────────────────────────────── */}
          <section className="home-section home-section--feed">
            <HomeFeed />
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
