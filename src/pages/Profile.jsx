import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  LuChevronLeft,
  LuChevronRight,
  LuCheck,
  LuShare2,
  LuPin,
  LuPinOff,
  LuArrowUpDown,
  LuUserPen,
  LuSparkles,
  LuMessageCircle,
  LuLink,
  LuUserX,
  LuFlag,
} from 'react-icons/lu'
import {
  HiOutlineHeart,
  HiHeart,
  HiOutlineChat,
  HiDotsVertical,
  HiOutlinePencil,
} from 'react-icons/hi'
import { PenLine, List, Plus } from 'lucide-react'
import {
  FaInstagram,
  FaXTwitter,
  FaYoutube,
  FaTiktok,
} from 'react-icons/fa6'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadMessages } from '../contexts/UnreadMessagesContext'
import { useSession } from '../contexts/SessionContext'
import { usePresence } from '../hooks/usePresence'
import { getSettings } from '../services/userSettingsService'
import { getReviewsForUser } from '../services/reviewService'
import {
  getListsForUser,
  getPinnedListsForUser,
  pinList as pinListSvc,
  unpinList as unpinListSvc,
  LIST_PIN_CHANGED_EVENT,
} from '../services/listService'
import { getProfile, initializeProfile, updateProfile } from '../services/profileService'
import { getTrackedGamesCountForUser } from '../services/statsService'
import { getGoalProgress, setGoal, getRivalryData } from '../services/goalService'
import { getTotalHoursForUser } from '../services/hoursService'
import { getUserByUsername, getUserById, updateUserProfile } from '../services/userService'
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
import { SHARE_LINKS_ENABLED, siteLink } from '../config/site'
import { hapticImpact } from '../utils/haptics'
import { shouldShowCount } from '../utils/formatSocialCount'
import { formatActivityDate } from '../utils/formatActivityDate'
import { shareCard } from '../services/share'
import { compileWrappedSummary } from '../services/dnaService'
import { fetchUserBannerUrl } from '../services/storageService'
import { blockUser } from '../services/blockService'
import ActionSheet from '../components/ActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import SettingsSheet from '../components/SettingsSheet'
import ReportSheet from '../components/ReportSheet'
import EditProfileModal from '../components/EditProfileModal'
import CreateListModal from '../components/CreateListModal'
import FavoritesPickerSheet from '../components/FavoritesPickerSheet'
import GamePickerSheet from '../components/GamePickerSheet'
import GoalRing from '../components/GoalRing'
import ChallengeCard from '../components/ChallengeCard'
import SetGoalSheet from '../components/SetGoalSheet'
import StarRatingDisplay from '../components/StarRatingDisplay'
import Pressable from '../components/Pressable'
import { useLikeState, publishLikeState } from '../hooks/useLikeState'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { likeReview, unlikeReview } from '../services/likeService'
import { getSizedImageUrl } from '../services/imageUtils'
import { COVER_FALLBACK } from '../utils/coverFallback'
import EmptyState from '../components/EmptyState'
import FavoriteGamesRow from '../components/FavoriteGamesRow'
import ReorderPinsModal from '../components/ReorderPinsModal'
import SortSheet from '../components/SortSheet'
import BioEditModal from '../components/BioEditModal'
import ProfileTasteMatchBanner from '../components/ProfileTasteMatchBanner'
import { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { createList, addGameToList } from '../services/listService'
import { showToast } from '../components/Toast'
import ProfilePlayerCard from '../components/ProfilePlayerCard'
import ProfileRatingsChart, { MIN_RATINGS_FOR_CHART } from '../components/ProfileRatingsChart'
import ProfileTasteDNA from '../components/ProfileTasteDNA'
import ReservedSlot from '../components/ReservedSlot'
import BadgesRow from '../components/BadgesRow'
import { getJournalEntriesForUser, getMoodMeta } from '../services/journalService'
import OnThisDaySection from '../components/OnThisDaySection'
import Skeleton from '../components/Skeleton'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { getSWR, mutateSWR, peekSWR } from '../services/swrCache'
import { useCachedResource } from '../hooks/useCachedResource'
import { qaBestKey, qaUserBestCount } from '../services/qaService'
import { canMessageUser } from '../services/messageService'
import { getGameNavStub } from '../utils/gameNavStub'
import './Profile.css'

/* ============================================================
   fetchWithTimeout — resolves to `fallback` after `ms` ms rather than
   hanging forever. Never rejects, so a single timed-out call can't abort
   the whole Promise.all on Profile load. Use for every Supabase read on
   this page so a stalled mobile connection always clears the loading state.
   ============================================================ */

const PROFILE_TIMEOUT_MS = 10_000

// Valid values for the `?tab=` query param — see the `activeTab` /
// `setActiveTab` definitions below for why the active tab lives in the
// URL instead of component state.
const PROFILE_TAB_IDS = new Set(['home', 'reviews', 'lists', 'diary'])

// How long a profile's fetched bundle (reviews/lists/activities/pins/
// goal/journal/rivalry/like+comment counts) is served from the shared
// swrCache without re-hitting the network. Short enough that a genuinely
// stale profile (e.g. someone else posted while you were browsing)
// resolves quickly, long enough that Home -> Profile -> back -> Profile
// doesn't re-run all ~28-35 queries from scratch.
const PROFILE_CACHE_TTL_MS = 45 * 1000

function safeWithTimeout(promise, fallback, ms = PROFILE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// getGoalProgress() resolving to null (no goal row, or a timed-out
// safeWithTimeout) reads as "still resolving" to the UI, which parks the
// GoalRing on a skeleton forever. Settle it on the same "no goal set"
// shape either way. Shared between the peekSWR seed and the live fetch.
function normalizeGoalProgress(gp) {
  return (
    gp || {
      hasGoal: false,
      target: null,
      current: 0,
      year: new Date().getFullYear(),
      percent: 0,
      tier: 1,
      tierBase: 0,
      goalReachedAt: null,
    }
  )
}

// Shape raw getListsForUser() rows into what customLists state actually
// stores. Shared between the peekSWR seed and the live fetch below so the
// two never drift out of sync with each other.
function mapProfileLists(lists) {
  return (lists || []).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description || '',
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    gameCount: l.gameCount,
    previewGames: l.previewGames || [],
    games: l.games || [],
    coverImageUrl: l.coverImageUrl || null,
    isPinned: !!l.isPinned,
    likeCount: 0,
    commentCount: 0,
  }))
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
   V4-06 — Profile Reviews tab helpers
   ============================================================ */

const REVIEW_VIBE_LABELS = {
  masterpiece: 'Masterpiece',
  underrated:  'Underrated',
  mid:         'Mid',
  rage_quit:   'Rage Quit',
  comfort:     'Comfort',
}

function reviewHasText(row) {
  return !!(row?.body || '').trim()
}

/** Keep the newest row per (user_id, igdb_game_id). */
function dedupeReviewsByGame(reviews) {
  const byGame = new Map()
  for (const row of reviews || []) {
    if (row.igdb_game_id == null) continue
    const key = `${row.user_id}:${row.igdb_game_id}`
    const prev = byGame.get(key)
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      byGame.set(key, row)
    }
  }
  return Array.from(byGame.values())
}

function profileReviewGameStub(row) {
  return {
    id: String(row.igdb_game_id || ''),
    title: row.game_title || 'Unknown Game',
    image: row.game_image || '',
  }
}

/** ReviewCard-shaped object for the edit-review composer. */
function rowToEditShape(row) {
  return {
    id: row.id,
    game: {
      id: String(row.igdb_game_id || ''),
      name: row.game_title || '',
      coverUrl: row.game_image || '',
    },
    body: row.body || '',
    rating: Number(row.rating) || 0,
    hoursPlayed: Number(row.hours_played) || 0,
    liked: !!row.liked,
    hasSpoilers: !!row.has_spoilers,
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
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
   Favorite games — cover slots on the Home tab. Matches
   FavoritesPickerSheet's maxItems so the row can always show one
   add-slot until the picker itself is full.
   ============================================================ */

const MAX_FAVORITE_SLOTS = 4

/* ============================================================
   Main component
   ============================================================ */

function handleCacheKey(username) {
  const decoded = decodeURIComponent(username || '').trim().toLowerCase()
  if (!decoded) return null
  return `profile:handle:${decoded}`
}

function peekVisitorHandle(username) {
  const key = handleCacheKey(username)
  if (!key) return undefined
  const row = peekSWR(key)
  return row?.id ? row : undefined
}

function profileBlobFromPublicRow(row) {
  return {
    displayName: row.display_name || row.username || '',
    username: row.username || '',
    avatarUrl: row.avatar_url || null,
    bio: row.bio || '',
    bannerUrl: null,
    socialLinks: {},
    favoriteGames: Array.isArray(row.favorite_games) ? row.favorite_games : [],
    currentObsessions: Array.isArray(row.current_obsessions) ? row.current_obsessions : [],
    currentlyPlayingGame: null,
    plusActive: row.plus_active === true,
  }
}

function Profile() {
  const navigate = useNavigate()
  const location = useLocation()
  const { username: paramUsername, userId: paramUserId } = useParams()
  const { user, plusActive: ownPlusActive } = useAuth()
  const { unreadCount } = useUnreadMessages()
  const { session: activeSession } = useSession()
  const { enabled: presenceEnabled, playingNow } = usePresence()
  // Drives the unread dot on the profile-header Messages entry point —
  // same count/token as the Profile bottom-nav tab dot (BottomNav.jsx).
  // ── Username → userId resolution ───────────────────────────────────────
  // When arriving via /user/:username we must look up the UUID before we
  // can fetch Supabase data. `resolvedUser` carries the raw Supabase row
  // ({ id, username, display_name, avatar_url, bio }) for other-user
  // profiles, or null when it's the signed-in user's own profile.
  // `userNotFound` is set true when the lookup returns no row.
  const seededVisitor = paramUsername ? peekVisitorHandle(paramUsername) : undefined
  const seededIsSelf = !!(user?.id && seededVisitor?.id === user.id)
  const [resolvedUser, setResolvedUser] = useState(() =>
    seededVisitor && !seededIsSelf ? seededVisitor : null
  )
  // Resolving when either param is present and we have nothing cached.
  const [resolving, setResolving] = useState(() => {
    if (!paramUsername && !paramUserId) return false
    if (seededVisitor) return false
    return true
  })
  const [userNotFound, setUserNotFound] = useState(false)

  // Tracks which route param `resolvedUser` / `userNotFound` currently
  // reflect. Needed because navigating directly between two OTHER
  // users' profiles (e.g. tapping a link from user A's profile to user
  // B's) changes `paramUsername`/`paramUserId` synchronously on render,
  // but `resolvedUser` still holds user A's row until the effect below
  // re-runs and its (async) lookup resolves. Without this guard, the
  // render(s) in between would read `resolvedUser` (A's row) as if it
  // were B's — i.e. the wrong profile's data, momentarily. See
  // `resolvedMatchesParams` below.
  const resolvedForKeyRef = useRef(
    seededVisitor
      ? `username:${decodeURIComponent(paramUsername).toLowerCase()}`
      : !paramUsername && !paramUserId
        ? 'self'
        : null
  )

  useEffect(() => {
    // No param → own profile.
    if (!paramUsername && !paramUserId) {
      resolvedForKeyRef.current = 'self'
      setResolvedUser(null)
      setResolving(false)
      setUserNotFound(false)
      return
    }
    let cancelled = false
    const warmHandle = paramUsername ? peekVisitorHandle(paramUsername) : undefined
    if (!warmHandle) setResolving(true)
    setUserNotFound(false)

    // /user/id/:userId route — look up by UUID directly.
    if (paramUserId) {
      const decodedId = decodeURIComponent(paramUserId)
      const key = `id:${decodedId}`
      // Fast-path: own userId.
      if (user?.id && user.id === decodedId) {
        if (!cancelled) { resolvedForKeyRef.current = key; setResolvedUser(null); setResolving(false) }
        return
      }
      safeWithTimeout(getUserById(decodedId), null, 8_000)
        .then((row) => {
          if (cancelled) return
          resolvedForKeyRef.current = key
          if (!row) {
            setUserNotFound(true)
            setResolvedUser(null)
          } else {
            setResolvedUser(row)
            setUserNotFound(false)
            if (row.username) mutateSWR(handleCacheKey(row.username), row)
          }
        })
        .catch(() => {
          if (!cancelled) { resolvedForKeyRef.current = key; setUserNotFound(true); setResolvedUser(null) }
        })
        .finally(() => { if (!cancelled) setResolving(false) })
      return () => { cancelled = true }
    }

    // /user/:username route.
    const decoded = decodeURIComponent(paramUsername)
    const key = `username:${decoded.toLowerCase()}`
    // Fast-path: check against the signed-in user's own username so we
    // don't make a Supabase round-trip just to land on own profile.
    const localProfile = getProfile()
    const ownUsername = (localProfile?.username || '').trim()
    if (ownUsername && ownUsername.toLowerCase() === decoded.toLowerCase()) {
      if (!cancelled) { resolvedForKeyRef.current = key; setResolvedUser(null); setResolving(false) }
      return
    }
    // 8-second timeout so a stalled connection doesn't leave resolving=true
    // (skeleton visible) forever. A cached handle is returned immediately
    // and revalidated behind the hero; a timeout with nothing cached
    // resolves to null, which the branch below treats as not found.
    const cacheKey = handleCacheKey(decoded)
    safeWithTimeout(
      getSWR(cacheKey, async () => {
        const row = await getUserByUsername(decoded)
        if (!row?.id) {
          const missing = new Error('profile not found')
          missing.code = 'NOT_FOUND'
          throw missing
        }
        return row
      }, { ttlMs: 60_000 }),
      warmHandle || null,
      8_000
    )
      .then((row) => {
        if (cancelled) return
        resolvedForKeyRef.current = key
        if (row?.id) {
          const isSelf = !!(user?.id && row.id === user.id)
          setResolvedUser(isSelf ? null : row)
          setUserNotFound(false)
        } else if (!warmHandle) {
          setUserNotFound(true)
          setResolvedUser(null)
        }
      })
      .catch(() => {
        if (!cancelled && !warmHandle) {
          resolvedForKeyRef.current = key
          setUserNotFound(true)
          setResolvedUser(null)
        }
      })
      .finally(() => { if (!cancelled) setResolving(false) })
    return () => { cancelled = true }
  }, [paramUsername, paramUserId, user?.id])

  // The param key for THIS render — compared against resolvedForKeyRef
  // (stamped by the effect above) to detect a stale resolvedUser from a
  // previously-viewed profile that hasn't been superseded yet.
  const paramKey = paramUserId
    ? `id:${decodeURIComponent(paramUserId)}`
    : paramUsername
      ? `username:${decodeURIComponent(paramUsername).toLowerCase()}`
      : 'self'
  const resolvedMatchesParams = resolvedForKeyRef.current === paramKey

  // /profile (no param) is always the signed-in user.
  // /user/:username is own profile when the username matches.
  // /user/id/:userId is own profile when the UUID matches.
  const isOwnProfile =
    paramKey === 'self' ||
    (!resolving && resolvedMatchesParams && resolvedUser === null && !userNotFound)

  // ── profileUserId: single source of truth for every profile-scoped
  // read (Reviews, Diary, Lists, Home stats/sections) ─────────────────
  // MUST NEVER fall back to the signed-in session user id while we're
  // viewing (or still resolving) someone else's profile — `resolvedUser`
  // is only trustworthy once `resolvedMatchesParams` confirms it was
  // resolved for the CURRENT route param. Falling back to `user?.id`
  // here (the old behaviour) meant every profile-scoped fetch ran with
  // the SESSION user's id for the entire duration of the username/id
  // lookup, which is exactly what caused Reviews/Diary/Lists to briefly
  // (or, on a slow connection, not so briefly) render the logged-in
  // user's rows on another user's profile. Session user id is only
  // valid for isOwnProfile checks and mutations (follow, edit, pin,
  // goal) — never for reading profile content.
  const targetUserId = isOwnProfile
    ? (user?.id ?? null)
    : (resolvedMatchesParams ? (resolvedUser?.id ?? null) : null)

  // Warm-cache seed for every piece of profile-scoped state below — same
  // peekSWR pattern ListDetail/GameDetail already use, applied to the one
  // bundle fetch this page makes (see fetchProfileBundle + the getSWR call
  // in loadProfileData further down, both keyed `profile:${targetUserId}`).
  // A cache hit here means a revisit within PROFILE_CACHE_TTL_MS paints
  // real reviews/lists/stats on the very first frame instead of each one
  // individually skeletoning while loadProfileData's mount-effect re-fetch
  // resolves (which itself will be a cache hit too, and just revalidates
  // in the background — see getSWR's stale-while-revalidate semantics).
  const cachedProfileBundle = targetUserId ? peekSWR(`profile:${targetUserId}`) : undefined

  // Local profile blob (display name / avatar / bio / socials / favorites).
  // Lives in localStorage for the signed-in user; for "another user"
  // viewing we'd fetch from Supabase but Sprint 5 only wires the own-
  // profile UX so we still source everything from localStorage here.
  //
  // Seeded synchronously (not left null) for the own-profile case: unlike
  // a visitor profile, which genuinely has to wait on resolving the route
  // param, own-profile data is a synchronous localStorage read that's
  // already sitting there on every visit after the first. Leaving this
  // null until the loadProfileData effect ran was the entire reason your
  // OWN profile showed a full-page hero skeleton on every navigation —
  // see the loading-state gate below, which keys off `profile` being
  // non-null. isOwnProfile is already correct at this point for the
  // plain `/profile` route (paramKey === 'self' needs no async lookup).
  const [profile, setProfile] = useState(() => {
    if (!paramUsername && !paramUserId) return getProfile() || initializeProfile()
    if (seededVisitor && !seededIsSelf) return profileBlobFromPublicRow(seededVisitor)
    if (seededIsSelf) return getProfile() || initializeProfile()
    return isOwnProfile ? (getProfile() || initializeProfile()) : null
  })

  // Route param changed since the last render. Apply a cached visitor
  // (or clear to the skeleton) before paint so we never show user A's
  // hero on user B's URL.
  if (resolvedForKeyRef.current !== paramKey) {
    const nextSeed = paramUsername ? peekVisitorHandle(paramUsername) : undefined
    const nextIsSelf = !!(user?.id && nextSeed?.id === user.id)
    if (!paramUsername && !paramUserId) {
      resolvedForKeyRef.current = 'self'
      setResolvedUser(null)
      setResolving(false)
      setUserNotFound(false)
      setProfile(getProfile() || initializeProfile())
    } else if (nextSeed && !nextIsSelf) {
      resolvedForKeyRef.current = paramKey
      setResolvedUser(nextSeed)
      setResolving(false)
      setUserNotFound(false)
      setProfile(profileBlobFromPublicRow(nextSeed))
    } else if (nextIsSelf) {
      resolvedForKeyRef.current = paramKey
      setResolvedUser(null)
      setResolving(false)
      setUserNotFound(false)
      setProfile(getProfile() || initializeProfile())
    } else {
      resolvedForKeyRef.current = paramKey
      setResolvedUser(null)
      setResolving(true)
      setUserNotFound(false)
      setProfile(null)
    }
  }

  // Tabs: 'home' (default), 'reviews', 'lists', 'diary'.
  //
  // FIX (bug against this file's own prior intent — see App.jsx's
  // AnimatedRoutes docstring, which already says profile tabs are
  // supposed to have their own AnimatePresence and stay unaffected by
  // route-level transitions): this used to call `navigate({ pathname,
  // search }, { replace: true })` on every tab click. React Router mints
  // a brand-new `location.key` on EVERY navigate call, replace or not —
  // and AnimatedRoutes treats any `location.key` change as a real
  // navigation: it remounts this whole component on a fresh route layer
  // and replays the 220ms route-level PageTransition. That's why tab
  // switches looked like full page reloads (resolving flipped back to
  // true, follow state re-fetched, taste vector / on-this-day RPCs
  // re-fired, etc.) and why the tab pane's own 180ms AnimatePresence
  // slide (below) never got a chance to run.
  //
  // `activeTab` is now plain component state — same pattern as
  // Search.jsx's and Library.jsx's tab state — so a click only
  // re-renders this component in place; it never calls `navigate` and
  // never touches `location.key`.
  //
  // The `?tab=` query param is still worth keeping for: (1) deep links /
  // copy-pasting the address bar while on a non-Home tab, (2) surviving
  // a manual page refresh, and (3) restoring the right tab when the user
  // drills into a detail screen (game/review/list) and then taps back —
  // that's a genuine POP navigation, which legitimately remounts this
  // page from scratch, and the fresh mount needs *something* durable to
  // read the tab back from. So this is read ONCE on mount to pick the
  // starting tab, and two-way synced afterwards by writing straight to
  // the address bar with `window.history.replaceState` — bypassing
  // react-router's `navigate` entirely — rather than not syncing it back
  // at all. This is safe here specifically because: the app uses a plain
  // `BrowserRouter`, so react-router's history is backed by the same
  // native History API `replaceState` is mutating; the pathname is never
  // touched, only `?tab=`, so no route match changes; and every other
  // reader of the tab (this component) treats `activeTab` state as the
  // source of truth, not `location.search`, so nothing here depends on
  // react-router's `location` object noticing the change. The one thing
  // this deliberately gives up is `location.search` staying in sync in
  // real time elsewhere in this component (e.g. the one-shot edit-modal
  // effect a bit below, which only ever reads it once on mount before a
  // tab click could happen) — not a concern for that reason, but flagged
  // in case a future edit adds a `location.search` read that fires after
  // a tab switch.
  const [activeTab, setActiveTab] = useState(() => {
    const initialTab = new URLSearchParams(location.search).get('tab')
    return PROFILE_TAB_IDS.has(initialTab) ? initialTab : 'home'
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeTab === 'home') {
      // Keep the default tab out of the URL so plain /profile and
      // /user/:username links stay clean.
      url.searchParams.delete('tab')
    } else {
      url.searchParams.set('tab', activeTab)
    }
    const nextHref = `${url.pathname}${url.search}${url.hash}`
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextHref !== currentHref) {
      // NOT `navigate()` — see the comment above. Replaces the current
      // history entry's URL in place without minting a new
      // `location.key`, so react-router (and therefore AnimatedRoutes)
      // never sees this as a navigation.
      window.history.replaceState(window.history.state, '', nextHref)
    }
  }, [activeTab])

  // Modals / sheets
  const [showEditModal, setShowEditModal] = useState(false)
  const [showBioSheet, setShowBioSheet] = useState(false)
  const [showSortSheet, setShowSortSheet] = useState(false)
  const [showCreateListModal, setShowCreateListModal] = useState(false)
  const [showFavPickerSheet, setShowFavPickerSheet] = useState(false)
  const [showGamePickerSheet, setShowGamePickerSheet] = useState(false)
  // 'idle' | 'generating' — favorites shelf share card
  const [favSharing, setFavSharing] = useState('idle')

  // Header overflow (⋯) bottom sheet — replaces the old inline kebab dropdown
  const [overflowSheetOpen, setOverflowSheetOpen] = useState(false)

  // Wrapped share — 'idle' | 'generating' | 'done'
  const [wrappedSharing, setWrappedSharing] = useState('idle')

  // Sprint 7 — Block confirm sheet (other-user profiles only)
  const [blockSheetOpen, setBlockSheetOpen] = useState(false)
  const [blockPending, setBlockPending] = useState(false)

  // Sprint 8 — Report profile sheet (other-user profiles only)
  const [reportProfileOpen, setReportProfileOpen] = useState(false)

  // Yearly challenge + streak milestones (own profile only).
  // `null` means "not resolved yet" — distinct from a resolved
  // `{ hasGoal: false, ... }`, which means "genuinely no goal set".
  // Rendering must never treat the former as the latter (see GoalRing
  // loading skeleton in HomeTab below) or a real goal flashes as
  // "Set a goal" for a frame on every load.
  const thisYear = new Date().getFullYear()
  const [goalProgress, setGoalProgress] = useState(() =>
    cachedProfileBundle ? normalizeGoalProgress(cachedProfileBundle.gp) : null
  )
  const [goalSheetOpen, setGoalSheetOpen] = useState(false)
  const [rivalryData, setRivalryData] = useState(() => cachedProfileBundle?.rd || [])
  // Supabase-backed "games" stat numeral (see getTrackedGamesCountForUser).
  // `null` means "not resolved yet" so the player card skeletons the
  // numeral instead of flashing a fabricated 0.
  const [trackedGamesCount, setTrackedGamesCount] = useState(() =>
    cachedProfileBundle ? (cachedProfileBundle.trackedGames ?? 0) : null
  )
  // Total hours logged, summed from game_trackers. `null` = not resolved
  // yet, so the player card skeletons the numeral rather than showing 0h.
  const [hoursPlayed, setHoursPlayed] = useState(() =>
    cachedProfileBundle ? cachedProfileBundle.hours : null
  )

  // Bio "more"/"less" expansion. We measure the collapsed paragraph's
  // overflow on layout to decide whether to render the toggle at all
  // — if the bio fits inside the 3-line clamp there's no "more" link.
  const [bioExpanded, setBioExpanded] = useState(false)
  const [bioCanExpand, setBioCanExpand] = useState(false)
  const bioRef = useRef(null)

  // Sort selection — same shape as before so callers downstream still
  // read a `{ reviews, lists }` object.
  const [activeSort, setActiveSort] = useState(readSortFromStorage)

  // Data — every one of these is seeded from cachedProfileBundle when a
  // warm cache entry exists (see cachedProfileBundle above), so a revisit
  // within PROFILE_CACHE_TTL_MS paints real content immediately instead
  // of each stat/section skeletoning individually while loadProfileData's
  // mount effect re-resolves (a cache hit itself, revalidating quietly in
  // the background).
  const [allReviews, setAllReviews] = useState(() => cachedProfileBundle?.rows || [])
  // True until the FIRST loadProfileData() for the current targetUserId
  // resolves. Gates the review-count stat (and anything else derived
  // from allReviews on this render pass) so a loading profile never
  // paints "0 reviews" — only a skeleton or the real, resolved count.
  // Does NOT flip back to true on background refreshes (reviewAdded,
  // storage, etc.) so optimistic updates still paint instantly per the
  // app's optimistic-UI convention. Starts false (not true) on a cache
  // hit — loadedProfileForUserRef below is seeded to match, so the mount
  // effect doesn't immediately flip this back to true and undo the seed.
  const [profileLoading, setProfileLoading] = useState(() => cachedProfileBundle === undefined)
  const loadedProfileForUserRef = useRef(cachedProfileBundle !== undefined ? targetUserId : null)
  const [customLists, setCustomLists] = useState(() => mapProfileLists(cachedProfileBundle?.lists))
  const [activities, setActivities] = useState(() => cachedProfileBundle?.acts || [])
  const [journalEntries, setJournalEntries] = useState(() => cachedProfileBundle?.journalRows || [])
  // Sprint 6 P0 — Map<reviewId, count> fetched once per profile load
  // and re-fetched whenever reviews change. Drives the Most Liked sort
  // and the count rendered on each card. Seeded into useLikeState's
  // shared cache so individual cards skip per-card round-trips.
  const [reviewLikeCounts, setReviewLikeCounts] = useState(
    () => cachedProfileBundle?.counts || new Map()
  )
  // Sprint 6 P1 — real comment counts for every review on this profile,
  // batched in one query alongside the like-count prefetch. Threaded
  // into the ReviewCard adapter so the comment-icon badge matches the
  // actual row count in the comments table.
  const [reviewCommentCounts, setReviewCommentCounts] = useState(
    () => cachedProfileBundle?.cCounts || new Map()
  )

  // Sprint 6 P3 — pinned reviews. Loaded in parallel with the main
  // reviews fetch so the Pinned section renders at the same time as
  // the sorted list below it. Each entry is { position, review } where
  // `review` carries the full row + embedded users join, ready to feed
  // through rowToReviewCard.
  const [pinnedRows, setPinnedRows] = useState(() => cachedProfileBundle?.pins || [])
  const [showReorderModal, setShowReorderModal] = useState(false)

  // Pinned lists (Section B on the Home tab). Loaded in parallel with
  // the main data fetch; ordered by pinned_at DESC, cap 5.
  const [pinnedLists, setPinnedLists] = useState(() => cachedProfileBundle?.pinnedListData || [])

  // ── Follow graph (Sprint 6) ─────────────────────────────────────
  // followersCount is the count shown on the Followers stat numeral.
  // `following` is the state of the Follow / Following toggle on
  // another user's profile (always false on own). `followPending`
  // debounces rapid taps so the optimistic UI doesn't race itself.
  const [followPending, setFollowPending] = useState(false)
  const followKey = targetUserId ? `profile:follows:${targetUserId}` : null
  const loadFollowCounts = useCallback(async () => {
    const [followers, followingCnt, amFollowing] = await Promise.all([
      getFollowerCount(targetUserId),
      getFollowingCount(targetUserId),
      isOwnProfile ? Promise.resolve(false) : fetchIsFollowing(targetUserId),
    ])
    return { followers, following: followingCnt, amFollowing }
  }, [targetUserId, isOwnProfile])
  const {
    data: followData,
    error: followError,
    refresh: refreshFollows,
    mutate: mutateFollows,
  } = useCachedResource(followKey, loadFollowCounts, { enabled: !!targetUserId })
  const followersCount = followData?.followers ?? 0
  const followingCount = followData?.following ?? 0
  const following = followData?.amFollowing ?? false
  // Numerals skeleton only when this profile has never been cached.
  const followLoading = !!targetUserId && followData === undefined && !followError

  // Visitor Message button. Hidden only once can_message_user returns
  // false. A missing RPC (migration not applied yet) resolves true, so
  // the button stays as it is today.
  const canMessageKey =
    !isOwnProfile && targetUserId ? `messages:can:${targetUserId}` : null
  const loadCanMessage = useCallback(
    () => canMessageUser(targetUserId),
    [targetUserId]
  )
  const { data: canMessage } = useCachedResource(canMessageKey, loadCanMessage, {
    enabled: !!canMessageKey,
  })
  const showMessageAction = canMessage !== false

  // Best answers — answers this user's askers picked as best. Same read for
  // the owner and visitors; the line is hidden at 0, while loading, and when
  // the read fails (the service resolves 0 for all three).
  const bestKey = targetUserId ? qaBestKey(targetUserId, 'count') : null
  const loadBestCount = useCallback(() => qaUserBestCount(targetUserId), [targetUserId])
  const { data: bestAnswersData } = useCachedResource(bestKey, loadBestCount, {
    enabled: !!bestKey,
  })
  const bestAnswersCount = Number(bestAnswersData) || 0

  // Sprint 7 — banner URL for non-own profiles fetched from Supabase.
  // Own profile reads bannerUrl directly from the localStorage profile blob.
  const [otherUserBannerUrl, setOtherUserBannerUrl] = useState(null)

  // Reviews tab — infinite scroll. Keep all rows in memory (already
  // sorted above) and reveal them in pages of REVIEWS_PAGE_SIZE.
  const REVIEWS_PAGE_SIZE = 10
  const [reviewsPage, setReviewsPage] = useState(1)
  const reviewsSentinelRef = useRef(null)

  /* ── Data loading ──────────────────────────────────────────────── */

  const loadProfileData = useCallback(async ({ force = false } = {}) => {
    // Only show the loading skeleton on the FIRST fetch for this
    // targetUserId (initial mount, or switching to a different user's
    // profile). Background refreshes fired by reviewAdded/storage/etc.
    // re-run this same function but must not re-arm the skeleton —
    // that would fight the app's optimistic-update convention.
    const isFreshLoadForThisUser = loadedProfileForUserRef.current !== targetUserId
    if (isFreshLoadForThisUser) setProfileLoading(true)

    // Own profile: read display name / avatar / bio from localStorage.
    // Other-user profile: shape an equivalent blob from the Supabase row
    // that was resolved from the URL :username param.
    if (isOwnProfile) {
      const userProfile = getProfile() || initializeProfile()
      setProfile(userProfile)
      // Backfill favorites from Supabase when localStorage is stale.
      if (targetUserId && !(userProfile.favoriteGames || []).length) {
        safeWithTimeout(getUserById(targetUserId), null).then((row) => {
          if (Array.isArray(row?.favorite_games) && row.favorite_games.length > 0) {
            const updated = updateProfile({ favoriteGames: row.favorite_games })
            setProfile(updated)
          }
        })
      }
    } else if (resolvedUser) {
      setProfile({
        displayName: resolvedUser.display_name || resolvedUser.username || '',
        username: resolvedUser.username || '',
        avatarUrl: resolvedUser.avatar_url || null,
        bio: resolvedUser.bio || '',
        bannerUrl: null, // fetched separately below via fetchUserBannerUrl
        socialLinks: {},
        // Sourced from the public `users` row (favorite_games/
        // current_obsessions are readable for any user — see
        // users_select_all RLS) rather than hardcoded empty, so visitor
        // profiles actually show the owner's Favorite Games.
        favoriteGames: Array.isArray(resolvedUser.favorite_games) ? resolvedUser.favorite_games : [],
        currentObsessions: Array.isArray(resolvedUser.current_obsessions) ? resolvedUser.current_obsessions : [],
        currentlyPlayingGame: null,
        plusActive: resolvedUser.plus_active === true,
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
        //
        // The whole bundle (including the like/comment prefetch) is
        // wrapped in the shared swrCache: Profile was re-fetching all
        // ~28-35 queries from scratch on every single mount, even when
        // navigating back to a profile visited seconds earlier. `force`
        // is set to true from mutation-driven refreshes (reviewAdded,
        // pin changes, etc.) below so those still always get fresh data;
        // a plain re-mount within the cache window is what gets to skip
        // the network entirely.
        const fetchProfileBundle = async () => {
          // Likes and comments need the review ids, so they start as soon as
          // reviews + pins resolve and overlap the rest of this bundle
          // instead of waiting until every sibling query has finished.
          const reviewsWithSocial = (async () => {
            const [rows, pins] = await Promise.all([
              safeWithTimeout(getReviewsForUser(targetUserId), []),
              safeWithTimeout(getPinsForUser(targetUserId), []),
            ])
            const idSet = new Set(rows.map((r) => r.id))
            for (const p of pins) {
              if (p.review?.id) idSet.add(p.review.id)
            }
            const ids = Array.from(idSet)
            const [counts, cCounts] = await Promise.all([
              safeWithTimeout(prefetchLikeStatesForReviews(ids), new Map()),
              safeWithTimeout(getCommentCountsForReviews(ids), new Map()),
            ])
            return { rows, pins, counts, cCounts }
          })()

          const [social, lists, acts, pinnedListData, gp, journalRows, rd, trackedGames, hours] = await Promise.all([
            reviewsWithSocial,
            safeWithTimeout(getListsForUser(targetUserId), []),
            safeWithTimeout(getActivitiesForUser(targetUserId, { limit: 8 }), []),
            safeWithTimeout(getPinnedListsForUser(targetUserId), []),
            // Challenge (yearly goal) — fetched for ANY profile now that
            // user_goals RLS is privacy-aware rather than owner-only (see
            // migration profile_visitor_rls_fix). A visitor viewing a
            // private-activity user simply gets back { hasGoal: false }
            // from RLS returning zero rows, which the UI already treats
            // as "no goal set" — no special-casing needed here.
            safeWithTimeout(getGoalProgress(targetUserId, new Date().getFullYear()), null),
            safeWithTimeout(getJournalEntriesForUser(targetUserId, { limit: 50 }), []),
            // Rivalry ("#N in your circle") stays own-profile only — it's
            // framed from the OWNER's follow graph and showing "your
            // circle" data on someone else's profile would be confusing.
            isOwnProfile ? safeWithTimeout(getRivalryData(targetUserId, new Date().getFullYear()), []) : Promise.resolve([]),
            // Games stat — Supabase-backed count from game_trackers, which
            // is publicly readable (trackers_select_all), so own and visitor
            // views read the same real number from the same source.
            safeWithTimeout(getTrackedGamesCountForUser(targetUserId), null),
            // Played-hours stat on the player card. Summed from
            // game_trackers.hours_played for every profile, so own and
            // visitor views read the same number from the same source.
            safeWithTimeout(getTotalHoursForUser(targetUserId), null),
          ])

          return {
            rows: social.rows,
            pins: social.pins,
            counts: social.counts,
            cCounts: social.cCounts,
            lists,
            acts,
            pinnedListData,
            gp,
            journalRows,
            rd,
            trackedGames,
            hours,
          }
        }

        const { rows, lists, acts, pins, pinnedListData, gp, journalRows, rd, trackedGames, hours, counts, cCounts } =
          await getSWR(`profile:${targetUserId}`, fetchProfileBundle, {
            ttlMs: PROFILE_CACHE_TTL_MS,
            force,
          })

        // A null `gp` means safeWithTimeout gave up on the goal query, and
        // the challenge cell reads null as "still resolving" — so leaving it
        // null parked that cell on a skeleton with nothing left to wait for.
        // Settle it on the same shape getGoalProgress returns for a user
        // with no goal row: the cell falls back to its "Set a goal" prompt,
        // which is both the truth for a brand-new account and a live action
        // for anyone whose fetch merely stalled.
        setGoalProgress(normalizeGoalProgress(gp))
        if (rd) setRivalryData(rd)
        setTrackedGamesCount(trackedGames ?? 0)
        setHoursPlayed(hours)
        setAllReviews(rows)
        setPinnedRows(pins)
        setPinnedLists(pinnedListData)
        setCustomLists(mapProfileLists(lists))
        setActivities(acts)
        setJournalEntries(journalRows || [])

        // Sprint 7 — fetch banner URL for other users' profiles.
        // Own profile already has bannerUrl in the localStorage blob.
        if (!isOwnProfile) {
          fetchUserBannerUrl(targetUserId)
            .then((url) => setOtherUserBannerUrl(url || null))
            .catch(() => setOtherUserBannerUrl(null))
        }

        // Like counts + this user's liked-set + comment counts for every
        // review on this profile — fetched as part of fetchProfileBundle
        // above (in parallel with itself) so it's covered by the same
        // cache entry rather than re-firing on every mount regardless of
        // whether the rest of the bundle was a cache hit. Seeds the
        // useLikeState cache too so cards render with filled hearts
        // immediately (no per-card flicker), and the comment badge
        // matches the real Supabase row count rather than 0.
        setReviewLikeCounts(counts)
        setReviewCommentCounts(cCounts)
      } catch (err) {
        console.error('[profile] load failed:', err)
        setAllReviews([])
        setCustomLists([])
        setActivities([])
        setJournalEntries([])
        setReviewLikeCounts(new Map())
        setPinnedRows([])
        setPinnedLists([])
        setGoalProgress(null)
        setRivalryData([])
        setTrackedGamesCount(null)
        setHoursPlayed(null)
      }
      loadedProfileForUserRef.current = targetUserId
      setProfileLoading(false)
    } else {
      // targetUserId is null — either genuinely no session user (signed
      // out on own profile), or we're between route params and the new
      // profileUserId hasn't resolved yet (still resolving, or
      // resolvedUser is stale from a previously-viewed profile). Clear
      // immediately in every case: never let a previous user's rows
      // keep rendering under a new identity.
      setAllReviews([])
      setCustomLists([])
      setActivities([])
      setJournalEntries([])
      setReviewLikeCounts(new Map())
      setPinnedRows([])
      setPinnedLists([])
      setGoalProgress(null)
      setRivalryData([])
      setTrackedGamesCount(null)
      setHoursPlayed(null)
      loadedProfileForUserRef.current = targetUserId
      // Only drop the loading skeleton once we're confident there's
      // nothing pending (own profile, or a fully-settled not-found) —
      // otherwise a slow lookup would flash an empty "0 reviews" state
      // before the real profileUserId resolves.
      if (paramKey === 'self' || (!resolving && resolvedMatchesParams)) {
        setProfileLoading(false)
      }
    }
  }, [targetUserId, isOwnProfile, resolvedUser, resolving, paramKey, resolvedMatchesParams])

  useEffect(() => {
    // Plain mount: cache-aware — a revisit within PROFILE_CACHE_TTL_MS
    // reuses the last fetched bundle instead of re-running every query.
    loadProfileData()
    // Every one of these events means "specific data just changed,
    // don't show something stale" (a review was posted, a pin moved,
    // the app resumed after who-knows-how-long backgrounded, etc.), so
    // they all force a real refetch rather than risking a cache hit.
    const refresh = () => loadProfileData({ force: true })
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
    // The events above only cover changes this device made. On resume the
    // whole profile could have moved on elsewhere — new reviews, new lists,
    // new activity — and the mount call never re-runs by itself.
    window.addEventListener(APP_RESUMED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('reviewAdded', refresh)
      window.removeEventListener('profileUpdated', refresh)
      window.removeEventListener('libraryUpdated', refresh)
      window.removeEventListener('activityUpdated', refresh)
      window.removeEventListener('journalEntryAdded', refresh)
      window.removeEventListener(PIN_CHANGED_EVENT, refresh)
      window.removeEventListener(LIST_PIN_CHANGED_EVENT, refresh)
      window.removeEventListener(APP_RESUMED_EVENT, refresh)
    }
  }, [loadProfileData])

  /* ── Follow graph load + live updates ─────────────────────────── */

  // Loads the follower count + the signed-in user's follow state for
  // this profile. Rebuilt as a callback so the FOLLOW_CHANGED_EVENT
  // listener below can invoke it without re-mounting the effect every
  // render.
  useEffect(() => {
    // Follow counts are the numerals most likely to have moved while the
    // app was backgrounded. The cache already painted the last values;
    // this refresh settles them if they changed.
    const onResume = () => {
      refreshFollows().catch(() => {})
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [refreshFollows])

  // Pull-to-refresh: the same two loads the resume listeners above
  // already run in parallel — loadProfileData force-bypasses the shared
  // swrCache bundle (reviews/lists/activities/pins/goal/journal/etc.),
  // refreshFollows revalidates profile:follows.
  const handlePullToRefresh = useCallback(
    () => Promise.all([loadProfileData({ force: true }), refreshFollows()]),
    [loadProfileData, refreshFollows]
  )

  // /edit-profile still redirects here with openEditModal. Consume that
  // once per history entry. Clearing it with navigate({ replace }) minted
  // a new location.key and remounted this page.
  const consumedEditKeyRef = useRef(null)
  useEffect(() => {
    if (!isOwnProfile) return
    if (!location.state?.openEditModal) return
    if (consumedEditKeyRef.current === location.key) return
    consumedEditKeyRef.current = location.key
    setShowEditModal(true)
  }, [isOwnProfile, location.key, location.state])

  // When the signed-in user follows / unfollows ANYONE (eg. via the
  // Search Users tab), refresh the count on the currently-viewed
  // profile if it was the target. This keeps the numeral in lockstep
  // with the toggle button regardless of which screen owned the action.
  useEffect(() => {
    function handleFollowChanged(e) {
      const followeeId = e?.detail?.followeeId
      if (!followeeId) return
      if (followeeId === targetUserId) {
        refreshFollows().catch(() => {})
      }
    }
    window.addEventListener(FOLLOW_CHANGED_EVENT, handleFollowChanged)
    return () => {
      window.removeEventListener(FOLLOW_CHANGED_EVENT, handleFollowChanged)
    }
  }, [targetUserId, refreshFollows])

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

  const dedupedReviews = useMemo(
    () => dedupeReviewsByGame(allReviews),
    [allReviews]
  )

  const sortedReviews = useMemo(
    () =>
      sortReviews(dedupedReviews, activeSort.reviews, reviewLikeCounts).filter(
        (r) => !pinnedIdSet.has(r.id)
      ),
    [dedupedReviews, activeSort.reviews, reviewLikeCounts, pinnedIdSet]
  )

  const sortedLists = useMemo(() => {
    const sorted = sortLists(customLists, activeSort.lists)
    return [...sorted].sort((a, b) => {
      const pinDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)
      if (pinDiff !== 0) return pinDiff
      const da = new Date(a.updatedAt || a.createdAt || 0)
      const db = new Date(b.updatedAt || b.createdAt || 0)
      return db - da
    })
  }, [customLists, activeSort.lists])

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

  /* ── Bio overflow measurement ─────────────────────────────────── */

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
    // Sync to Supabase — best-effort, never blocks the UI update
    if (user?.id) {
      updateUserProfile(user.id, { favoriteGames: newFavorites }).catch((err) =>
        console.warn('[Profile] favorites Supabase sync failed:', err)
      )
    }
  }

  const handleReorderFavorites = (newFavorites) => {
    const previous = profile?.favoriteGames || []
    const updated = updateProfile({ favoriteGames: newFavorites })
    setProfile(updated)
    window.dispatchEvent(new Event('profileUpdated'))
    if (!user?.id) return
    updateUserProfile(user.id, { favoriteGames: newFavorites }).catch(() => {
      const rolled = updateProfile({ favoriteGames: previous })
      setProfile(rolled)
      window.dispatchEvent(new Event('profileUpdated'))
      showToast('Failed to save new order. Please try again.', 'error')
    })
  }

  const handleShareFavorites = useCallback(async () => {
    if (favSharing === 'generating') return
    setFavSharing('generating')
    try {
      const favs = profile?.favoriteGames || []
      const username =
        profile?.username || profile?.displayName || 'gamer'
      await shareCard({
        variant: 'favorites-shelf',
        data: {
          username,
          games: favs.map((g) => ({ title: g.title, coverUrl: g.image })),
        },
        // Link only when there is a real username — a display name would
        // produce a /u/ link that opens nobody.
        target: { type: 'profile', username: profile?.username || '' },
        title: `${username}'s Favorite Games`,
      })
    } catch (err) {
      console.warn('[Profile] favorites share failed:', err)
      showToast('Could not generate share card', 'error')
    } finally {
      setFavSharing('idle')
    }
  }, [favSharing, profile])

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

  // Public link to the profile's landing page. Needs a real username and a
  // configured site; otherwise the profile is shared as text without a link.
  const profileShareUrl = () => siteLink('profile', profile?.username)

  const handleShareProfile = async () => {
    const name = profile?.displayName || profile?.username || 'Profile'
    const result = await shareContent({
      title: `${name} on Checkpoint`,
      text: profile?.bio || `${name} on Checkpoint`,
      url: profileShareUrl(),
    })
    if (result?.method === 'clipboard') {
      showToast(result.copied === 'link' ? 'Link copied' : 'Copied', 'success')
    }
  }

  // Copies the profile URL directly to the clipboard — distinct from
  // handleShareProfile, which opens the native/web share sheet. Lives in
  // the overflow sheet as its own "Copy link" row.
  const handleCopyProfileLink = useCallback(async () => {
    const url = siteLink('profile', profile?.username)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      showToast('Link copied', 'success')
    } catch (err) {
      console.error('[profile] copy link failed:', err)
      showToast('Could not copy link', 'error')
    }
  }, [profile])

  // Shared by the hero "Message" button (visitor, following) and the
  // visitor overflow sheet's "Message" row.
  const handleMessageUser = useCallback(() => {
    const handle = profile?.username || profile?.id || targetUserId || ''
    if (!handle) return
    navigate(`/messages/${encodeURIComponent(handle)}`)
  }, [profile, targetUserId, navigate])

  const handleShareWrapped = useCallback(async (period = 'year') => {
    if (wrappedSharing === 'generating') return
    setWrappedSharing('generating')
    try {
      const summary = compileWrappedSummary(period)
      await shareCard({
        variant: 'wrapped-summary',
        data: summary,
        target: {
          type: 'profile',
          username: profile?.username || '',
        },
        title: `My ${summary.periodLabel} in Games — Checkpoint`,
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
    hapticImpact('Light')

    // Optimistic toggle — flip the button label and bump the follower
    // numeral immediately so the UI feels instant. followUser's own
    // cache patch no-ops when amFollowing is already the target value.
    const delta = wasFollowing ? -1 : 1
    mutateFollows((current) => {
      if (!current) return current
      return {
        ...current,
        amFollowing: !wasFollowing,
        followers: Math.max(0, (current.followers || 0) + delta),
      }
    })
    setFollowPending(true)

    try {
      if (wasFollowing) {
        await unfollowUser(targetUserId)
      } else {
        await followUser(targetUserId)
      }
    } catch (err) {
      // Roll back on failure.
      mutateFollows((current) => {
        if (!current) return current
        return {
          ...current,
          amFollowing: wasFollowing,
          followers: Math.max(0, (current.followers || 0) - delta),
        }
      })
      console.error('[profile] follow toggle failed:', err)
      showToast(
        err?.message || "Couldn't update follow status. Tap to retry.",
        'error',
        4000,
        { label: 'Retry', onClick: () => handleFollowToggle() }
      )
    } finally {
      setFollowPending(false)
    }
  }, [targetUserId, isOwnProfile, followPending, following, mutateFollows])

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

  const handleCreateList = async (listName, description, initialGames, isPublic = true) => {
    const listId = await createList({
      name: listName,
      description,
      isPublic,
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
        <div className="profile-ig-hero profile-ig-hero--skeleton">
          <div className="skeleton profile-ig-hero__avatar-sk" />
          <span className="skeleton profile-ig-hero__name-sk" />
          <span className="skeleton profile-ig-hero__handle-sk" />
          <span className="skeleton profile-ig-hero__stats-line-sk" />
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

  const reviewCount = allReviews.length
  // Games stat — total tracked games across every status (Backlog /
  // Playing / Played / Dropped), counted from `game_trackers` for own and
  // visitor profiles alike so both views agree. The own-profile path used
  // to read a localStorage-derived total, which drifted out of sync with
  // the server (it reported 1 game for an account with 13 played this
  // year) and reset to 0 on a fresh device.
  const gamesCount = trackedGamesCount

  // Avg ★ on the player card — mean of this user's real ratings. Null
  // when they haven't rated anything, so the card renders an em dash
  // instead of a meaningless 0.0.
  const avgRating = (() => {
    const values = allReviews
      .map((r) => Number(r.rating))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (values.length === 0) return null
    return values.reduce((sum, n) => sum + n, 0) / values.length
  })()

  // Path segment for every profile-scoped push (followers, following,
  // badges, activity, challenge). Most accounts have no username set, so
  // routing by displayName would 404 the lookup on the destination page;
  // prefer the real username and fall back to the UUID route, which each
  // of those pages resolves via getUserById.
  const profilePathSegment = profile.username
    ? encodeURIComponent(profile.username)
    : `id/${encodeURIComponent(targetUserId || '')}`

  const setSocials = SOCIAL_PLATFORMS.filter(
    (p) => (profile[p.profileField] || '').trim().length > 0
  )

  const favoriteGames = profile.favoriteGames || []
  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <PullToRefresh onRefresh={handlePullToRefresh}>
      <div className="profile-page">
        {/* Banner — full-bleed strip above the player card. Sprint 7
            preserved; the card sits below it. */}
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
            PLAYER CARD — avatar / name / @handle / clickable
            Followers · Following / four-stat block, with the ⋯
            overflow menu top-right and a back chevron on visitor
            profiles.
            ═════════════════════════════════════════════════════════ */}
        <ProfilePlayerCard
          displayName={profile.displayName}
          username={profile.username}
          avatarUrl={avatarDisplay}
          avatarSeed={profile.id || targetUserId}
          isOwnProfile={isOwnProfile}
          plusActive={isOwnProfile ? ownPlusActive : profile.plusActive === true}
          liveStatusLabel={liveStatus ? `in ${liveStatus.gameTitle} now` : null}
          followersCount={followersCount}
          followingCount={followingCount}
          followLoading={followLoading}
          gamesCount={gamesCount}
          hoursPlayed={hoursPlayed}
          reviewsCount={reviewCount}
          avgRating={avgRating}
          statsLoading={profileLoading}
          hasUnreadMessages={isOwnProfile && unreadCount > 0}
          onBack={() => navigate(-1)}
          onOverflow={() => setOverflowSheetOpen(true)}
          onMessages={() => navigate('/messages')}
          onAvatarClick={() => isOwnProfile && setShowEditModal(true)}
          onFollowersClick={() => navigate(`/user/${profilePathSegment}/followers`)}
          onFollowingClick={() => navigate(`/user/${profilePathSegment}/following`)}
          onGamesClick={
            isOwnProfile
              ? () => navigate('/library')
              : () => navigate(`/user/${profilePathSegment}/library`, {
                  state: { gamesCountHint: gamesCount },
                })
          }
        />

        {/* ═════════════════════════════════════════════════════════
            IDENTITY DETAIL — bio, social links, and the primary
            action, all below the card. Each hides when it has nothing
            to show, so an own profile with no bio set renders just the
            card and the tabs.
            ═════════════════════════════════════════════════════════ */}
        <section className="profile-ig-hero">
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

          {bestAnswersCount > 0 && (
            <button
              type="button"
              className="profile-ig-hero__best"
              onClick={() => navigate(`/user/${profilePathSegment}/best-answers`)}
              aria-label={`${bestAnswersCount} best ${bestAnswersCount === 1 ? 'answer' : 'answers'}, view list`}
            >
              {bestAnswersCount} best {bestAnswersCount === 1 ? 'answer' : 'answers'}
              <LuChevronRight size={14} aria-hidden="true" />
            </button>
          )}

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

          {!isOwnProfile && (
            <ProfileTasteMatchBanner viewerId={user?.id} ownerId={targetUserId} />
          )}

          {!isOwnProfile && (
            <div className="profile-ig-hero__actions">
              <button
                type="button"
                className={`profile-ig-btn profile-ig-btn--secondary${
                  following ? ' profile-ig-btn--following' : ''
                }`}
                onClick={handleFollowToggle}
                disabled={followPending}
                aria-pressed={following ? 'true' : 'false'}
                aria-label={following ? 'Unfollow' : 'Follow'}
              >
                {following && <LuCheck size={14} aria-hidden="true" />} {following ? 'Following' : 'Follow'}
              </button>
              {showMessageAction && (
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--primary"
                  onClick={handleMessageUser}
                  aria-label="Send message"
                >
                  Message
                </button>
              )}
            </div>
          )}
        </section>

        {/* ═════════════════════════════════════════════════════════
            OVERFLOW SHEET (⋯) — self vs visitor get entirely different
            components. Own profile: Edit profile, Share profile,
            Your Wrapped, Settings. Visitor profile keeps its own flat
            ActionSheet (Message / Share / Copy link / Block / Report).
            ═════════════════════════════════════════════════════════ */}
        {isOwnProfile ? (
          <SettingsSheet
            isOpen={overflowSheetOpen}
            onClose={() => setOverflowSheetOpen(false)}
            onEditProfile={() => setShowEditModal(true)}
            onShareProfile={handleShareProfile}
            onWrapped={() => handleShareWrapped('year')}
            wrappedLabel={
              wrappedSharing === 'generating'
                ? 'Generating…'
                : wrappedSharing === 'done'
                ? 'Shared!'
                : 'Your Wrapped'
            }
            wrappedDisabled={wrappedSharing === 'generating'}
          />
        ) : (
          <ActionSheet
            isOpen={overflowSheetOpen}
            onClose={() => setOverflowSheetOpen(false)}
            items={[
              ...(showMessageAction
                ? [{
                    label: 'Message',
                    icon: <LuMessageCircle size={18} />,
                    tone: 'cobalt',
                    onClick: handleMessageUser,
                  }]
                : []),
              {
                label: 'Share profile',
                icon: <LuShare2 size={18} />,
                tone: 'purple',
                onClick: handleShareProfile,
              },
              ...(SHARE_LINKS_ENABLED && profile.username
                ? [{
                    label: 'Copy link',
                    icon: <LuLink size={18} />,
                    tone: 'green',
                    onClick: handleCopyProfileLink,
                  }]
                : []),
              { divider: true },
              {
                label: `Block ${profile.username || profile.displayName || 'user'}`,
                icon: <LuUserX size={18} />,
                tone: 'neutral',
                chevron: false,
                destructive: true,
                onClick: () => setBlockSheetOpen(true),
              },
              {
                label: 'Report',
                icon: <LuFlag size={18} />,
                tone: 'neutral',
                onClick: () => setReportProfileOpen(true),
              },
            ]}
          />
        )}

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
                onClick={() => {
                  if (!isActive) hapticImpact('Light')
                  setActiveTab(tab.id)
                }}
              >
                <span className="profile-tab__label">{tab.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="profile-tab-underline"
                    className="profile-tab__underline"
                    transition={{ duration: 0 }}
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
              {activeTab === 'home' && (
                <HomeTab
                  favoriteGames={favoriteGames}
                  onGameClick={(game) =>
                    navigate(`/game/${game.id}`, { state: getGameNavStub(game) })
                  }
                  onSeeMoreBadges={() => navigate(`/user/${profilePathSegment}/badges`)}
                  profilePathSegment={profilePathSegment}
                  targetUserId={targetUserId}
                  isOwnProfile={isOwnProfile}
                  onEditFavorites={() => setShowFavPickerSheet(true)}
                  onReorderFavorites={handleReorderFavorites}
                  onShareFavorites={handleShareFavorites}
                  favSharing={favSharing}
                  allReviews={allReviews}
                  onReviewTap={(id) => navigate(`/review/${id}`)}
                  goalProgress={goalProgress}
                  rivalryData={rivalryData}
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
                  onTapList={(id) => navigate(`/list/${id}`)}
                  onCreateList={() => setShowCreateListModal(true)}
                />
              )}

              {activeTab === 'diary' && (
                <DiaryTab
                  userId={targetUserId}
                  entries={journalEntries}
                  onEntryClick={(entryId) => navigate(`/journal/${entryId}`)}
                />
              )}
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
          label="Favorite Games"
          maxItems={4}
          showWhy
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
                  hapticImpact('Medium')
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
              const year = goalProgress?.year ?? thisYear
              await setGoal(user.id, year, target)
              const updated = await getGoalProgress(user.id, year)
              if (updated) setGoalProgress(updated)
            }}
            year={goalProgress?.year ?? thisYear}
            current={goalProgress?.target ?? 0}
          />
        )}
      </div>
      </PullToRefresh>
    </SharedCoverScope>
  )
}

/* ============================================================
   ── Home tab
   ============================================================ */

function useProfileChallengeMeta(goalProgress, rivalryData) {
  const currentYear = goalProgress?.year ?? new Date().getFullYear()
  const circleRank = (() => {
    if (!goalProgress?.hasGoal || !rivalryData?.length) return null
    const withSelf = [
      { userId: 'self', current: goalProgress.current, isSelf: true },
      ...rivalryData.map((r) => ({ ...r, isSelf: false })),
    ].sort((a, b) => b.current - a.current || (a.isSelf ? -1 : 1))
    const idx = withSelf.findIndex((r) => r.isSelf)
    return idx === -1 ? null : idx + 1
  })()
  const hasGoal = goalProgress?.hasGoal
  const remaining = hasGoal ? Math.max(0, goalProgress.target - goalProgress.current) : null
  return { currentYear, circleRank, hasGoal, remaining }
}

function ProfileChallengeSection({
  goalProgress,
  profilePathSegment,
  circleRank,
  remaining,
  hasGoal,
  currentYear,
  onSetGoal,
  showChallengeRow = true,
  badgesUserId = null,
  onSeeMoreBadges,
}) {
  const showBadges = !!badgesUserId

  if (!showChallengeRow && !showBadges) return null

  return (
    <section
      className="profile-home__section profile-home__section--card profile-challenge-cell"
      aria-label={showChallengeRow ? `${currentYear} challenge` : 'Badges'}
    >
      {showChallengeRow && (
        goalProgress === null ? (
          <div className="profile-challenge" aria-busy="true">
            <Skeleton variant="circle" width={44} height={44} />
            <div className="profile-challenge__info">
              <Skeleton variant="text" width={160} height={18} />
              <Skeleton variant="text" width={110} height={13} style={{ marginTop: 6 }} />
            </div>
          </div>
        ) : hasGoal ? (
          <ChallengeCard
            className="profile-challenge profile-challenge--tappable"
            year={goalProgress.year}
            current={goalProgress.current}
            target={goalProgress.target}
            profilePathSegment={profilePathSegment}
            ariaLabel={`${goalProgress.year} Challenge, ${goalProgress.current} of ${goalProgress.target} completed. View completed games.`}
          >
            <GoalRing
              current={goalProgress.current}
              target={goalProgress.target}
              year={goalProgress.year}
              tier={goalProgress.tier}
              variant="compact"
            />
            <span className="profile-challenge__info">
              <span className="profile-challenge__headline">
                {goalProgress.year} Challenge · {goalProgress.current} of {goalProgress.target}
              </span>
              <span
                className={`profile-challenge__sub${remaining === 0 ? ' profile-challenge__sub--reached' : ''}`}
              >
                {circleRank != null && (
                  <>
                    #{circleRank} in your circle
                    {remaining > 0 ? ' · ' : ''}
                  </>
                )}
                {remaining === 0 ? 'Goal reached!' : `${remaining} to go`}
              </span>
            </span>
            <LuChevronRight size={18} className="profile-challenge__chevron" aria-hidden="true" />
          </ChallengeCard>
        ) : onSetGoal ? (
          <div className="profile-challenge">
            <GoalRing
              current={0}
              target={null}
              year={goalProgress.year}
              variant="compact"
              onSet={onSetGoal}
            />
            <div className="profile-challenge__info">
              <span className="profile-challenge__headline">
                {goalProgress.year} Challenge
              </span>
              <button
                type="button"
                className="profile-challenge__set-goal"
                onClick={onSetGoal}
              >
                Set a {goalProgress.year} goal
              </button>
            </div>
          </div>
        ) : null
      )}
      {showBadges && (
        <BadgesRow
          embedded={showChallengeRow}
          userId={badgesUserId}
          onSeeMore={onSeeMoreBadges}
        />
      )}
    </section>
  )
}

function ProfileFavoritesSection({
  favoriteGames,
  isOwnProfile,
  onShareFavorites,
  favSharing,
  onEditFavorites,
  onGameClick,
  onReorderFavorites,
  compactEmpty = false,
}) {
  if (favoriteGames.length === 0 && !isOwnProfile) return null

  return (
    <section className="profile-home__section profile-home__section--card">
      <div className="profile-home__section-header">
        <h3 className="profile-home__section-title">Favorite games</h3>
        <div className="profile-home__section-actions">
          {favoriteGames.length > 0 && (
            <button
              type="button"
              className="profile-home__share-btn"
              onClick={onShareFavorites}
              disabled={favSharing === 'generating'}
              aria-label="Share favorite games card"
            >
              {favSharing === 'generating' ? (
                <span className="profile-home__share-spinner" aria-hidden="true" />
              ) : (
                <LuShare2 size={15} aria-hidden="true" />
              )}
            </button>
          )}
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
      </div>
      {favoriteGames.length === 0 ? (
        compactEmpty ? (
          <FavoriteGamesRow
            games={[]}
            isOwnProfile
            onGameClick={onGameClick}
            onAdd={onEditFavorites}
            showAddSlot
          />
        ) : (
          <EmptyState
            icon={Plus}
            size="inline"
            cta="Add favorite games"
            ctaVariant="secondary"
            onCta={onEditFavorites}
          />
        )
      ) : (
        <FavoriteGamesRow
          games={favoriteGames.slice(0, MAX_FAVORITE_SLOTS)}
          isOwnProfile={isOwnProfile}
          onGameClick={onGameClick}
          onAdd={onEditFavorites}
          showAddSlot={isOwnProfile && favoriteGames.length < MAX_FAVORITE_SLOTS}
          onReorder={onReorderFavorites}
        />
      )}
    </section>
  )
}

function HomeTab({
  favoriteGames,
  onGameClick,
  onSeeMoreBadges,
  profilePathSegment,
  targetUserId,
  isOwnProfile,
  onEditFavorites,
  onReorderFavorites,
  onShareFavorites,
  favSharing,
  allReviews,
  onReviewTap,
  goalProgress,
  rivalryData,
  onSetGoal,
}) {
  const [tasteVisible, setTasteVisible] = useState(false)
  const [tasteLoading, setTasteLoading] = useState(true)
  const { reduced: tasteReduced } = useMotionPreference()
  const handleTasteResolved = useCallback(({ visible, loading }) => {
    setTasteVisible(visible)
    setTasteLoading(loading)
  }, [])

  const { currentYear, circleRank, hasGoal, remaining } = useProfileChallengeMeta(
    goalProgress,
    rivalryData
  )

  const ratedCount = (allReviews || []).filter((r) => Number(r.rating) > 0).length
  const ratingsVisible = ratedCount >= MIN_RATINGS_FOR_CHART
  const wantsTasteCard = tasteLoading || tasteVisible || ratingsVisible
  const [tasteCardMounted, setTasteCardMounted] = useState(true)
  useEffect(() => {
    if (wantsTasteCard) {
      setTasteCardMounted(true)
      return undefined
    }
    const ms = tasteReduced ? 0 : 150
    const id = setTimeout(() => setTasteCardMounted(false), ms)
    return () => clearTimeout(id)
  }, [wantsTasteCard, tasteReduced])
  const showChallengeRow = isOwnProfile || goalProgress === null || hasGoal

  return (
    <div className="profile-home profile-home--condensed">
      <ProfileFavoritesSection
        favoriteGames={favoriteGames}
        isOwnProfile={isOwnProfile}
        onShareFavorites={onShareFavorites}
        favSharing={favSharing}
        onEditFavorites={onEditFavorites}
        onGameClick={onGameClick}
        onReorderFavorites={onReorderFavorites}
        compactEmpty={isOwnProfile}
      />

      {(wantsTasteCard || tasteCardMounted) && (
        <ReservedSlot open={wantsTasteCard}>
          <section className="profile-home__section profile-home__section--card profile-home__taste-rate">
            <ProfileTasteDNA
              userId={targetUserId}
              isOwnProfile={isOwnProfile}
              embedded
              onResolved={handleTasteResolved}
            />
            {tasteVisible && ratingsVisible && (
              <hr className="profile-home__hairline" aria-hidden="true" />
            )}
            <ProfileRatingsChart
              reviews={allReviews}
              onReviewTap={onReviewTap}
              embedded
            />
          </section>
        </ReservedSlot>
      )}

      {(showChallengeRow || targetUserId) && (
        <ProfileChallengeSection
          goalProgress={goalProgress}
          profilePathSegment={profilePathSegment}
          circleRank={circleRank}
          remaining={remaining}
          hasGoal={hasGoal}
          currentYear={currentYear}
          onSetGoal={isOwnProfile ? onSetGoal : undefined}
          showChallengeRow={showChallengeRow}
          badgesUserId={targetUserId}
          onSeeMoreBadges={onSeeMoreBadges}
        />
      )}
    </div>
  )
}

/* ============================================================
   ── Reviews tab (V4-06 two-size rows)
   ============================================================ */

function ProfileReviewRow({
  row,
  likeCounts,
  commentCounts,
  isOwn,
  isPinned,
  onEdit,
  onPin,
  onUnpin,
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef(null)
  const quoteRef = useRef(null)
  const isFull = reviewHasText(row)
  const vibeLabel = row.vibe_stamp
    ? REVIEW_VIBE_LABELS[row.vibe_stamp] || row.vibe_stamp
    : null
  const likeState = useLikeState(row.id)
  const displayedLikeCount = likeCounts?.get(row.id) ?? likeState.count
  const displayedCommentCount = commentCounts?.get(row.id) ?? 0
  const when = formatActivityDate(row.created_at)
  const coverSize = isFull ? 52 : 34
  const coverSrc = row.game_image
    ? getSizedImageUrl(row.game_image, coverSize)
    : COVER_FALLBACK
  const gameTitle = row.game_title || 'Unknown Game'

  const goToGame = (e) => {
    e?.stopPropagation?.()
    if (!row.igdb_game_id) return
    navigate(`/game/${row.igdb_game_id}`, {
      state: getGameNavStub(profileReviewGameStub(row)),
    })
  }

  const goToComments = (e) => {
    e?.stopPropagation?.()
    navigate(`/reviews/${row.id}/comments`)
  }

  const handleLike = async (e) => {
    e.stopPropagation()
    const next = { liked: !likeState.liked, count: likeState.count + (likeState.liked ? -1 : 1) }
    publishLikeState(row.id, next)
    try {
      if (likeState.liked) await unlikeReview(row.id)
      else await likeReview(row.id)
    } catch {
      publishLikeState(row.id, likeState)
    }
  }

  useLayoutEffect(() => {
    if (!isFull || expanded || !quoteRef.current) return
    setBodyOverflows(quoteRef.current.scrollHeight > quoteRef.current.clientHeight + 1)
  }, [isFull, expanded, row.body])

  useEffect(() => {
    if (!kebabOpen) return undefined
    const close = (ev) => {
      if (kebabRef.current && !kebabRef.current.contains(ev.target)) setKebabOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [kebabOpen])

  const reactions = (
    <div className="profile-review-row__reactions">
      <Pressable
        className="profile-review-row__react"
        onClick={handleLike}
        aria-label={likeState.liked ? 'Unlike' : 'Like'}
        aria-pressed={likeState.liked}
      >
        {likeState.liked ? <HiHeart aria-hidden="true" /> : <HiOutlineHeart aria-hidden="true" />}
        {shouldShowCount(displayedLikeCount) && <span>{displayedLikeCount}</span>}
      </Pressable>
      <Pressable
        className="profile-review-row__react"
        onClick={goToComments}
        aria-label="Comments"
      >
        <HiOutlineChat aria-hidden="true" />
        {shouldShowCount(displayedCommentCount) && <span>{displayedCommentCount}</span>}
      </Pressable>
    </div>
  )

  const kebab = isOwn ? (
    <div className="profile-review-row__kebab-wrap" ref={kebabRef}>
      <button
        type="button"
        className="profile-review-row__kebab"
        onClick={(e) => {
          e.stopPropagation()
          setKebabOpen((v) => !v)
        }}
        aria-label="More options"
        aria-expanded={kebabOpen}
      >
        <HiDotsVertical aria-hidden="true" />
      </button>
      {kebabOpen && (
        <div className="profile-review-row__kebab-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              setKebabOpen(false)
              onEdit?.()
            }}
          >
            <HiOutlinePencil aria-hidden="true" />
            Edit review
          </button>
          {isPinned ? (
            onUnpin && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  setKebabOpen(false)
                  onUnpin()
                }}
              >
                <LuPinOff aria-hidden="true" />
                Unpin from profile
              </button>
            )
          ) : (
            onPin && (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  setKebabOpen(false)
                  onPin()
                }}
              >
                <LuPin aria-hidden="true" />
                Pin to profile
              </button>
            )
          )}
        </div>
      )}
    </div>
  ) : null

  if (!isFull) {
    return (
      <article className="profile-review-row profile-review-row--compact">
        <button
          type="button"
          className="profile-review-row__cover-btn profile-review-row__cover-btn--compact"
          onClick={goToGame}
          aria-label={`Open ${gameTitle}`}
        >
          <img
            className="profile-review-row__cover profile-review-row__cover--compact"
            src={coverSrc}
            alt=""
            loading="lazy"
            onError={(e) => { e.target.src = COVER_FALLBACK }}
          />
        </button>
        <div className="profile-review-row__compact-main">
          <button type="button" className="profile-review-row__title-btn" onClick={goToGame}>
            <h3 className="profile-review-row__title profile-review-row__title--compact">
              {gameTitle}
            </h3>
          </button>
          <div className="profile-review-row__stars profile-review-row__stars--compact">
            <StarRatingDisplay rating={Number(row.rating) || 0} size={14} />
          </div>
        </div>
        <time className="profile-review-row__when profile-review-row__when--compact" dateTime={row.created_at}>
          {when}
        </time>
        {kebab}
      </article>
    )
  }

  const bodyText = (row.body || '').trim()

  return (
    <article className="profile-review-row profile-review-row--full">
      <button
        type="button"
        className="profile-review-row__cover-btn profile-review-row__cover-btn--full"
        onClick={goToGame}
        aria-label={`Open ${gameTitle}`}
      >
        <img
          className="profile-review-row__cover profile-review-row__cover--full"
          src={coverSrc}
          alt=""
          loading="lazy"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
      </button>
      <div className="profile-review-row__full-body">
        <button type="button" className="profile-review-row__title-btn" onClick={goToGame}>
          <h3 className="profile-review-row__title profile-review-row__title--full">{gameTitle}</h3>
        </button>
        <div className="profile-review-row__rating-row">
          <StarRatingDisplay rating={Number(row.rating) || 0} size={14} />
          {vibeLabel && (
            <span className="profile-review-row__tier">{vibeLabel}</span>
          )}
        </div>
        <blockquote
          className={`profile-review-row__quote${expanded ? ' profile-review-row__quote--expanded' : ''}`}
        >
          <p ref={quoteRef}>{bodyText}</p>
        </blockquote>
        {!expanded && bodyOverflows && (
          <button
            type="button"
            className="profile-review-row__expand"
            onClick={() => setExpanded(true)}
          >
            Read more
          </button>
        )}
        <footer className="profile-review-row__footer">
          {reactions}
          <div className="profile-review-row__footer-right">
            <time className="profile-review-row__when" dateTime={row.created_at}>{when}</time>
            {kebab}
          </div>
        </footer>
      </div>
    </article>
  )
}

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

  const renderRow = (row, { pinned = false } = {}) => {
    const own = currentUserId && row.user_id === currentUserId
    return (
      <ProfileReviewRow
        key={row.id}
        row={row}
        likeCounts={likeCounts}
        commentCounts={commentCounts}
        isOwn={!!own}
        isPinned={pinned}
        onEdit={own ? () => onEditReview(rowToEditShape(row)) : undefined}
        onPin={own && !pinned ? () => onPinReview(row) : undefined}
        onUnpin={own && pinned ? () => onUnpinReview(row.id) : undefined}
      />
    )
  }

  return (
    <div className="profile-reviews">
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
              {pinnedRows.map(({ review: row }) => renderRow(row, { pinned: true }))}
            </div>
          </section>
          <div className="profile-pinned__divider" aria-hidden="true" />
        </>
      )}

      <div className="profile-reviews__list">
        {reviews.map((row) => renderRow(row))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="profile-reviews__sentinel" aria-hidden="true" />
      )}
    </div>
  )
}

/* ============================================================
   ── Lists tab (V4-06)
   ============================================================ */

function ProfileListStackThumb({ games = [], coverImageUrl = null, name = '' }) {
  const label = name ? `${name} covers` : 'List covers'
  const covers = coverImageUrl
    ? [coverImageUrl]
    : (games || [])
        .map((g) => getSizedImageUrl(g?.image, 38))
        .filter(Boolean)
        .slice(0, 3)

  if (covers.length === 0) {
    return (
      <div className="profile-list-stack profile-list-stack--empty" aria-hidden="true">
        <List size={20} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="profile-list-stack" role="img" aria-label={label}>
      {covers.map((src, i) => (
        <img
          key={`${src}-${i}`}
          className="profile-list-stack__cover"
          style={{ '--stack-index': i }}
          src={src}
          alt=""
          loading="lazy"
        />
      ))}
    </div>
  )
}

function ProfileStartListCard({ onCreateList }) {
  return (
    <button type="button" className="profile-lists__start-card" onClick={onCreateList}>
      <span className="profile-lists__start-title">+ Start a list</span>
      <span className="profile-lists__start-body">
        Lists show up here and in Discover&rsquo;s Collections when public
      </span>
    </button>
  )
}

function ListRow({ list, onTap }) {
  const gameCount = list.gameCount || 0
  const updated = formatActivityDate(list.updatedAt || list.createdAt, { pulse: true })
  const meta = `${gameCount} ${gameCount === 1 ? 'game' : 'games'} · updated ${updated}`

  return (
    <article
      className="profile-list-row"
      onClick={onTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTap()
        }
      }}
    >
      <ProfileListStackThumb
        games={list.previewGames || list.games}
        coverImageUrl={list.coverImageUrl}
        name={list.name}
      />

      <div className="profile-list-row__body">
        <div className="profile-list-row__title-row">
          <h3 className="profile-list-row__name">{list.name}</h3>
          {list.isPinned && (
            <span className="profile-list-row__pinned-chip">Pinned</span>
          )}
        </div>
        <p className="profile-list-row__meta">{meta}</p>
        <div className="profile-list-row__engagement">
          <span className="profile-list-row__stat">
            <HiOutlineHeart aria-hidden="true" />
            {shouldShowCount(list.likeCount) && list.likeCount}
          </span>
          <span className="profile-list-row__stat">
            <HiOutlineChat aria-hidden="true" />
          </span>
        </div>
      </div>

      <LuChevronRight className="profile-list-row__chevron" size={18} aria-hidden="true" />
    </article>
  )
}

function ListsTab({
  lists,
  isOwnProfile,
  onTapList,
  onCreateList,
}) {
  if (lists.length === 0 && !isOwnProfile) {
    return <div className="profile-lists profile-lists--empty" />
  }

  return (
    <div className="profile-lists">
      {lists.length > 0 && (
        <ul className="profile-lists__stack" role="list">
          {lists.map((list) => (
            <li key={list.id}>
              <ListRow list={list} onTap={() => onTapList(list.id)} />
            </li>
          ))}
        </ul>
      )}
      {isOwnProfile && onCreateList && (
        <ProfileStartListCard onCreateList={onCreateList} />
      )}
    </div>
  )
}

/* ============================================================
   ── Diary tab (V4-06 — grouped by calendar day)
   ============================================================ */

function diaryDayKey(isoString) {
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDiaryDayHeader(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(new Date())
  const then = startOfDay(date)
  const dayDiff = Math.round((today - then) / (86400000))

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'

  const fmt = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== today.getFullYear()) fmt.year = 'numeric'
  return date.toLocaleDateString('en-US', fmt)
}

function groupDiaryEntriesByDay(entries) {
  const groups = new Map()
  for (const entry of entries || []) {
    const key = diaryDayKey(entry.created_at)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, dayEntries]) => ({
      dayKey,
      header: formatDiaryDayHeader(dayEntries[0]?.created_at),
      entries: [...dayEntries].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      ),
    }))
}

function DiaryEntryRow({ entry, onEntryClick, onCoverClick }) {
  const moodMeta = entry.mood ? getMoodMeta(entry.mood) : null
  const hoursLabel = entry.hours_played != null
    ? `${entry.hours_played} hr${entry.hours_played !== 1 ? 's' : ''}`
    : null
  const platform = entry.platform || null
  const coverSrc = entry.game_image
    ? getSizedImageUrl(entry.game_image, 46)
    : COVER_FALLBACK
  const gameTitle = entry.game_title || 'Unknown game'

  return (
    <li className="profile-diary__row">
      <button
        type="button"
        className="profile-diary__cover-hit"
        onClick={(e) => {
          e.stopPropagation()
          onCoverClick(entry)
        }}
        aria-label={`Open ${gameTitle}`}
      >
        <img
          className="profile-diary__cover"
          src={coverSrc}
          alt=""
          loading="lazy"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
      </button>
      <button
        type="button"
        className="profile-diary__row-main"
        onClick={() => onEntryClick(entry.id)}
        aria-label={`Open journal entry for ${gameTitle}`}
      >
        <h3 className="profile-diary__game-title">{gameTitle}</h3>
        {platform && (
          <p className="profile-diary__platform">{platform}</p>
        )}
        {(moodMeta || hoursLabel) && (
          <div className="profile-diary__chips">
            {moodMeta && (
              <span className="profile-diary__chip profile-diary__chip--mood">
                {moodMeta.emoji} {moodMeta.label}
              </span>
            )}
            {hoursLabel && (
              <span className="profile-diary__chip profile-diary__chip--hours">
                {hoursLabel}
              </span>
            )}
          </div>
        )}
        {entry.is_spoiler ? (
          <p className="profile-diary__note profile-diary__note--spoiler">[spoiler]</p>
        ) : entry.body ? (
          <p className="profile-diary__note">{entry.body}</p>
        ) : null}
      </button>
      <button
        type="button"
        className="profile-diary__chevron-btn"
        onClick={() => onEntryClick(entry.id)}
        aria-label={`Open journal entry for ${gameTitle}`}
      >
        <LuChevronRight className="profile-diary__chevron" size={16} aria-hidden="true" />
      </button>
    </li>
  )
}

function DiaryTab({ userId, entries, onEntryClick }) {
  const navigate = useNavigate()
  const dayGroups = useMemo(
    () => groupDiaryEntriesByDay(entries),
    [entries]
  )

  const goToGame = useCallback((entry) => {
    if (!entry?.igdb_game_id) return
    navigate(`/game/${entry.igdb_game_id}`, {
      state: getGameNavStub({
        id: String(entry.igdb_game_id),
        title: entry.game_title || '',
        image: entry.game_image || '',
      }),
    })
  }, [navigate])

  if (dayGroups.length === 0) {
    return null
  }

  return (
    <div className="profile-diary">
      {userId && <OnThisDaySection userId={userId} />}

      {dayGroups.map((group) => (
        <section key={group.dayKey} className="profile-diary__day">
          <h3 className="profile-diary__day-header">{group.header}</h3>
          <ul className="profile-diary__list" aria-label={`Diary entries for ${group.header}`}>
            {group.entries.map((entry) => (
              <DiaryEntryRow
                key={entry.id}
                entry={entry}
                onEntryClick={onEntryClick}
                onCoverClick={goToGame}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default Profile
