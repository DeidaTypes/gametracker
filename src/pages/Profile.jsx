import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  LuChevronLeft,
  LuChevronRight,
  LuPlay,
  LuCheck,
  LuStar,
  LuPlus,
  LuShare2,
  LuPin,
  LuArrowUpDown,
  LuSettings,
  LuMail,
} from 'react-icons/lu'
import { HiDotsVertical } from 'react-icons/hi'
import { SlidersHorizontal, PenLine, List } from 'lucide-react'
import {
  FaInstagram,
  FaXTwitter,
  FaYoutube,
  FaTiktok,
} from 'react-icons/fa6'
import { useAuth } from '../contexts/AuthContext'
import { useSession } from '../contexts/SessionContext'
import { usePresence } from '../hooks/usePresence'
import { getTotalHoursForUser } from '../services/hoursService'
import { getSettings } from '../services/userSettingsService'
import { getReviewsForUser } from '../services/reviewService'
import {
  getListsForUser,
  getPinnedListsForUser,
  pinList as pinListSvc,
  unpinList as unpinListSvc,
  LIST_PIN_CHANGED_EVENT,
} from '../services/listService'
import { getProfile, initializeProfile, generateDefaultAvatar, updateProfile } from '../services/profileService'
import { getGoalProgress, setGoal } from '../services/goalService'
import { getStreakData, MILESTONES, isMilestoneSeen } from '../services/streakMilestoneService'
import { getUserByUsername, getUserById } from '../services/userService'
import { getActivitiesForUser } from '../services/activityService'
import {
  followUser,
  unfollowUser,
  isFollowing as fetchIsFollowing,
  getFollowerCount,
  getFollowingCount,
  FOLLOW_CHANGED_EVENT,
} from '../services/followService'
import { prefetchLikeStatesForReviews } from '../hooks/useLikeState'
import { getCommentCountsForReviews } from '../services/commentService'
import {
  getPinsForUser,
  pinReview as pinReviewSvc,
  unpinReview as unpinReviewSvc,
  reorderPins as reorderPinsSvc,
  MAX_PINS,
  PIN_CHANGED_EVENT,
} from '../services/pinService'
import { shareContent } from '../utils/share'
import { shareCard } from '../services/share'
import { computeDNAPortrait, compileWrappedSummary } from '../services/dnaService'
import { fetchUserBannerUrl } from '../services/storageService'
import { blockUser } from '../services/blockService'
import ActionSheet from '../components/ActionSheet'
import ReportSheet from '../components/ReportSheet'
import EditProfileModal from '../components/EditProfileModal'
import CreateListModal from '../components/CreateListModal'
import FavoritesPickerSheet from '../components/FavoritesPickerSheet'
import GamePickerSheet from '../components/GamePickerSheet'
import BadgesRow from '../components/BadgesRow'
import GoalRing from '../components/GoalRing'
import SetGoalSheet from '../components/SetGoalSheet'
import ReviewCard from '../components/ReviewCard'
import EmptyState from '../components/EmptyState'
import ReorderPinsModal from '../components/ReorderPinsModal'
import SortSheet from '../components/SortSheet'
import BioEditModal from '../components/BioEditModal'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { createList, addGameToList } from '../services/listService'
import { showToast } from '../components/Toast'
import ProfileReviewsShelf from '../components/ProfileReviewsShelf'
import PinnedListsSection from '../components/PinnedListsSection'
import ProfileRatingsChart from '../components/ProfileRatingsChart'
import ActivityTimeline from '../components/ActivityTimeline'
import { getJournalEntriesForUser } from '../services/journalService'
import './Profile.css'

/* ============================================================
   fetchWithTimeout — resolves to `fallback` after `ms` ms rather than
   hanging forever. Never rejects, so a single timed-out call can't abort
   the whole Promise.all on Profile load. Use for every Supabase read on
   this page so a stalled mobile connection always clears the loading state.
   ============================================================ */

const PROFILE_TIMEOUT_MS = 10_000

function safeWithTimeout(promise, fallback, ms = PROFILE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/* ============================================================
   Sort persistence — same shape as before so existing localStorage
   blobs keep working. `getSort(tab)` is the helper the spec asks for.
   ============================================================ */

const SORT_LS_KEY = 'gt:profile-sort:v1'
const SORT_DEFAULT = { reviews: 'lastUpdated', lists: 'lastUpdated' }

function readSortFromStorage() {
  try {
    const raw = localStorage.getItem(SORT_LS_KEY)
    return raw ? { ...SORT_DEFAULT, ...JSON.parse(raw) } : { ...SORT_DEFAULT }
  } catch {
    return { ...SORT_DEFAULT }
  }
}

function getSort(tab) {
  return readSortFromStorage()[tab] || SORT_DEFAULT[tab]
}

/**
 * Format a raw hours number for the header stat.
 * Keeps the label compact so it fits the 4-stat row on small screens.
 */
function formatHours(h) {
  if (h == null || h < 0) return '—'
  if (h === 0) return '0h'
  if (h >= 1000) return `${Math.round(h / 100) / 10}kh`
  return `${Math.round(h)}h`
}

function sortReviews(reviews, key, likeCounts) {
  const arr = [...reviews]
  switch (key) {
    case 'latestFirst':
      return arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    case 'oldestFirst':
      return arr.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    case 'mostLiked':
      // Sprint 6 P0 — sort by the real Supabase like count fetched
      // once per render via prefetchLikeStatesForReviews. The Map is
      // seeded before this sort runs so `?? 0` here only matters for
      // reviews that arrived after the fetch (rare).
      return arr.sort(
        (a, b) =>
          (likeCounts?.get(b.id) || 0) - (likeCounts?.get(a.id) || 0)
      )
    case 'alphabetical':
      return arr.sort((a, b) => (a.game_title || '').localeCompare(b.game_title || ''))
    case 'lastUpdated':
    default:
      return arr.sort((a, b) => {
        const da = new Date(a.updated_at || a.created_at || 0)
        const db = new Date(b.updated_at || b.created_at || 0)
        return db - da
      })
  }
}

function sortLists(lists, key) {
  const arr = [...lists]
  switch (key) {
    case 'latestFirst':
      return arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    case 'oldestFirst':
      return arr.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    case 'mostLiked':
      return arr.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
    case 'alphabetical':
      return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    case 'lastUpdated':
    default:
      return arr.sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt || 0)
        const db = new Date(b.updatedAt || b.createdAt || 0)
        return db - da
      })
  }
}

/* ============================================================
   Review row → ReviewCard prop adapter (shared with the rest of
   Sprint 5: TimelineFeed, GameReviewsAll, GameDetail).
   ============================================================ */

function rowToReviewCard(row, likeCounts, commentCounts) {
  return {
    id: row.id,
    userId: row.user_id,
    game: {
      id: String(row.igdb_game_id || ''),
      name: row.game_title || 'Unknown Game',
      coverUrl: row.game_image || '',
      developer: '',
    },
    author: {
      // Keep the raw username so ReviewCard can navigate correctly.
      // ReviewCard falls back to /user/id/:userId when username is null.
      username: row.users?.username || null,
      displayName: row.users?.display_name || 'Anonymous',
      userId: row.user_id,
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
    hoursPlayed: Number(row.hours_played) || 0,
    liked: !!row.liked,
    hasSpoilers: !!row.has_spoilers,
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
    likeCount: likeCounts?.get(row.id) || 0,
    commentCount: commentCounts?.get(row.id) || 0,
    createdAt: row.created_at,
  }
}

/* ============================================================
   Capacitor Browser fallback
   Tries the Capacitor Browser plugin first (native in-app browser on
   iOS), falls back to window.open for the web. Mirrors the shape of
   src/utils/share.js — never throws.
   ============================================================ */

async function openExternalLink(url) {
  if (!url) return
  // The Capacitor Browser plugin is optional — when installed it gives
  // us a native in-app browser sheet on iOS. Otherwise fall back to
  // window.open with rel="noopener". The `/* @vite-ignore */` keeps
  // Rollup from trying to resolve the module at build time so the
  // bundle still ships when the plugin isn't on disk.
  const pluginName = '@capacitor/browser'
  try {
    const mod = await import(/* @vite-ignore */ pluginName)
    const Browser = mod?.Browser
    if (Browser?.open) {
      await Browser.open({ url })
      return
    }
  } catch {
    // Plugin missing — fall through to window.open.
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/* ============================================================
   Social platform metadata
   ============================================================ */

const SOCIAL_PLATFORMS = [
  {
    key: 'instagram',
    profileField: 'instagramHandle',
    Icon: FaInstagram,
    url: (h) => `https://instagram.com/${h}`,
  },
  {
    key: 'x',
    profileField: 'xHandle',
    Icon: FaXTwitter,
    url: (h) => `https://x.com/${h}`,
  },
  {
    key: 'youtube',
    profileField: 'youtubeHandle',
    Icon: FaYoutube,
    url: (h) => `https://youtube.com/@${h}`,
  },
  {
    key: 'tiktok',
    profileField: 'tiktokHandle',
    Icon: FaTiktok,
    url: (h) => `https://tiktok.com/@${h}`,
  },
]

/* ============================================================
   Activity → "recent activity" thumbnail metadata
   ============================================================ */

const ACTIVITY_ICON = {
  status_changed: LuPlay,
  review_posted: LuStar,
  list_created: LuPlus,
  game_added_to_list: LuPlus,
}

function getActivityIcon(activity) {
  if (activity.activityType === 'status_changed') {
    const to = activity.metadata?.to_status
    if (to === 'played') return LuCheck
    if (to === 'currently') return LuPlay
    if (to === 'want') return LuPlus
  }
  return ACTIVITY_ICON[activity.activityType] || LuPlay
}

/* ============================================================
   Recent-activity thumbnail enrichment
   The activities table only stores igdb_game_id + game_title in
   metadata. We need the cover image to render the thumbnail row.
   Pull recent reviews + custom-list game cards in one swoop and
   build a (gameId → image) map so the thumbnail row is O(1) per row.
   ============================================================ */

function buildGameImageMap(reviews, lists, favorites) {
  const map = new Map()
  for (const r of reviews) {
    if (r.igdb_game_id != null && r.game_image) {
      map.set(String(r.igdb_game_id), r.game_image)
    }
  }
  for (const l of lists) {
    for (const g of l.previewGames || []) {
      if (g.id != null && g.image) {
        map.set(String(g.id), g.image)
      }
    }
  }
  for (const g of favorites || []) {
    if (g.id != null && g.image) map.set(String(g.id), g.image)
  }
  return map
}

/* ============================================================
   Main component
   ============================================================ */

function Profile() {
  const navigate = useNavigate()
  const location = useLocation()
  const { username: paramUsername, userId: paramUserId } = useParams()
  const { user } = useAuth()
  const { session: activeSession } = useSession()
  const { enabled: presenceEnabled, playingNow } = usePresence()
  const reducedMotion = useReducedMotion()

  // ── Username → userId resolution ───────────────────────────────────────
  // When arriving via /user/:username we must look up the UUID before we
  // can fetch Supabase data. `resolvedUser` carries the raw Supabase row
  // ({ id, username, display_name, avatar_url, bio }) for other-user
  // profiles, or null when it's the signed-in user's own profile.
  // `userNotFound` is set true when the lookup returns no row.
  const [resolvedUser, setResolvedUser] = useState(null)
  // Resolving when either param is present.
  const [resolving, setResolving] = useState(!!(paramUsername || paramUserId))
  const [userNotFound, setUserNotFound] = useState(false)

  useEffect(() => {
    // No param → own profile.
    if (!paramUsername && !paramUserId) {
      setResolvedUser(null)
      setResolving(false)
      setUserNotFound(false)
      return
    }
    let cancelled = false
    setResolving(true)
    setUserNotFound(false)

    // /user/id/:userId route — look up by UUID directly.
    if (paramUserId) {
      const decodedId = decodeURIComponent(paramUserId)
      // Fast-path: own userId.
      if (user?.id && user.id === decodedId) {
        if (!cancelled) { setResolvedUser(null); setResolving(false) }
        return
      }
      safeWithTimeout(getUserById(decodedId), null, 8_000)
        .then((row) => {
          if (cancelled) return
          if (!row) {
            setUserNotFound(true)
            setResolvedUser(null)
          } else {
            setResolvedUser(row)
            setUserNotFound(false)
          }
        })
        .catch(() => {
          if (!cancelled) { setUserNotFound(true); setResolvedUser(null) }
        })
        .finally(() => { if (!cancelled) setResolving(false) })
      return () => { cancelled = true }
    }

    // /user/:username route.
    const decoded = decodeURIComponent(paramUsername)
    // Fast-path: check against the signed-in user's own username so we
    // don't make a Supabase round-trip just to land on own profile.
    const localProfile = getProfile()
    const ownUsername = (localProfile?.username || '').trim()
    if (ownUsername && ownUsername.toLowerCase() === decoded.toLowerCase()) {
      if (!cancelled) { setResolvedUser(null); setResolving(false) }
      return
    }
    // 8-second timeout so a stalled connection doesn't leave resolving=true
    // (skeleton visible) forever. On timeout, safeWithTimeout resolves to null
    // which the .then() branch treats as "not found" — clears the skeleton.
    safeWithTimeout(getUserByUsername(decoded), null, 8_000)
      .then((row) => {
        if (cancelled) return
        if (!row) {
          setUserNotFound(true)
          setResolvedUser(null)
        } else {
          setResolvedUser(row)
          setUserNotFound(false)
        }
      })
      .catch(() => {
        if (!cancelled) { setUserNotFound(true); setResolvedUser(null) }
      })
      .finally(() => { if (!cancelled) setResolving(false) })
    return () => { cancelled = true }
  }, [paramUsername, paramUserId, user?.id])

  // /profile (no param) is always the signed-in user.
  // /user/:username is own profile when the username matches.
  // /user/id/:userId is own profile when the UUID matches.
  const isOwnProfile = (!paramUsername && !paramUserId) || (!resolving && resolvedUser === null && !userNotFound)
  const targetUserId = resolvedUser?.id || user?.id

  // Local profile blob (display name / avatar / bio / socials / favorites).
  // Lives in localStorage for the signed-in user; for "another user"
  // viewing we'd fetch from Supabase but Sprint 5 only wires the own-
  // profile UX so we still source everything from localStorage here.
  const [profile, setProfile] = useState(null)

  // Tabs: 'home' (default), 'reviews', 'lists'
  const [activeTab, setActiveTab] = useState('home')

  // Modals / sheets
  const [showEditModal, setShowEditModal] = useState(false)
  const [showBioSheet, setShowBioSheet] = useState(false)
  const [showSortSheet, setShowSortSheet] = useState(false)
  const [showCreateListModal, setShowCreateListModal] = useState(false)
  const [showFavPickerSheet, setShowFavPickerSheet] = useState(false)
  const [showGamePickerSheet, setShowGamePickerSheet] = useState(false)

  // Header kebab dropdown
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef(null)

  // DNA share — 'idle' | 'generating' | 'done'
  const [dnaSharing, setDnaSharing] = useState('idle')
  // Wrapped share — 'idle' | 'generating' | 'done'
  const [wrappedSharing, setWrappedSharing] = useState('idle')

  // Sprint 7 — Block confirm sheet (other-user profiles only)
  const [blockSheetOpen, setBlockSheetOpen] = useState(false)
  const [blockPending, setBlockPending] = useState(false)

  // Sprint 8 — Report profile sheet (other-user profiles only)
  const [reportProfileOpen, setReportProfileOpen] = useState(false)

  // Yearly challenge + streak milestones (own profile only).
  const thisYear = new Date().getFullYear()
  const [goalProgress, setGoalProgress] = useState({
    hasGoal: false, target: null, current: 0, year: thisYear, percent: 0,
  })
  const [streakData, setStreakData] = useState(null)
  const [goalSheetOpen, setGoalSheetOpen] = useState(false)

  // Bio "more"/"less" expansion. We measure the collapsed paragraph's
  // overflow on layout to decide whether to render the toggle at all
  // — if the bio fits inside the 3-line clamp there's no "more" link.
  const [bioExpanded, setBioExpanded] = useState(false)
  const [bioCanExpand, setBioCanExpand] = useState(false)
  const bioRef = useRef(null)

  // Sort selection — same shape as before so callers downstream still
  // read a `{ reviews, lists }` object.
  const [activeSort, setActiveSort] = useState(readSortFromStorage)

  // Data
  const [allReviews, setAllReviews] = useState([])
  const [customLists, setCustomLists] = useState([])
  const [activities, setActivities] = useState([])
  const [journalEntries, setJournalEntries] = useState([])
  // Total hours tracked — summed from game_trackers.hours_played for the viewed user.
  const [totalHours, setTotalHours] = useState(null)
  // Sprint 6 P0 — Map<reviewId, count> fetched once per profile load
  // and re-fetched whenever reviews change. Drives the Most Liked sort
  // and the count rendered on each card. Seeded into useLikeState's
  // shared cache so individual cards skip per-card round-trips.
  const [reviewLikeCounts, setReviewLikeCounts] = useState(() => new Map())
  // Sprint 6 P1 — real comment counts for every review on this profile,
  // batched in one query alongside the like-count prefetch. Threaded
  // into the ReviewCard adapter so the comment-icon badge matches the
  // actual row count in the comments table.
  const [reviewCommentCounts, setReviewCommentCounts] = useState(() => new Map())

  // Sprint 6 P3 — pinned reviews. Loaded in parallel with the main
  // reviews fetch so the Pinned section renders at the same time as
  // the sorted list below it. Each entry is { position, review } where
  // `review` carries the full row + embedded users join, ready to feed
  // through rowToReviewCard.
  const [pinnedRows, setPinnedRows] = useState([])
  const [showReorderModal, setShowReorderModal] = useState(false)

  // Pinned lists (Section B on the Home tab). Loaded in parallel with
  // the main data fetch; ordered by pinned_at DESC, cap 5.
  const [pinnedLists, setPinnedLists] = useState([])

  // ── Follow graph (Sprint 6) ─────────────────────────────────────
  // followersCount is the count shown on the Followers stat numeral.
  // `following` is the state of the Follow / Following toggle on
  // another user's profile (always false on own). `followPending`
  // debounces rapid taps so the optimistic UI doesn't race itself.
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [following, setFollowing] = useState(false)
  const [followPending, setFollowPending] = useState(false)

  // Sprint 7 — banner URL for non-own profiles fetched from Supabase.
  // Own profile reads bannerUrl directly from the localStorage profile blob.
  const [otherUserBannerUrl, setOtherUserBannerUrl] = useState(null)

  // Reviews tab — infinite scroll. Keep all rows in memory (already
  // sorted above) and reveal them in pages of REVIEWS_PAGE_SIZE.
  const REVIEWS_PAGE_SIZE = 10
  const [reviewsPage, setReviewsPage] = useState(1)
  const reviewsSentinelRef = useRef(null)

  // ── Filter icon visibility (Prompt 4 rule) ───────────────────────────
  // Only renders for own profile, only on the Reviews/Lists tabs.
  const showFilterIcon =
    isOwnProfile && (activeTab === 'reviews' || activeTab === 'lists')

  /* ── Data loading ──────────────────────────────────────────────── */

  const loadProfileData = useCallback(async () => {
    // Own profile: read display name / avatar / bio from localStorage.
    // Other-user profile: shape an equivalent blob from the Supabase row
    // that was resolved from the URL :username param.
    if (isOwnProfile) {
      const userProfile = getProfile() || initializeProfile()
      setProfile(userProfile)
    } else if (resolvedUser) {
      setProfile({
        displayName: resolvedUser.display_name || resolvedUser.username || '',
        username: resolvedUser.username || '',
        avatarUrl: resolvedUser.avatar_url || null,
        bio: resolvedUser.bio || '',
        bannerUrl: null, // fetched separately below via fetchUserBannerUrl
        socialLinks: {},
        favoriteGames: [],
        currentlyPlayingGame: null,
      })
    }

    if (targetUserId) {
      try {
        // Sprint 6 P3 — pins fetched in parallel with the main reviews
        // load so the Pinned section paints in the same frame as the
        // sorted list below it. The pinned-review IDs are then merged
        // into the like/comment prefetch below so cards in the Pinned
        // section render with filled hearts + accurate comment counts.
        // Each call is guarded by safeWithTimeout so a stalled mobile
        // connection resolves to an empty fallback rather than hanging
        // the profile data indefinitely.
        const [rows, lists, acts, pins, pinnedListData, gp, sd, journalRows] = await Promise.all([
          safeWithTimeout(getReviewsForUser(targetUserId), []),
          safeWithTimeout(getListsForUser(targetUserId), []),
          safeWithTimeout(getActivitiesForUser(targetUserId, { limit: 8 }), []),
          safeWithTimeout(getPinsForUser(targetUserId), []),
          safeWithTimeout(getPinnedListsForUser(targetUserId), []),
          isOwnProfile ? safeWithTimeout(getGoalProgress(targetUserId, new Date().getFullYear()), null) : Promise.resolve(null),
          isOwnProfile ? safeWithTimeout(getStreakData(targetUserId), null) : Promise.resolve(null),
          safeWithTimeout(getJournalEntriesForUser(targetUserId, { limit: 50 }), []),
        ])
        if (gp) setGoalProgress(gp)
        if (sd) setStreakData(sd)
        setAllReviews(rows)
        setPinnedRows(pins)
        setPinnedLists(pinnedListData)
        setCustomLists(
          lists.map((l) => ({
            id: l.id,
            name: l.name,
            description: l.description || '',
            createdAt: l.createdAt,
            updatedAt: l.updatedAt,
            gameCount: l.gameCount,
            previewGames: l.previewGames || [],
            games: l.games || [],
            likeCount: 0,
            commentCount: 0,
          }))
        )
        setActivities(acts)
        setJournalEntries(journalRows || [])

        // Sprint 7 — fetch banner URL for other users' profiles.
        // Own profile already has bannerUrl in the localStorage blob.
        if (!isOwnProfile) {
          fetchUserBannerUrl(targetUserId)
            .then((url) => setOtherUserBannerUrl(url || null))
            .catch(() => setOtherUserBannerUrl(null))
        }

        // Batch-fetch like counts + this user's liked-set + comment
        // counts for every review on this profile in parallel. Seeds the
        // useLikeState cache too so cards render with filled hearts
        // immediately (no per-card flicker), and the comment badge
        // matches the real Supabase row count rather than 0.
        try {
          // Union the unsorted review ids and the pinned-review ids —
          // a pinned review's row should always be in `rows`, but
          // defensively de-dupe via Set in case a pin's source review
          // hasn't propagated yet.
          const idSet = new Set(rows.map((r) => r.id))
          for (const p of pins) {
            if (p.review?.id) idSet.add(p.review.id)
          }
          const ids = Array.from(idSet)
          const [counts, cCounts] = await Promise.all([
            safeWithTimeout(prefetchLikeStatesForReviews(ids), new Map()),
            safeWithTimeout(getCommentCountsForReviews(ids), new Map()),
          ])
          setReviewLikeCounts(counts)
          setReviewCommentCounts(cCounts)
        } catch (err) {
          console.error('[profile] like/comment count prefetch failed:', err)
          setReviewLikeCounts(new Map())
          setReviewCommentCounts(new Map())
        }
      } catch (err) {
        console.error('[profile] load failed:', err)
        setAllReviews([])
        setCustomLists([])
        setActivities([])
        setJournalEntries([])
        setReviewLikeCounts(new Map())
        setPinnedRows([])
        setPinnedLists([])
      }
    } else {
      setAllReviews([])
      setCustomLists([])
      setActivities([])
      setJournalEntries([])
      setReviewLikeCounts(new Map())
      setPinnedRows([])
      setPinnedLists([])
    }
  }, [targetUserId, isOwnProfile, resolvedUser])

  useEffect(() => {
    loadProfileData()
    const refresh = () => loadProfileData()
    window.addEventListener('storage', refresh)
    window.addEventListener('reviewAdded', refresh)
    window.addEventListener('profileUpdated', refresh)
    window.addEventListener('libraryUpdated', refresh)
    window.addEventListener('activityUpdated', refresh)
    window.addEventListener('journalEntryAdded', refresh)
    // Sprint 6 P3 — pin changes triggered from a ReviewCard kebab can
    // be either on this profile (own) or on a card embedded in some
    // other screen (Home/Game detail). Either way we re-load so the
    // Pinned section stays in sync without a hard refresh.
    window.addEventListener(PIN_CHANGED_EVENT, refresh)
    // List pin changes (pin/unpin from ListDetail or ListsTab).
    window.addEventListener(LIST_PIN_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('reviewAdded', refresh)
      window.removeEventListener('profileUpdated', refresh)
      window.removeEventListener('libraryUpdated', refresh)
      window.removeEventListener('activityUpdated', refresh)
      window.removeEventListener('journalEntryAdded', refresh)
      window.removeEventListener(PIN_CHANGED_EVENT, refresh)
      window.removeEventListener(LIST_PIN_CHANGED_EVENT, refresh)
    }
  }, [loadProfileData])

  /* ── Follow graph load + live updates ─────────────────────────── */

  // Loads the follower count + the signed-in user's follow state for
  // this profile. Rebuilt as a callback so the FOLLOW_CHANGED_EVENT
  // listener below can invoke it without re-mounting the effect every
  // render.
  const loadFollowState = useCallback(async () => {
    if (!targetUserId) {
      setFollowersCount(0)
      setFollowing(false)
      return
    }
    try {
      const [followers, followingCnt, amFollowing] = await Promise.all([
        getFollowerCount(targetUserId),
        getFollowingCount(targetUserId),
        isOwnProfile ? Promise.resolve(false) : fetchIsFollowing(targetUserId),
      ])
      setFollowersCount(followers)
      setFollowingCount(followingCnt)
      setFollowing(amFollowing)
    } catch (err) {
      console.error('[profile] follow state load failed:', err)
    }
  }, [targetUserId, isOwnProfile])

  useEffect(() => {
    loadFollowState()
  }, [loadFollowState])

  // Sprint 7 — open the Edit Profile modal when this page is reached
  // via the /edit-profile redirect (Settings page deep link). Replace
  // the history entry so a back-tap doesn't loop us back through the
  // redirect → modal cycle.
  useEffect(() => {
    if (!isOwnProfile) return
    if (location.state?.openEditModal) {
      setShowEditModal(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [isOwnProfile, location.state, location.pathname, navigate])

  // When the signed-in user follows / unfollows ANYONE (eg. via the
  // Search Users tab), refresh the count on the currently-viewed
  // profile if it was the target. This keeps the numeral in lockstep
  // with the toggle button regardless of which screen owned the action.
  useEffect(() => {
    function handleFollowChanged(e) {
      const followeeId = e?.detail?.followeeId
      if (!followeeId) return
      if (followeeId === targetUserId) {
        loadFollowState()
      }
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleFollowChanged)
    return () => {
      window.removeEventListener(FOLLOW_CHANGED_EVENT, handleFollowChanged)
    }
  }, [targetUserId, loadFollowState])

  /* ── Total hours fetch ─────────────────────────────────────────── */

  useEffect(() => {
    if (!targetUserId) {
      setTotalHours(null)
      return undefined
    }
    let cancelled = false
    getTotalHoursForUser(targetUserId)
      .then((h) => { if (!cancelled) setTotalHours(h) })
      .catch(() => { if (!cancelled) setTotalHours(null) })
    return () => { cancelled = true }
  }, [targetUserId])

  /* ── Live presence status for this profile ─────────────────────── */

  // Own profile: show if the signed-in user opted in AND has an active session.
  // Other profile: show if the viewed user appears in the followee presence list
  // (which already enforces both opt-in and the follow relationship).
  const liveStatus = useMemo(() => {
    if (isOwnProfile) {
      if (!presenceEnabled || !activeSession?.game_title) return null
      return { gameTitle: activeSession.game_title }
    }
    const entry = playingNow.find((p) => p.userId === targetUserId)
    return entry?.gameTitle ? { gameTitle: entry.gameTitle } : null
  }, [isOwnProfile, presenceEnabled, activeSession, playingNow, targetUserId])

  /* ── Derived data ─────────────────────────────────────────────── */

  // Set of pinned review IDs, used to filter the sorted list below the
  // Pinned section so each pin renders exactly once on the page.
  const pinnedIdSet = useMemo(
    () => new Set(pinnedRows.map((p) => p.review?.id).filter(Boolean)),
    [pinnedRows]
  )

  const sortedReviews = useMemo(
    () =>
      sortReviews(allReviews, activeSort.reviews, reviewLikeCounts).filter(
        (r) => !pinnedIdSet.has(r.id)
      ),
    [allReviews, activeSort.reviews, reviewLikeCounts, pinnedIdSet]
  )

  const sortedLists = useMemo(
    () => sortLists(customLists, activeSort.lists),
    [customLists, activeSort.lists]
  )

  const visibleReviews = useMemo(
    () => sortedReviews.slice(0, reviewsPage * REVIEWS_PAGE_SIZE),
    [sortedReviews, reviewsPage]
  )

  const hasMoreReviews = visibleReviews.length < sortedReviews.length

  // Build a (gameId → image) map across reviews/lists/favorites so
  // recent-activity thumbnails can render without a per-row IGDB
  // round-trip.
  const gameImageMap = useMemo(
    () => buildGameImageMap(allReviews, customLists, profile?.favoriteGames || []),
    [allReviews, customLists, profile?.favoriteGames]
  )

  // Section A: most recent 10 reviews/ratings by created_at for the
  // Home tab reviews shelf. Sorted independently of the Reviews tab
  // sort so the shelf always shows newest-first regardless of the user's
  // chosen sort preference on that tab.
  const recentReviews = useMemo(
    () =>
      allReviews
        .slice()
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 10)
        .map((row) => rowToReviewCard(row, reviewLikeCounts, reviewCommentCounts)),
    [allReviews, reviewLikeCounts, reviewCommentCounts]
  )

  // Avoid SharedCover layoutId collisions across all the cover surfaces
  // on this screen.
  const duplicateIds = useMemo(() => {
    const reviewGames = allReviews
      .filter((r) => r?.igdb_game_id)
      .map((r) => ({ id: r.igdb_game_id, image: r.game_image }))
    const favs = profile?.favoriteGames || []
    const activityGames = activities
      .filter((a) => a.igdbGameId != null)
      .map((a) => ({
        id: a.igdbGameId,
        image: gameImageMap.get(String(a.igdbGameId)),
      }))
    return findDuplicateGameIds(
      favs,
      reviewGames,
      activityGames,
      ...customLists.map((l) => l.previewGames || [])
    )
  }, [allReviews, customLists, activities, profile?.favoriteGames, gameImageMap])

  /* ── Reviews infinite-scroll sentinel ─────────────────────────── */

  useEffect(() => {
    if (activeTab !== 'reviews') return undefined
    const node = reviewsSentinelRef.current
    if (!node || !hasMoreReviews) return undefined
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreReviews) {
          setReviewsPage((p) => p + 1)
        }
      },
      { rootMargin: '400px' }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [activeTab, hasMoreReviews, visibleReviews.length])

  // Reset pagination when the sort changes or the underlying list
  // shrinks (e.g. after a delete) so we don't render an empty page.
  useEffect(() => {
    setReviewsPage(1)
  }, [activeSort.reviews, allReviews.length])

  // Collapse the bio when the underlying profile changes (e.g. navigating
  // between users) so the new bio starts in its collapsed state.
  useEffect(() => {
    setBioExpanded(false)
  }, [targetUserId])

  /* ── Kebab outside-click close ────────────────────────────────── */

  useEffect(() => {
    if (!kebabOpen) return undefined
    function handleOutside(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [kebabOpen])

  /* ── Bio overflow measurement ─────────────────────────────────── */

  // Measure scrollHeight vs clientHeight on the collapsed paragraph to
  // determine whether the bio actually exceeds the 3-line clamp. We
  // only measure while collapsed; expanding the bio removes the clamp
  // so the measurement would always read "no overflow" and the toggle
  // would lose its "less" affordance. Re-running on bio text changes
  // keeps the toggle accurate after Edit Profile saves.
  useLayoutEffect(() => {
    if (!bioRef.current) return
    if (bioExpanded) return
    const el = bioRef.current
    setBioCanExpand(el.scrollHeight - el.clientHeight > 1)
  }, [profile?.bio, bioExpanded])

  /* ── Action handlers ──────────────────────────────────────────── */

  const handleProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile)
    window.dispatchEvent(new Event('profileUpdated'))
  }

  const handleSaveBio = (updatedProfile) => {
    setProfile(updatedProfile)
    window.dispatchEvent(new Event('profileUpdated'))
  }

  const handleSaveFavorites = (newFavorites) => {
    const updated = updateProfile({ favoriteGames: newFavorites })
    setProfile(updated)
    window.dispatchEvent(new Event('profileUpdated'))
  }

  const handleSortApply = (sortValue) => {
    const tabKey = activeTab === 'lists' ? 'lists' : 'reviews'
    const newSort = { ...activeSort, [tabKey]: sortValue }
    setActiveSort(newSort)
    try {
      localStorage.setItem(SORT_LS_KEY, JSON.stringify(newSort))
    } catch {
      // localStorage unavailable — sort still applied in memory
    }
  }

  const handleShareProfile = async () => {
    const username = profile?.username || profile?.displayName || 'profile'
    const url = `${window.location.origin}/user/${encodeURIComponent(username)}`
    await shareContent({
      title: `${profile?.displayName || username} on GameTracker`,
      text: profile?.bio || '',
      url,
    })
  }

  const handleShareDNA = useCallback(async () => {
    if (dnaSharing === 'generating') return
    setDnaSharing('generating')
    try {
      const portrait = computeDNAPortrait()
      const username = profile?.username || profile?.displayName || null
      const displayName = profile?.displayName || username
      const avatarUrl = profile?.avatarUrl || profile?.avatar_url || null
      await shareCard({
        variant: 'profile-dna',
        data: {
          ...portrait,
          username,
          displayName,
          avatarUrl,
          // Map portrait field names to what ProfileDnaVariant expects
          gamesPlayed: portrait.totalGames,
          reviews: portrait.reviewCount,
          following: followingCount,
          genres: portrait.topGenres,
        },
        target: {
          type: 'profile',
          username: username || user?.id || '',
        },
        title: `${displayName || 'My'} Gamer DNA — GameTracker`,
      })
      setDnaSharing('done')
      setTimeout(() => setDnaSharing('idle'), 2500)
    } catch (err) {
      console.error('[profile] handleShareDNA failed:', err)
      showToast('Could not generate DNA card — please try again.', 'error')
      setDnaSharing('idle')
    }
  }, [dnaSharing, profile, user?.id, followingCount])

  const handleShareWrapped = useCallback(async (period = 'year') => {
    if (wrappedSharing === 'generating') return
    setWrappedSharing('generating')
    try {
      const summary = compileWrappedSummary(period)
      const username = profile?.username || profile?.displayName || null
      await shareCard({
        variant: 'wrapped-summary',
        data: summary,
        target: {
          type: 'profile',
          username: username || user?.id || '',
        },
        title: `My ${summary.periodLabel} in Games — GameTracker`,
      })
      setWrappedSharing('done')
      setTimeout(() => setWrappedSharing('idle'), 2500)
    } catch (err) {
      console.error('[profile] handleShareWrapped failed:', err)
      showToast('Could not generate Wrapped card — please try again.', 'error')
      setWrappedSharing('idle')
    }
  }, [wrappedSharing, profile, user?.id])

  const handleFollowToggle = useCallback(async () => {
    if (!targetUserId || isOwnProfile || followPending) return
    const wasFollowing = following

    // Optimistic toggle — flip the button label and bump the follower
    // numeral immediately so the UI feels instant.
    setFollowing(!wasFollowing)
    setFollowersCount((c) => Math.max(0, c + (wasFollowing ? -1 : 1)))
    setFollowPending(true)

    try {
      if (wasFollowing) {
        await unfollowUser(targetUserId)
      } else {
        await followUser(targetUserId)
      }
    } catch (err) {
      // Roll back on failure.
      setFollowing(wasFollowing)
      setFollowersCount((c) => Math.max(0, c + (wasFollowing ? 1 : -1)))
      console.error('[profile] follow toggle failed:', err)
      showToast(
        "Couldn't update follow status. Tap to retry.",
        'error',
        4000,
        { label: 'Retry', onClick: () => handleFollowToggle() }
      )
    } finally {
      setFollowPending(false)
    }
  }, [targetUserId, isOwnProfile, followPending, following])

  /* ── Pin / Unpin / Reorder handlers (Sprint 6 P3) ─────────────── */

  // Pin a review owned by the signed-in user. Silent-append to the
  // next free slot; toast when all MAX_PINS slots are full. The
  // optimistic add (push to local state) happens before the network
  // call so the Pinned section reflects the change immediately.
  const handlePinReview = useCallback(
    async (reviewRow) => {
      if (!reviewRow || !user?.id) return
      if (pinnedRows.length >= MAX_PINS) {
        showToast(
          `You can only pin ${MAX_PINS} reviews. Unpin one first.`,
          'error'
        )
        return
      }
      // Skip if already pinned (defensive — the kebab option shouldn't
      // be visible in that case, but optimistic refetches can race).
      if (pinnedIdSet.has(reviewRow.id)) return
      const nextPosition = pinnedRows.length
      const optimistic = [
        ...pinnedRows,
        { position: nextPosition, review: reviewRow },
      ]
      setPinnedRows(optimistic)
      try {
        await pinReviewSvc({ reviewId: reviewRow.id })
        showToast('Pinned to profile', 'success')
      } catch (err) {
        console.error('[profile] pinReview failed:', err)
        setPinnedRows(pinnedRows)
        if (err?.code === 'PINS_FULL') {
          showToast(
            `You can only pin ${MAX_PINS} reviews. Unpin one first.`,
            'error'
          )
        } else {
          showToast("Couldn't pin review — please try again.", 'error')
        }
      }
    },
    [pinnedRows, pinnedIdSet, user?.id]
  )

  // Unpin a review. Optimistic local-state filter, rollback on failure.
  const handleUnpinReview = useCallback(
    async (reviewId) => {
      if (!reviewId) return
      const prev = pinnedRows
      // Drop the row + re-index the remaining slots so the UI matches
      // what reorderPins would persist if the user re-pinned later. The
      // server pin row was at some position N; deleting it leaves a
      // gap that's fine for the table (positions don't need to be
      // contiguous), but the user-facing slot numbers should always
      // read 1, 2, 3 from the top.
      const next = prev
        .filter((p) => p.review?.id !== reviewId)
        .map((p, i) => ({ ...p, position: i }))
      setPinnedRows(next)
      try {
        await unpinReviewSvc(reviewId)
        showToast('Removed from pinned', 'success')
      } catch (err) {
        console.error('[profile] unpinReview failed:', err)
        setPinnedRows(prev)
        showToast("Couldn't unpin review — please try again.", 'error')
      }
    },
    [pinnedRows]
  )

  const handleEditReview = useCallback(
    (reviewShape) => {
      if (!reviewShape?.id) return
      navigate(`/review/new?gameId=${reviewShape.game.id}`, {
        state: {
          game: {
            id: reviewShape.game.id,
            title: reviewShape.game.name,
            image: reviewShape.game.coverUrl,
          },
          editReview: reviewShape,
        },
      })
    },
    [navigate]
  )

  // Persist a new pin order from the reorder modal. Optimistic local
  // re-order, rollback on failure. Throws on failure so the modal's
  // catch can keep the sheet open for retry.
  const handleReorderPins = useCallback(
    async (orderedReviewIds) => {
      const prev = pinnedRows
      const byId = new Map(prev.map((p) => [p.review?.id, p]))
      const optimistic = orderedReviewIds
        .map((id, i) => {
          const row = byId.get(id)
          return row ? { ...row, position: i } : null
        })
        .filter(Boolean)
      setPinnedRows(optimistic)
      try {
        await reorderPinsSvc(orderedReviewIds)
        showToast('Pin order updated', 'success')
      } catch (err) {
        console.error('[profile] reorderPins failed:', err)
        setPinnedRows(prev)
        showToast("Couldn't reorder pins — please try again.", 'error')
        throw err
      }
    },
    [pinnedRows]
  )

  // Pin a custom list to the profile Home tab (Section B).
  // Optimistic: prepend to pinnedLists + flip flag in customLists,
  // roll back + toast on failure. Max 5; disabled with a toast at cap.
  const handlePinList = useCallback(
    async (list) => {
      if (!list || !isOwnProfile) return
      if (pinnedLists.length >= 5) {
        showToast('You can only pin 5 lists. Unpin one first.', 'error')
        return
      }
      const nowStr = new Date().toISOString()
      const optimisticPinned = [
        { ...list, isPinned: true, pinnedAt: nowStr },
        ...pinnedLists,
      ].slice(0, 5)
      const prevPinned = pinnedLists
      setPinnedLists(optimisticPinned)
      setCustomLists((cls) =>
        cls.map((l) =>
          l.id === list.id ? { ...l, isPinned: true, pinnedAt: nowStr } : l
        )
      )
      try {
        await pinListSvc(list.id)
        showToast('Pinned to profile', 'success')
      } catch (err) {
        console.error('[profile] pinList failed:', err)
        setPinnedLists(prevPinned)
        setCustomLists((cls) =>
          cls.map((l) =>
            l.id === list.id ? { ...l, isPinned: false, pinnedAt: null } : l
          )
        )
        if (err?.code === 'LIST_PINS_FULL') {
          showToast('You can only pin 5 lists. Unpin one first.', 'error')
        } else {
          showToast("Couldn't pin list — please try again.", 'error')
        }
      }
    },
    [pinnedLists, isOwnProfile]
  )

  // Unpin a custom list. Optimistic removal from both state slices;
  // roll back + toast on failure.
  const handleUnpinList = useCallback(
    async (listId) => {
      if (!listId) return
      const prevPinned = pinnedLists
      setPinnedLists((pls) => pls.filter((l) => l.id !== listId))
      setCustomLists((cls) =>
        cls.map((l) =>
          l.id === listId ? { ...l, isPinned: false, pinnedAt: null } : l
        )
      )
      try {
        await unpinListSvc(listId)
        showToast('Unpinned', 'success')
      } catch (err) {
        console.error('[profile] unpinList failed:', err)
        setPinnedLists(prevPinned)
        setCustomLists((cls) =>
          cls.map((l) => (l.id === listId ? { ...l, isPinned: true } : l))
        )
        showToast("Couldn't unpin list — please try again.", 'error')
      }
    },
    [pinnedLists]
  )

  const handleCreateList = async (listName, description, initialGames) => {
    const listId = await createList({
      name: listName,
      description,
      isPublic: true,
    })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  /* ── Loading state ────────────────────────────────────────────── */

  // While the username → UUID resolution round-trip is in-flight, show
  // the same skeleton to avoid a blank flash before the profile paints.
  if (resolving || (!profile && !userNotFound)) {
    return (
      <div className="profile-page" aria-hidden="true">
        <div className="profile-header-strip">
          <span className="profile-header-strip__slot" />
          <span className="profile-header-strip__title-sk skeleton" />
          <span className="profile-header-strip__slot" />
        </div>
        <div className="profile-ig-hero profile-ig-hero--skeleton">
          <div className="profile-ig-hero__top-row">
            <div className="skeleton profile-ig-hero__avatar-sk" />
            <div className="profile-ig-hero__stats">
              <div className="skeleton profile-ig-stat-sk" />
              <div className="skeleton profile-ig-stat-sk" />
              <div className="skeleton profile-ig-stat-sk" />
            </div>
          </div>
          <span className="skeleton profile-ig-hero__name-sk" />
          <span className="skeleton profile-ig-hero__handle-sk" />
        </div>
      </div>
    )
  }

  if (userNotFound) {
    return (
      <div className="profile-page">
        <div className="profile-header-strip">
          <button
            type="button"
            className="profile-header-strip__icon-btn"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <LuChevronLeft size={24} />
          </button>
        </div>
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem' }}>
            This user doesn&apos;t exist or has been removed.
          </p>
        </div>
      </div>
    )
  }

  /* ── Display data ─────────────────────────────────────────────── */

  const defaultAvatar = generateDefaultAvatar(profile.displayName || 'User')
  // Support both legacy base64 (`type: 'data'`) and new Storage URL (`type: 'url'`).
  const avatarDisplay =
    profile.avatar?.type === 'url' || profile.avatar?.type === 'data'
      ? profile.avatar.data
      : profile.avatarUrl || null

  // Sprint 7 — own profile reads from localStorage blob; other profiles
  // use the Supabase-fetched value loaded in `loadProfileData`.
  const displayBannerUrl = isOwnProfile
    ? (profile.bannerUrl || null)
    : otherUserBannerUrl

  // Cobalt-Modern header strip — centered title is the user's
  // display name per spec. Falls back to username then a generic
  // placeholder so the header never renders empty.
  const headerTitle =
    profile.displayName?.trim() ||
    profile.username?.trim() ||
    'Profile'

  const reviewCount = allReviews.length
  const playedCount = (() => {
    // Reuse the localStorage tracker count without round-tripping the
    // heavier profileStats helper. The gameLibrary blob is the source of
    // truth for the Played list.
    try {
      const raw = localStorage.getItem('gameLibrary')
      if (!raw) return 0
      const lib = JSON.parse(raw)
      return lib?.lists?.played?.games?.length || 0
    } catch {
      return 0
    }
  })()

  const setSocials = SOCIAL_PLATFORMS.filter(
    (p) => (profile[p.profileField] || '').trim().length > 0
  )

  const favoriteGames = profile.favoriteGames || []
  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="profile-page">
        {/* ═════════════════════════════════════════════════════════
            HEADER STRIP — back / centered title / more
            ═════════════════════════════════════════════════════════ */}
        <header className="profile-header-strip">
          <div className="profile-header-strip__slot profile-header-strip__slot--left">
            {!isOwnProfile && (
              <button
                type="button"
                className="profile-header-strip__icon-btn"
                onClick={() => navigate(-1)}
                aria-label="Go back"
              >
                <LuChevronLeft size={22} aria-hidden="true" />
              </button>
            )}
          </div>
          <h1 className="profile-header-strip__title">{headerTitle}</h1>
          <div className="profile-header-strip__slot profile-header-strip__slot--right">
            {showFilterIcon && (
              <button
                type="button"
                className="profile-header-strip__icon-btn"
                aria-label="Sort options"
                onClick={() => setShowSortSheet(true)}
              >
                <SlidersHorizontal size={20} aria-hidden="true" />
              </button>
            )}
            {/* Envelope — opens the DM inbox. Shown on own profile only;
                other-user profiles have the "Message" action button in
                the hero, so a header icon there would be redundant. */}
            {isOwnProfile && (
              <button
                type="button"
                className="profile-header-strip__icon-btn"
                aria-label="Messages"
                onClick={() => navigate('/messages')}
              >
                <LuMail size={22} aria-hidden="true" />
              </button>
            )}
            {/* Sprint 7 — gear sits to the LEFT of the ellipsis on the
                signed-in user's own profile and opens the Settings page.
                Hidden on other-user profiles since they have no settings
                to manage from there. */}
            {isOwnProfile && (
              <button
                type="button"
                className="profile-header-strip__icon-btn"
                aria-label="Settings"
                onClick={() => navigate('/settings')}
              >
                <LuSettings size={22} aria-hidden="true" />
              </button>
            )}
            <div className="profile-header-strip__kebab-wrap" ref={kebabRef}>
              <button
                type="button"
                className="profile-header-strip__icon-btn"
                aria-label="More options"
                aria-expanded={kebabOpen}
                onClick={() => setKebabOpen((v) => !v)}
              >
                <HiDotsVertical size={20} aria-hidden="true" />
              </button>
              {kebabOpen && (
                <div className="profile-header-strip__kebab-menu" role="menu">
                  {isOwnProfile && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setKebabOpen(false)
                        setShowEditModal(true)
                      }}
                    >
                      Edit profile
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setKebabOpen(false)
                      handleShareProfile()
                    }}
                  >
                    Share profile
                  </button>
                  {isOwnProfile && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={dnaSharing === 'generating'}
                      onClick={() => {
                        setKebabOpen(false)
                        handleShareDNA()
                      }}
                    >
                      {dnaSharing === 'generating'
                        ? 'Generating…'
                        : dnaSharing === 'done'
                        ? 'Shared!'
                        : 'Share DNA'}
                    </button>
                  )}
                  {isOwnProfile && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={wrappedSharing === 'generating'}
                      onClick={() => {
                        setKebabOpen(false)
                        handleShareWrapped('year')
                      }}
                    >
                      {wrappedSharing === 'generating'
                        ? 'Generating…'
                        : wrappedSharing === 'done'
                        ? 'Shared!'
                        : 'Share Year Wrapped'}
                    </button>
                  )}
                  {isOwnProfile && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={wrappedSharing === 'generating'}
                      onClick={() => {
                        setKebabOpen(false)
                        handleShareWrapped('month')
                      }}
                    >
                      {wrappedSharing === 'generating'
                        ? 'Generating…'
                        : wrappedSharing === 'done'
                        ? 'Shared!'
                        : 'Share Month Wrapped'}
                    </button>
                  )}
                  {!isOwnProfile && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setKebabOpen(false)
                          setReportProfileOpen(true)
                        }}
                      >
                        Report profile
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="profile-header-strip__kebab-menu-item--destructive"
                        onClick={() => {
                          setKebabOpen(false)
                          setBlockSheetOpen(true)
                        }}
                      >
                        Block {profile.username || profile.displayName || 'user'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Banner — full-bleed strip between the header strip and the
            hero block. Sprint 7 preserved; the avatar overlaps it. */}
        {displayBannerUrl && (
          <div className="profile-banner" aria-hidden="true">
            <img
              src={displayBannerUrl}
              alt=""
              className="profile-banner__img"
              loading="lazy"
            />
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════
            IG-STYLE PROFILE HEADER — avatar+stats / name / handle /
            bio / action buttons (Instagram compact left-aligned layout)
            ═════════════════════════════════════════════════════════ */}
        <section className={`profile-ig-hero${displayBannerUrl ? ' profile-ig-hero--has-banner' : ''}`}>

          {/* ── Row 1: Avatar (left) + Stats (right) ── */}
          <div className="profile-ig-hero__top-row">
            <button
              type="button"
              className={`profile-ig-hero__avatar${isOwnProfile ? ' profile-ig-hero__avatar--editable' : ''}`}
              onClick={() => isOwnProfile && setShowEditModal(true)}
              aria-label={isOwnProfile ? 'Edit profile photo' : `${profile.displayName || 'User'} profile photo`}
            >
              {avatarDisplay ? (
                <img
                  src={avatarDisplay}
                  alt={`${profile.displayName || 'User'} profile photo`}
                  className="profile-ig-hero__avatar-img"
                />
              ) : (
                <div
                  className="profile-ig-hero__avatar-fallback"
                  style={{ backgroundColor: defaultAvatar.color }}
                >
                  {defaultAvatar.initials}
                </div>
              )}
            </button>

            <div className="profile-ig-hero__stats" role="group" aria-label="Profile stats">
              <div
                className="profile-ig-stat"
                aria-label={`Hours tracked, ${formatHours(totalHours)}`}
              >
                <span className="profile-ig-stat__value">{formatHours(totalHours)}</span>
                <span className="profile-ig-stat__label">Hours</span>
              </div>
              <div
                className="profile-ig-stat"
                aria-label={`Reviews, ${reviewCount}, not interactive`}
              >
                <span className="profile-ig-stat__value">{reviewCount}</span>
                <span className="profile-ig-stat__label">Reviews</span>
              </div>
              <button
                type="button"
                className="profile-ig-stat profile-ig-stat--clickable"
                onClick={() => {
                  const handle = profile.username || profile.displayName || 'user'
                  navigate(`/user/${encodeURIComponent(handle)}/followers`)
                }}
                aria-label={`Followers, ${followersCount}, view list`}
              >
                <span className="profile-ig-stat__value">{followersCount}</span>
                <span className="profile-ig-stat__label">Followers</span>
              </button>
              <button
                type="button"
                className="profile-ig-stat profile-ig-stat--clickable"
                onClick={() => {
                  const handle = profile.username || profile.displayName || 'user'
                  navigate(`/user/${encodeURIComponent(handle)}/following`)
                }}
                aria-label={`Following, ${followingCount}, view list`}
              >
                <span className="profile-ig-stat__value">{followingCount}</span>
                <span className="profile-ig-stat__label">Following</span>
              </button>
            </div>
          </div>

          {/* ── Row 2: Display name ── */}
          <h2 className="profile-ig-hero__name">
            {profile.displayName || 'You'}
          </h2>

          {/* ── Row 3: username (no @ prefix — cleaner look) ── */}
          {(profile.username || '').trim().length > 0 && (
            <p className="profile-ig-hero__handle">{profile.username.trim()}</p>
          )}

          {/* ── Live status — hidden when not playing or presence not shared ── */}
          {liveStatus && (
            <p className="profile-ig-hero__live-status" aria-live="polite">
              <span className="profile-ig-hero__live-dot" aria-hidden="true" />
              {`in ${liveStatus.gameTitle} now`}
            </p>
          )}

          {/* ── Row 4: Bio — 3-line clamp + more/less toggle ── */}
          {profile.bio ? (
            <div className="profile-ig-hero__bio-wrap">
              <p
                ref={bioRef}
                className={`profile-ig-hero__bio${
                  bioExpanded ? ' profile-ig-hero__bio--expanded' : ''
                }${isOwnProfile ? ' profile-ig-hero__bio--tappable' : ''}`}
                onClick={isOwnProfile ? () => setShowBioSheet(true) : undefined}
                role={isOwnProfile ? 'button' : undefined}
                tabIndex={isOwnProfile ? 0 : undefined}
                onKeyDown={
                  isOwnProfile
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setShowBioSheet(true)
                      }
                    : undefined
                }
                aria-label={isOwnProfile ? 'Edit bio' : undefined}
              >
                {profile.bio}
              </p>
              {bioCanExpand && (
                <button
                  type="button"
                  className="profile-ig-hero__bio-toggle"
                  onClick={() => setBioExpanded((v) => !v)}
                  aria-expanded={bioExpanded}
                >
                  {bioExpanded ? 'less' : 'more'}
                </button>
              )}
            </div>
          ) : (
            isOwnProfile && (
              <button
                type="button"
                className="profile-ig-hero__bio-cta"
                onClick={() => setShowBioSheet(true)}
              >
                Tell people what you play →
              </button>
            )
          )}

          {/* Social links — shown only when at least one handle is set */}
          {setSocials.length > 0 && (
            <div className="profile-ig-hero__socials">
              {setSocials.map((p) => {
                const handle = (profile[p.profileField] || '').trim()
                const Icon = p.Icon
                return (
                  <button
                    type="button"
                    key={p.key}
                    className="profile-ig-hero__social"
                    onClick={() => openExternalLink(p.url(handle))}
                    aria-label={`Open ${p.key} profile @${handle}`}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="profile-ig-hero__social-handle">
                      @{handle}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Row 5: Action buttons (two equal-width) ── */}
          <div className="profile-ig-hero__actions">
            {isOwnProfile ? (
              <>
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--secondary"
                  onClick={() => setShowEditModal(true)}
                  aria-label="Edit profile"
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--secondary"
                  onClick={handleShareProfile}
                  aria-label="Share profile"
                >
                  Share Profile
                </button>
                {/* DNA share — signature reveal; reduced-motion collapses animation */}
                <motion.button
                  type="button"
                  className={`profile-ig-btn profile-ig-btn--dna${dnaSharing !== 'idle' ? ' profile-ig-btn--dna-active' : ''}`}
                  onClick={handleShareDNA}
                  disabled={dnaSharing === 'generating'}
                  aria-label={
                    dnaSharing === 'generating'
                      ? 'Generating DNA card…'
                      : dnaSharing === 'done'
                      ? 'DNA card shared!'
                      : 'Share your Gamer DNA card'
                  }
                  aria-busy={dnaSharing === 'generating'}
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.88 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 400, damping: 26, delay: 0.18 }
                  }
                >
                  {dnaSharing === 'generating'
                    ? 'Generating…'
                    : dnaSharing === 'done'
                    ? '✓ Shared!'
                    : 'Share DNA'}
                </motion.button>
                <motion.button
                  type="button"
                  className={`profile-ig-btn profile-ig-btn--dna${wrappedSharing !== 'idle' ? ' profile-ig-btn--dna-active' : ''}`}
                  onClick={() => handleShareWrapped('year')}
                  disabled={wrappedSharing === 'generating'}
                  aria-label={
                    wrappedSharing === 'generating'
                      ? 'Generating Wrapped card…'
                      : wrappedSharing === 'done'
                      ? 'Wrapped card shared!'
                      : 'Share your Year Wrapped card'
                  }
                  aria-busy={wrappedSharing === 'generating'}
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.88 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 400, damping: 26, delay: 0.26 }
                  }
                >
                  {wrappedSharing === 'generating'
                    ? 'Generating…'
                    : wrappedSharing === 'done'
                    ? '✓ Shared!'
                    : 'Wrapped'}
                </motion.button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`profile-ig-btn${following ? ' profile-ig-btn--secondary profile-ig-btn--following' : ' profile-ig-btn--primary'}`}
                  onClick={handleFollowToggle}
                  disabled={followPending}
                  aria-pressed={following}
                  aria-label={following ? 'Unfollow' : 'Follow'}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--secondary"
                  onClick={() => {
                    const handle =
                      profile?.username ||
                      profile?.id ||
                      ''
                    if (!handle) return
                    navigate(`/messages/${encodeURIComponent(handle)}`)
                  }}
                  aria-label="Send message"
                >
                  Message
                </button>
              </>
            )}
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════
            TAB STRIP — Home / Reviews / Lists with sliding cobalt
            underline. Mirrors the layoutId pattern from BottomNav.
            ═════════════════════════════════════════════════════════ */}
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          {[
            { id: 'home', label: 'Home' },
            { id: 'reviews', label: 'Reviews' },
            { id: 'lists', label: 'Lists' },
            { id: 'diary', label: 'Diary' },
          ].map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`profile-tab${isActive ? ' profile-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="profile-tab__label">{tab.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="profile-tab-underline"
                    className="profile-tab__underline"
                    transition={
                      reducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 380, damping: 30 }
                    }
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* ═════════════════════════════════════════════════════════
            TAB CONTENT — horizontal slide between Home / Reviews / Lists.
            AnimatePresence with mode="wait" keyed on `activeTab` so each
            tab switch slides the outgoing pane left (x: -12) and the
            incoming pane in from the right (x: 12 → 0). 180 ms duration
            per the motion-system spec. Reduced motion collapses to a
            plain swap.
            ═════════════════════════════════════════════════════════ */}
        <div className="profile-tab-content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={reducedMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }
              }
            >
              {activeTab === 'home' && (
                <HomeTab
                  favoriteGames={favoriteGames}
                  activities={activities}
                  gameImageMap={gameImageMap}
                  userIdentifier={profile.username || profile.displayName || 'user'}
                  onGameClick={(id, image) =>
                    navigate(`/game/${id}`, image ? { state: { coverImage: image } } : undefined)
                  }
                  onActivityChevron={() =>
                    navigate(
                      `/user/${encodeURIComponent(profile.username || profile.displayName || 'user')}/activity`
                    )
                  }
                  user={user}
                  isOwnProfile={isOwnProfile}
                  onEditFavorites={() => setShowFavPickerSheet(true)}
                  recentReviews={recentReviews}
                  pinnedLists={pinnedLists}
                  onReviewsChevron={() => setActiveTab('reviews')}
                  onListsChevron={() => setActiveTab('lists')}
                  onTapList={(id) => navigate(`/list/${id}`)}
                  allReviews={allReviews}
                  onReviewTap={(id) => navigate(`/review/${id}`)}
                  goalProgress={goalProgress}
                  streakData={streakData}
                  onSetGoal={() => setGoalSheetOpen(true)}
                />
              )}

              {activeTab === 'reviews' && (
                <ReviewsTab
                  reviews={visibleReviews}
                  pinnedRows={pinnedRows}
                  likeCounts={reviewLikeCounts}
                  commentCounts={reviewCommentCounts}
                  hasMore={hasMoreReviews}
                  sentinelRef={reviewsSentinelRef}
                  isOwnProfile={isOwnProfile}
                  displayName={profile.displayName || profile.username || ''}
                  onWriteReview={() => setShowGamePickerSheet(true)}
                  currentUserId={user?.id}
                  onPinReview={handlePinReview}
                  onUnpinReview={handleUnpinReview}
                  onEditReview={isOwnProfile ? handleEditReview : undefined}
                  onOpenReorder={() => setShowReorderModal(true)}
                />
              )}

              {activeTab === 'lists' && (
                <ListsTab
                  lists={sortedLists}
                  isOwnProfile={isOwnProfile}
                  displayName={profile.displayName || profile.username || ''}
                  onTapList={(id) => navigate(`/list/${id}`)}
                  onCreateList={() => setShowCreateListModal(true)}
                  authorUsername={profile.username || profile.displayName || ''}
                  authorAvatarUrl={avatarDisplay}
                  authorAvatarFallback={defaultAvatar}
                  onPinList={isOwnProfile ? handlePinList : undefined}
                  onUnpinList={isOwnProfile ? handleUnpinList : undefined}
                />
              )}

              {activeTab === 'diary' && (
                <DiaryTab
                  entries={journalEntries}
                  onEntryClick={(entryId) => navigate(`/journal/${entryId}`)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ═════════════════════════════════════════════════════════
            MODALS
            ═════════════════════════════════════════════════════════ */}
        <EditProfileModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          profile={profile}
          onUpdate={handleProfileUpdate}
        />

        <BioEditModal
          isOpen={showBioSheet}
          onClose={() => setShowBioSheet(false)}
          currentBio={profile?.bio || ''}
          onSave={handleSaveBio}
        />

        <SortSheet
          isOpen={showSortSheet}
          onClose={() => setShowSortSheet(false)}
          value={activeTab === 'lists' ? activeSort.lists : activeSort.reviews}
          onApply={handleSortApply}
        />

        <CreateListModal
          isOpen={showCreateListModal}
          onClose={() => setShowCreateListModal(false)}
          onCreate={handleCreateList}
        />

        <ReorderPinsModal
          isOpen={showReorderModal}
          onClose={() => setShowReorderModal(false)}
          pins={pinnedRows.map((p) => ({
            review_id: p.review.id,
            gameName: p.review.game_title || 'Untitled',
            coverUrl: p.review.game_image || '',
            title: null,
          }))}
          onSave={handleReorderPins}
        />

        <FavoritesPickerSheet
          isOpen={showFavPickerSheet}
          initialFavorites={profile?.favoriteGames || []}
          onSave={handleSaveFavorites}
          onClose={() => setShowFavPickerSheet(false)}
        />

        <GamePickerSheet
          isOpen={showGamePickerSheet}
          onSelect={(game) => {
            setShowGamePickerSheet(false)
            navigate(`/review/new?gameId=${game.id}`, { state: { game } })
          }}
          onCancel={() => setShowGamePickerSheet(false)}
        />

        {/* Sprint 7 — Block confirmation sheet (other-user profile only).
            On confirm we INSERT into blocked_users via blockService and
            navigate the viewer back so they don't keep looking at the
            blocked person's profile. */}
        <ActionSheet
          isOpen={blockSheetOpen}
          onClose={() => setBlockSheetOpen(false)}
          title={`Block ${profile.username || profile.displayName || 'user'}? They won't be able to see your profile, message you, or interact with your content.`}
          items={[
            {
              label: blockPending
                ? 'Blocking…'
                : `Block ${profile.username || profile.displayName || 'user'}`,
              destructive: true,
              disabled: blockPending,
              onClick: async () => {
                if (!targetUserId || isOwnProfile) return
                setBlockPending(true)
                try {
                  await blockUser(targetUserId)
                  showToast('User blocked.', 'success')
                  navigate(-1)
                } catch (err) {
                  console.error('[profile] block failed:', err)
                  showToast(err?.message || 'Could not block user.', 'error')
                } finally {
                  setBlockPending(false)
                }
              },
            },
          ]}
        />

        {/* Sprint 8 — Report profile sheet (other-user profile only). */}
        <ReportSheet
          isOpen={reportProfileOpen}
          onClose={() => setReportProfileOpen(false)}
          contentType="profile"
          contentId={targetUserId}
        />

        {/* Yearly challenge — set / edit goal sheet (own profile only). */}
        {isOwnProfile && (
          <SetGoalSheet
            isOpen={goalSheetOpen}
            onClose={() => setGoalSheetOpen(false)}
            onSave={async (target) => {
              if (!user?.id) return
              await setGoal(user.id, goalProgress.year, target)
              const updated = await getGoalProgress(user.id, goalProgress.year)
              if (updated) setGoalProgress(updated)
            }}
            year={goalProgress.year}
            current={goalProgress.target ?? 0}
          />
        )}
      </div>
    </SharedCoverScope>
  )
}

/* ============================================================
   ── Home tab
   ============================================================ */

function HomeTab({
  favoriteGames,
  activities,
  gameImageMap,
  userIdentifier,
  onGameClick,
  onActivityChevron,
  user,
  isOwnProfile,
  onEditFavorites,
  recentReviews,
  pinnedLists,
  onReviewsChevron,
  onListsChevron,
  allReviews,
  onReviewTap,
  goalProgress,
  streakData,
  onSetGoal,
}) {
  // Earned milestone badges: milestones where isMilestoneSeen = true AND longest_streak >= milestone
  const earnedMilestones = isOwnProfile && user?.id && streakData
    ? MILESTONES.filter(
        (m) => (streakData.longest_streak ?? 0) >= m && isMilestoneSeen(user.id, m)
      )
    : []

  return (
    <div className="profile-home">
      {/* Yearly Challenge — compact ring + milestone badge strip (own profile) */}
      {isOwnProfile && goalProgress && (
        <section className="profile-home__section profile-challenge-section">
          <div className="profile-home__section-header">
            <h3 className="profile-home__section-title">
              {goalProgress.year} Challenge
            </h3>
          </div>
          <div className="profile-challenge-row">
            <GoalRing
              current={goalProgress.current}
              target={goalProgress.target}
              year={goalProgress.year}
              variant="full"
              onSet={onSetGoal}
            />
            <div className="profile-challenge-info">
              {goalProgress.hasGoal ? (
                <>
                  <p className="profile-challenge-headline">
                    {goalProgress.current >= goalProgress.target
                      ? 'Goal reached!'
                      : `${goalProgress.target - goalProgress.current} to go`}
                  </p>
                  <p className="profile-challenge-sub">
                    {goalProgress.current} of {goalProgress.target} games finished
                  </p>
                  <button
                    type="button"
                    className="profile-challenge-edit"
                    onClick={onSetGoal}
                    aria-label="Edit yearly goal"
                  >
                    Edit goal
                  </button>
                </>
              ) : (
                <>
                  <p className="profile-challenge-headline">No goal set</p>
                  <p className="profile-challenge-sub">
                    Set a target for how many games you want to finish in {goalProgress.year}.
                  </p>
                  <button
                    type="button"
                    className="profile-challenge-edit"
                    onClick={onSetGoal}
                    aria-label={`Set a ${goalProgress.year} goal`}
                  >
                    Set goal
                  </button>
                </>
              )}
              {/* Streak milestone badges — quiet, earned-only */}
              {earnedMilestones.length > 0 && (
                <div className="profile-milestone-badges" aria-label="Streak milestones earned">
                  {earnedMilestones.map((m) => (
                    <span
                      key={m}
                      className="profile-milestone-badge"
                      title={`${m}-day streak milestone`}
                      aria-label={`${m}-day streak`}
                    >
                      🔥{m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Section 1 — Favorite Games (hidden when empty on others' profiles;
          own profile shows empty state with an edit affordance) */}
      {(favoriteGames.length > 0 || isOwnProfile) && (
        <section className="profile-home__section">
          <div className="profile-home__section-header">
            <h3 className="profile-home__section-title">Favorite Games</h3>
            {isOwnProfile && (
              <button
                type="button"
                className="profile-home__edit-btn"
                onClick={onEditFavorites}
                aria-label="Edit favorite games"
              >
                Edit
              </button>
            )}
          </div>
          {favoriteGames.length === 0 ? (
            <button
              type="button"
              className="profile-home__fav-empty-cta"
              onClick={onEditFavorites}
              aria-label="Add favorite games"
            >
              + Add favorite games
            </button>
          ) : (
            <div className="profile-favorites-row" role="list">
              {favoriteGames.slice(0, 4).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="listitem"
                  className="profile-favorite-card"
                  onClick={() => onGameClick(g.id, g.image)}
                >
                  <div className="profile-favorite-card__cover">
                    {g.image ? (
                      <SharedCover gameId={g.id} imageSrc={g.image}>
                        <img src={g.image} alt={g.title} loading="lazy" />
                      </SharedCover>
                    ) : (
                      <span className="profile-favorite-card__fallback">
                        {g.title?.charAt(0) || '?'}
                      </span>
                    )}
                  </div>
                  <span className="profile-favorite-card__name">{g.title}</span>
                  {g.developer && (
                    <span className="profile-favorite-card__dev">
                      {g.developer}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Section 2 — Recent Activity: horizontal scroll rail of the
          user's most recent reviews/ratings, each as a cover tile with
          star rating. Hidden entirely when the user has no reviews;
          chevron routes to the Reviews tab. */}
      <ProfileReviewsShelf
        reviews={recentReviews}
        onSeeAll={onReviewsChevron}
      />

      {/* Section 3 — Badges (Sprint 5 P9). BadgesRow owns its own
          section header + chevron so it can disappear entirely when
          there are zero earned + zero in-progress badges (it returns
          null in that case). Wrapping it in a bare <section> here
          would leave an empty container in the DOM. */}
      <BadgesRow user={user} username={userIdentifier} />

      {/* Section 4 — Pinned Lists. Hidden entirely when the user has no
          pinned lists; chevron routes to the Lists tab. */}
      <PinnedListsSection
        pinnedLists={pinnedLists}
        onSeeAll={onListsChevron}
      />

      {/* Section 5 — Ratings distribution. Hidden entirely when the
          user has zero reviews (ProfileRatingsChart returns null). */}
      <ProfileRatingsChart
        reviews={allReviews}
        onReviewTap={onReviewTap}
      />

      {/* Living Activity Timeline — grouped by day, reactions, milestones */}
      <ActivityTimeline
        activities={activities}
        gameImageMap={gameImageMap}
        isOwnProfile={isOwnProfile}
        onSeeAll={onActivityChevron}
      />
    </div>
  )
}

/* ============================================================
   ── Reviews tab
   ============================================================ */

function ReviewsTab({
  reviews,
  pinnedRows,
  likeCounts,
  commentCounts,
  hasMore,
  sentinelRef,
  isOwnProfile,
  displayName,
  onWriteReview,
  currentUserId,
  onPinReview,
  onUnpinReview,
  onEditReview,
  onOpenReorder,
}) {
  const hasPins = pinnedRows.length > 0

  if (!hasPins && reviews.length === 0) {
    return (
      <div className="profile-reviews">
        <div className="profile-empty">
          {isOwnProfile ? (
            <EmptyState
              icon={PenLine}
              title="No reviews yet."
              body="Share what you think about the games you've played."
              cta="Write a review"
              onCta={onWriteReview}
            />
          ) : (
            <EmptyState
              icon={PenLine}
              title={`${displayName || 'They'} hasn't reviewed anything yet.`}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="profile-reviews">
      {/* Sprint 6 P3 — Pinned section. Appears above the divider when
          the profile has at least one pinned review. Reorder kebab is
          only shown to the profile owner with 2+ pins. */}
      {hasPins && (
        <>
          <section className="profile-pinned" aria-label="Pinned reviews">
            <div className="profile-pinned__header">
              <h3 className="profile-pinned__title">
                <LuPin size={16} aria-hidden="true" />
                <span>Pinned</span>
              </h3>
              {isOwnProfile && pinnedRows.length >= 2 && (
                <button
                  type="button"
                  className="profile-pinned__reorder"
                  onClick={onOpenReorder}
                  aria-label="Reorder pinned reviews"
                >
                  <LuArrowUpDown size={16} aria-hidden="true" />
                  <span>Reorder</span>
                </button>
              )}
            </div>
            <div className="profile-reviews__list">
              {pinnedRows.map(({ review: row }) => {
                const own = currentUserId && row.user_id === currentUserId
                return (
                  <ReviewCard
                    key={row.id}
                    review={rowToReviewCard(row, likeCounts, commentCounts)}
                    variant="default"
                    showOwnPill={!!own}
                    isOwn={!!own}
                    isPinned
                    onEdit={own ? onEditReview : undefined}
                    onUnpin={own ? () => onUnpinReview(row.id) : undefined}
                  />
                )
              })}
            </div>
          </section>
          <div className="profile-pinned__divider" aria-hidden="true" />
        </>
      )}

      <div className="profile-reviews__list">
        {reviews.map((row) => {
          const own = currentUserId && row.user_id === currentUserId
          return (
            <ReviewCard
              key={row.id}
              review={rowToReviewCard(row, likeCounts, commentCounts)}
              variant="default"
              showOwnPill={!!own}
              isOwn={!!own}
              isPinned={false}
              onEdit={own ? onEditReview : undefined}
              onPin={own ? () => onPinReview(row) : undefined}
            />
          )
        })}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="profile-reviews__sentinel" aria-hidden="true" />
      )}
    </div>
  )
}

/* ============================================================
   ── Lists tab
   ============================================================ */

function ListsTab({
  lists,
  isOwnProfile,
  displayName,
  onTapList,
  onCreateList,
  authorUsername,
  authorAvatarUrl,
  authorAvatarFallback,
  onPinList,
  onUnpinList,
}) {
  if (lists.length === 0) {
    return (
      <div className="profile-lists">
        <div className="profile-empty">
          {isOwnProfile ? (
            <EmptyState
              icon={List}
              title="No lists yet."
              body="Create themed collections — cozy games, RPGs, anything."
              cta="Create your first list"
              onCta={onCreateList}
            />
          ) : (
            <EmptyState
              icon={List}
              title={`${displayName || 'They'} hasn't made any lists.`}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="profile-lists">
      <ul className="profile-lists__stack" role="list">
        {lists.map((list) => (
          <li key={list.id}>
            <ListRow
              list={list}
              onTap={() => onTapList(list.id)}
              authorUsername={authorUsername}
              authorAvatarUrl={authorAvatarUrl}
              authorAvatarFallback={authorAvatarFallback}
              isOwnProfile={isOwnProfile}
              onPin={onPinList ? () => onPinList(list) : undefined}
              onUnpin={onUnpinList ? () => onUnpinList(list.id) : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/* List row matches Musicboard reference image #2: 6-cover horizontal
   mosaic strip on top, then list name (bold), description (1 line),
   author row, and a like/comment/share row at the bottom.
   Pin/unpin button appears in the meta row for the list owner. */
function ListRow({
  list,
  onTap,
  authorUsername,
  authorAvatarUrl,
  authorAvatarFallback,
  isOwnProfile,
  onPin,
  onUnpin,
}) {
  const slots = Array.from({ length: 6 }, (_, i) => list.previewGames?.[i] || null)
  const mosaicAlt = slots.filter(Boolean).length > 0
    ? `${list.name} — covers of ${slots.filter(Boolean).map((g) => g.title).filter(Boolean).join(', ')}`
    : `${list.name} cover`

  return (
    <article className="profile-list-row" onClick={onTap}>
      {list.coverImageUrl ? (
        <div className="profile-list-row__mosaic profile-list-row__mosaic--custom-cover">
          <img
            src={list.coverImageUrl}
            alt={`${list.name} cover`}
            className="profile-list-row__cover-img"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="profile-list-row__mosaic" role="img" aria-label={mosaicAlt}>
          {slots.map((g, idx) => (
            <div
              key={g?.id || `empty-${idx}`}
              className={`profile-list-row__cell${g ? '' : ' profile-list-row__cell--empty'}`}
            >
              {g?.image ? (
                <img src={g.image} alt="" loading="lazy" />
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="profile-list-row__body">
        <h3 className="profile-list-row__name">{list.name}</h3>
        {list.description && (
          <p className="profile-list-row__desc">{list.description}</p>
        )}

        <div className="profile-list-row__author">
          {authorAvatarUrl ? (
            <img
              src={authorAvatarUrl}
              alt=""
              className="profile-list-row__author-avatar"
              loading="lazy"
            />
          ) : (
            <span
              className="profile-list-row__author-avatar profile-list-row__author-avatar--fallback"
              style={{ backgroundColor: authorAvatarFallback?.color }}
            >
              {authorAvatarFallback?.initials || ''}
            </span>
          )}
          <span className="profile-list-row__author-name">
            {authorUsername || 'you'}
          </span>
        </div>

        <div className="profile-list-row__meta">
          <span className="profile-list-row__meta-item">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {list.likeCount || 0}
          </span>
          <span className="profile-list-row__meta-item">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {list.commentCount || 0}
          </span>
          <span className="profile-list-row__meta-item profile-list-row__meta-item--share" aria-hidden="true">
            <LuShare2 size={14} />
          </span>

          {/* Pin / Unpin affordance — owner only */}
          {isOwnProfile && (list.isPinned ? (
            <button
              type="button"
              className="profile-list-row__pin-btn profile-list-row__pin-btn--active"
              onClick={(e) => { e.stopPropagation(); onUnpin?.() }}
              aria-label="Unpin list from profile"
              title="Unpin"
            >
              <LuPin size={14} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="profile-list-row__pin-btn"
              onClick={(e) => { e.stopPropagation(); onPin?.() }}
              aria-label="Pin list to profile"
              title="Pin to profile"
            >
              <LuPin size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}

/* ============================================================
   ── Diary tab
   All journal entries for this user, across all games, newest first.
   Each row = game cover + title + date + snippet, tappable to game detail.
   Hides cleanly (empty state) when there are no entries.
   ============================================================ */

function DiaryTab({ entries, onEntryClick }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="profile-diary">
        <div className="profile-diary__empty">
          <p className="profile-diary__empty-text">No journal entries yet.</p>
          <p className="profile-diary__empty-sub">
            Add dated notes from a game's page as you play.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="profile-diary">
      <ul className="profile-diary__list" aria-label="Diary">
        {entries.map((entry) => (
          <li key={entry.id} className="profile-diary__row">
            <button
              type="button"
              className="profile-diary__row-btn"
              onClick={() => onEntryClick(entry.id)}
              aria-label={`Open journal entry: ${entry.title || entry.game_title || 'entry'}`}
            >
              {entry.game_image ? (
                <img
                  src={entry.game_image}
                  alt={entry.game_title || ''}
                  className="profile-diary__cover"
                />
              ) : (
                <div className="profile-diary__cover profile-diary__cover--placeholder" aria-hidden="true" />
              )}
              <div className="profile-diary__meta">
                <p className="profile-diary__game-title">
                  {entry.game_title || 'Unknown game'}
                </p>
                {entry.title && (
                  <p className="profile-diary__entry-title">{entry.title}</p>
                )}
                <time
                  className="profile-diary__date"
                  dateTime={entry.created_at}
                  title={new Date(entry.created_at).toLocaleString()}
                >
                  {formatDiaryDate(entry.created_at)}
                </time>
                {entry.is_spoiler ? (
                  <p className="profile-diary__snippet profile-diary__snippet--spoiler">
                    [spoiler]
                  </p>
                ) : entry.body ? (
                  <p className="profile-diary__snippet">
                    {entry.body.slice(0, 100)}{entry.body.length > 100 ? '…' : ''}
                  </p>
                ) : null}
              </div>
              <svg
                className="profile-diary__chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatDiaryDate(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default Profile
