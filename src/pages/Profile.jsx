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
  LuCheck,
  LuShare2,
  LuPin,
  LuArrowUpDown,
  LuPlus,
} from 'react-icons/lu'
import { HiDotsVertical } from 'react-icons/hi'
import { PenLine, List } from 'lucide-react'
import {
  FaInstagram,
  FaXTwitter,
  FaYoutube,
  FaTiktok,
} from 'react-icons/fa6'
import { useAuth } from '../contexts/AuthContext'
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
import { getProfile, initializeProfile, generateDefaultAvatar, updateProfile } from '../services/profileService'
import { getProfileStats } from '../services/profileStatsService'
import { getTrackedGamesCountForUser } from '../services/statsService'
import { getGoalProgress, setGoal, getRivalryData } from '../services/goalService'
import { useBadges } from '../hooks/useBadges'
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
import { shareCard } from '../services/share'
import { compileWrappedSummary } from '../services/dnaService'
import { fetchUserBannerUrl } from '../services/storageService'
import { blockUser } from '../services/blockService'
import ActionSheet from '../components/ActionSheet'
import ReportSheet from '../components/ReportSheet'
import EditProfileModal from '../components/EditProfileModal'
import CreateListModal from '../components/CreateListModal'
import FavoritesPickerSheet from '../components/FavoritesPickerSheet'
import GamePickerSheet from '../components/GamePickerSheet'
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
import PinnedListsSection from '../components/PinnedListsSection'
import ProfileRatingsChart from '../components/ProfileRatingsChart'
import ProfileTasteDNA from '../components/ProfileTasteDNA'
import ProfileTasteMatchBanner from '../components/ProfileTasteMatchBanner'
import ActivityTimeline from '../components/ActivityTimeline'
import { getJournalEntriesForUser, getMoodMeta } from '../services/journalService'
import OnThisDaySection from '../components/OnThisDaySection'
import Skeleton from '../components/Skeleton'
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
   Now Playing hero — derived from the same `activities` array the
   timeline already uses (no new data source). Scans newest-first and,
   per game, keeps only the FIRST (i.e. most recent) status_changed
   row encountered. If that row's to_status is 'currently', the game
   is still Playing (nothing later superseded it) and becomes the
   hero. Works identically for self and visitor profiles since
   `activities` is already fetched for both.
   ============================================================ */

function findNowPlaying(activities) {
  const seenGameIds = new Set()
  for (const a of activities) {
    if (a.activityType !== 'status_changed' || a.igdbGameId == null) continue
    const key = String(a.igdbGameId)
    if (seenGameIds.has(key)) continue
    seenGameIds.add(key)
    if (a.metadata?.to_status === 'currently') return a
  }
  return null
}

function formatShortDate(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

  // Tracks which route param `resolvedUser` / `userNotFound` currently
  // reflect. Needed because navigating directly between two OTHER
  // users' profiles (e.g. tapping a link from user A's profile to user
  // B's) changes `paramUsername`/`paramUserId` synchronously on render,
  // but `resolvedUser` still holds user A's row until the effect below
  // re-runs and its (async) lookup resolves. Without this guard, the
  // render(s) in between would read `resolvedUser` (A's row) as if it
  // were B's — i.e. the wrong profile's data, momentarily. See
  // `resolvedMatchesParams` below.
  const resolvedForKeyRef = useRef(null)

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
    setResolving(true)
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
    // (skeleton visible) forever. On timeout, safeWithTimeout resolves to null
    // which the .then() branch treats as "not found" — clears the skeleton.
    safeWithTimeout(getUserByUsername(decoded), null, 8_000)
      .then((row) => {
        if (cancelled) return
        resolvedForKeyRef.current = key
        if (!row) {
          setUserNotFound(true)
          setResolvedUser(null)
        } else {
          setResolvedUser(row)
          setUserNotFound(false)
        }
      })
      .catch(() => {
        if (!cancelled) { resolvedForKeyRef.current = key; setUserNotFound(true); setResolvedUser(null) }
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
  const [goalProgress, setGoalProgress] = useState(null)
  const [goalSheetOpen, setGoalSheetOpen] = useState(false)
  const [rivalryData, setRivalryData] = useState([])
  // Supabase-backed "games" stat numeral for VISITOR profiles only (see
  // getTrackedGamesCountForUser). `null` means "not resolved yet" so the
  // stats line can hide the segment instead of flashing a fabricated 0.
  const [visitorGamesCount, setVisitorGamesCount] = useState(null)

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
  // True until the FIRST loadProfileData() for the current targetUserId
  // resolves. Gates the review-count stat (and anything else derived
  // from allReviews on this render pass) so a loading profile never
  // paints "0 reviews" — only a skeleton or the real, resolved count.
  // Does NOT flip back to true on background refreshes (reviewAdded,
  // storage, etc.) so optimistic updates still paint instantly per the
  // app's optimistic-UI convention.
  const [profileLoading, setProfileLoading] = useState(true)
  const loadedProfileForUserRef = useRef(null)
  const [customLists, setCustomLists] = useState([])
  const [activities, setActivities] = useState([])
  const [journalEntries, setJournalEntries] = useState([])
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
  // Mirrors profileLoading's "first load per user" guard so the
  // followers/following numerals skeleton on initial load only, never
  // on optimistic follow/unfollow updates.
  const [followLoading, setFollowLoading] = useState(true)
  const loadedFollowForUserRef = useRef(null)

  // Sprint 7 — banner URL for non-own profiles fetched from Supabase.
  // Own profile reads bannerUrl directly from the localStorage profile blob.
  const [otherUserBannerUrl, setOtherUserBannerUrl] = useState(null)

  // Reviews tab — infinite scroll. Keep all rows in memory (already
  // sorted above) and reveal them in pages of REVIEWS_PAGE_SIZE.
  const REVIEWS_PAGE_SIZE = 10
  const [reviewsPage, setReviewsPage] = useState(1)
  const reviewsSentinelRef = useRef(null)

  /* ── Data loading ──────────────────────────────────────────────── */

  const loadProfileData = useCallback(async () => {
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
        const [rows, lists, acts, pins, pinnedListData, gp, journalRows, rd, visitorGames] = await Promise.all([
          safeWithTimeout(getReviewsForUser(targetUserId), []),
          safeWithTimeout(getListsForUser(targetUserId), []),
          safeWithTimeout(getActivitiesForUser(targetUserId, { limit: 8 }), []),
          safeWithTimeout(getPinsForUser(targetUserId), []),
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
          // Games stat for visitor profiles — Supabase-backed count from
          // game_trackers (publicly readable). Own profile keeps using
          // the localStorage-derived count below (unchanged behaviour).
          !isOwnProfile ? safeWithTimeout(getTrackedGamesCountForUser(targetUserId), 0) : Promise.resolve(null),
        ])
        if (gp) setGoalProgress(gp)
        if (rd) setRivalryData(rd)
        if (!isOwnProfile) setVisitorGamesCount(visitorGames ?? 0)
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
        setGoalProgress(null)
        setRivalryData([])
        setVisitorGamesCount(null)
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
      setVisitorGamesCount(null)
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
      // Same rule as loadProfileData: a null profileUserId (signed out,
      // still resolving, or a stale resolvedUser from a previously-
      // viewed profile) always resets the numerals so they never show a
      // stale/wrong user's counts. Only drop the loading flag once
      // we're confident there's nothing pending.
      setFollowersCount(0)
      setFollowingCount(0)
      setFollowing(false)
      if (paramKey === 'self' || (!resolving && resolvedMatchesParams)) {
        setFollowLoading(false)
      }
      return
    }
    const isFreshLoadForThisUser = loadedFollowForUserRef.current !== targetUserId
    if (isFreshLoadForThisUser) setFollowLoading(true)
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
    loadedFollowForUserRef.current = targetUserId
    setFollowLoading(false)
  }, [targetUserId, isOwnProfile, resolving, paramKey, resolvedMatchesParams])

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
    // Sync to Supabase — best-effort, never blocks the UI update
    if (user?.id) {
      updateUserProfile(user.id, { favoriteGames: newFavorites }).catch((err) =>
        console.warn('[Profile] favorites Supabase sync failed:', err)
      )
    }
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
        target: { type: 'profile', username },
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

  const handleShareProfile = async () => {
    const username = profile?.username || profile?.displayName || 'profile'
    const url = `${window.location.origin}/user/${encodeURIComponent(username)}`
    await shareContent({
      title: `${profile?.displayName || username} on GameTracker`,
      text: profile?.bio || '',
      url,
    })
  }

  // Copies the profile URL directly to the clipboard — distinct from
  // handleShareProfile, which opens the native/web share sheet. Lives in
  // the overflow sheet as its own "Copy link" row.
  const handleCopyProfileLink = useCallback(async () => {
    const username = profile?.username || profile?.displayName || 'profile'
    const url = `${window.location.origin}/user/${encodeURIComponent(username)}`
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
          <span className="profile-header-strip__title-sk skeleton" />
        </div>
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
  // Games stat — total tracked games across every list (Want to Play /
  // Playing / Played / Dropped). Own profile keeps reading the
  // localStorage-derived count (unchanged behaviour). Visitor profiles
  // use the Supabase-backed `game_trackers` count fetched in
  // loadProfileData — that table is publicly readable (trackers_select_all)
  // so this is a real, live number rather than a fabricated/hidden one.
  const gamesCount = isOwnProfile ? getProfileStats().totalGames : visitorGamesCount

  const setSocials = SOCIAL_PLATFORMS.filter(
    (p) => (profile[p.profileField] || '').trim().length > 0
  )

  const favoriteGames = profile.favoriteGames || []
  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="profile-page">
        {/* ═════════════════════════════════════════════════════════
            HEADER STRIP — back chevron (visitor only) / name (left) /
            overflow ⋯ (right) only
            ═════════════════════════════════════════════════════════ */}
        <header className={`profile-header-strip${!isOwnProfile ? ' profile-header-strip--visitor' : ''}`}>
          {!isOwnProfile && (
            <button
              type="button"
              className="profile-header-strip__icon-btn"
              aria-label="Go back"
              onClick={() => navigate(-1)}
            >
              <LuChevronLeft size={24} aria-hidden="true" />
            </button>
          )}
          <h1 className="profile-header-strip__title">{headerTitle}</h1>
          <button
            type="button"
            className="profile-header-strip__icon-btn"
            aria-label="More options"
            onClick={() => setOverflowSheetOpen(true)}
          >
            <HiDotsVertical size={20} aria-hidden="true" />
          </button>
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
            IG-STYLE PROFILE HEADER — avatar / name / handle / bio /
            inline stats line / action button(s)
            ═════════════════════════════════════════════════════════ */}
        <section className={`profile-ig-hero${displayBannerUrl ? ' profile-ig-hero--has-banner' : ''}`}>

          {/* ── Row 1: Avatar ── */}
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

          {/* ── Row 5: Stats — one quiet inline line under the bio.
              Games is own-profile only (no Supabase source exists yet
              for another user's library size — see STEP 1 diagnosis). ── */}
          <p className="profile-ig-hero__stats-line" role="group" aria-label="Profile stats">
            {gamesCount !== null && (
              <>
                <span className="profile-ig-hero__stat-segment">
                  <span className="profile-ig-hero__stat-value">{gamesCount}</span> games
                </span>
                <span className="profile-ig-hero__stat-dot" aria-hidden="true">·</span>
              </>
            )}
            <span className="profile-ig-hero__stat-segment">
              <span className="profile-ig-hero__stat-value">
                {profileLoading ? (
                  <Skeleton variant="text" width={14} height={13} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
                ) : (
                  reviewCount
                )}
              </span>{' '}
              reviews
            </span>
            <span className="profile-ig-hero__stat-dot" aria-hidden="true">·</span>
            <button
              type="button"
              className="profile-ig-hero__stat-segment profile-ig-hero__stat-segment--tappable"
              onClick={() => {
                // Most real accounts have no username set — routing by
                // displayName (or the literal fallback string 'user')
                // would 404 the lookup on the Followers page (it looks
                // users up by their actual `username` column) and show
                // "User not found." Prefer the real username when set;
                // otherwise use the UUID route, which FollowsListPage
                // resolves directly via getUserById.
                navigate(
                  profile.username
                    ? `/user/${encodeURIComponent(profile.username)}/followers`
                    : `/user/id/${encodeURIComponent(targetUserId)}/followers`
                )
              }}
              aria-label={followLoading ? 'Followers, loading' : `Followers, ${followersCount}, view list`}
              disabled={followLoading}
            >
              <span className="profile-ig-hero__stat-value">
                {followLoading ? (
                  <Skeleton variant="text" width={14} height={13} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
                ) : (
                  followersCount
                )}
              </span>{' '}
              followers
            </button>
            <span className="profile-ig-hero__stat-dot" aria-hidden="true">·</span>
            <button
              type="button"
              className="profile-ig-hero__stat-segment profile-ig-hero__stat-segment--tappable"
              onClick={() => {
                navigate(
                  profile.username
                    ? `/user/${encodeURIComponent(profile.username)}/following`
                    : `/user/id/${encodeURIComponent(targetUserId)}/following`
                )
              }}
              aria-label={followLoading ? 'Following, loading' : `Following, ${followingCount}, view list`}
              disabled={followLoading}
            >
              <span className="profile-ig-hero__stat-value">
                {followLoading ? (
                  <Skeleton variant="text" width={14} height={13} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
                ) : (
                  followingCount
                )}
              </span>{' '}
              following
            </button>
          </p>

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

          {/* Visitor-only E0 taste-match readout — never on your own
              profile, hides entirely when the engine hasn't computed
              a match for this viewer↔owner pair yet. */}
          {!isOwnProfile && (
            <ProfileTasteMatchBanner viewerId={user?.id} ownerId={targetUserId} />
          )}

          {/* ── Row 6: State-adaptive primary action — never more than
              one primary button visible at once. ── */}
          <div className="profile-ig-hero__actions">
            {isOwnProfile ? (
              <button
                type="button"
                className="profile-ig-btn profile-ig-btn--primary"
                onClick={() => setShowEditModal(true)}
                aria-label="Edit profile"
              >
                Edit Profile
              </button>
            ) : following ? (
              <>
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--secondary profile-ig-btn--following"
                  onClick={handleFollowToggle}
                  disabled={followPending}
                  aria-pressed="true"
                  aria-label="Unfollow"
                >
                  <LuCheck size={14} aria-hidden="true" /> Following
                </button>
                <button
                  type="button"
                  className="profile-ig-btn profile-ig-btn--primary"
                  onClick={handleMessageUser}
                  aria-label="Send message"
                >
                  Message
                </button>
              </>
            ) : (
              <button
                type="button"
                className="profile-ig-btn profile-ig-btn--primary"
                onClick={handleFollowToggle}
                disabled={followPending}
                aria-pressed="false"
                aria-label="Follow"
              >
                Follow
              </button>
            )}
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════
            OVERFLOW BOTTOM SHEET — replaces the old inline kebab
            dropdown. Content differs for self vs visitor.
            ═════════════════════════════════════════════════════════ */}
        <ActionSheet
          isOpen={overflowSheetOpen}
          onClose={() => setOverflowSheetOpen(false)}
          items={
            isOwnProfile
              ? [
                  { label: 'Edit profile', onClick: () => setShowEditModal(true) },
                  { label: 'Share profile', onClick: handleShareProfile },
                  {
                    label:
                      wrappedSharing === 'generating'
                        ? 'Generating…'
                        : wrappedSharing === 'done'
                        ? 'Shared!'
                        : 'Wrapped',
                    disabled: wrappedSharing === 'generating',
                    onClick: () => handleShareWrapped('year'),
                  },
                  { divider: true },
                  { label: 'Settings', onClick: () => navigate('/settings') },
                ]
              : [
                  { label: 'Message', onClick: handleMessageUser },
                  { label: 'Share profile', onClick: handleShareProfile },
                  { label: 'Copy link', onClick: handleCopyProfileLink },
                  { divider: true },
                  {
                    label: `Block ${profile.username || profile.displayName || 'user'}`,
                    destructive: true,
                    onClick: () => setBlockSheetOpen(true),
                  },
                  { label: 'Report', onClick: () => setReportProfileOpen(true) },
                ]
          }
        />

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
                  targetUserId={targetUserId}
                  isOwnProfile={isOwnProfile}
                  onEditFavorites={() => setShowFavPickerSheet(true)}
                  onShareFavorites={handleShareFavorites}
                  favSharing={favSharing}
                  pinnedLists={pinnedLists}
                  onListsChevron={() => setActiveTab('lists')}
                  allReviews={allReviews}
                  onReviewTap={(id) => navigate(`/review/${id}`)}
                  goalProgress={goalProgress}
                  rivalryData={rivalryData}
                  onSetGoal={() => setGoalSheetOpen(true)}
                  currentUserId={user?.id}
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
                  userId={targetUserId}
                  entries={journalEntries}
                  lifeReviews={allReviews.filter((r) => !!r.life_context)}
                  onEntryClick={(entryId) => navigate(`/journal/${entryId}`)}
                  onReviewClick={(reviewId) => navigate(`/reviews/${reviewId}/comments`)}
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
  targetUserId,
  isOwnProfile,
  onEditFavorites,
  onShareFavorites,
  favSharing,
  pinnedLists,
  onListsChevron,
  allReviews,
  onReviewTap,
  goalProgress,
  rivalryData,
  onSetGoal,
  currentUserId,
}) {
  const navigate = useNavigate()

  // Now Playing hero — derived from `activities` (see findNowPlaying).
  const nowPlaying = useMemo(() => findNowPlaying(activities), [activities])
  const nowPlayingTitle =
    nowPlaying?.gameTitle || nowPlaying?.metadata?.game_title || 'Unknown game'
  const nowPlayingImage =
    nowPlaying?.igdbGameId != null ? gameImageMap.get(String(nowPlaying.igdbGameId)) : null

  // Fallback year label while goalProgress is still resolving (null) —
  // never fabricates goal data, just labels the loading card correctly.
  const currentYear = goalProgress?.year ?? new Date().getFullYear()

  // Circle rank — global rank of "you" in the merged, sorted rivalry list.
  // This is the one thing that survives from the old Circle leaderboard.
  const circleRank = (() => {
    if (!goalProgress?.hasGoal || !rivalryData?.length) return null
    const withSelf = [
      { userId: 'self', current: goalProgress.current, isSelf: true },
      ...rivalryData.map((r) => ({ ...r, isSelf: false })),
    ].sort((a, b) => b.current - a.current || (a.isSelf ? -1 : 1))
    const idx = withSelf.findIndex((r) => r.isSelf)
    return idx === -1 ? null : idx + 1
  })()

  // Next milestone badge — same "closest to completion" pick the old
  // full badge rail used: highest in-progress ratio, else lowest-target
  // locked badge. Badges are local-device stats, so this only ever runs
  // for the signed-in user's own profile (useBadges gets a null userId
  // on visitor profiles and returns empty lists).
  const { earned, inProgress, locked, stats } = useBadges(isOwnProfile ? user?.id : null)
  const nextBadge = (() => {
    if (inProgress.length > 0) {
      return inProgress.reduce((best, b) => {
        const r = b.progress(stats) / b.target
        const br = best.progress(stats) / best.target
        return r > br ? b : best
      })
    }
    if (locked.length > 0) {
      return locked.reduce((best, b) => (b.target < best.target ? b : best))
    }
    return null
  })()

  const handleSeeAllBadges = () => {
    navigate(`/user/${encodeURIComponent(userIdentifier)}/badges`)
  }

  return (
    <div className="profile-home">
      {/* NOW PLAYING hero — the user's current "Playing" game, if any.
          Renders nothing when no game resolves (no fabricated state). */}
      {nowPlaying && (
        <section className="profile-home__section profile-home__section--card profile-now-playing" aria-label="Now playing">
          <button
            type="button"
            className="profile-now-playing__cover"
            onClick={() => onGameClick(nowPlaying.igdbGameId, nowPlayingImage)}
            aria-label={`Open ${nowPlayingTitle}`}
          >
            {nowPlayingImage ? (
              <img src={nowPlayingImage} alt="" loading="lazy" />
            ) : (
              <span className="profile-now-playing__fallback" aria-hidden="true">
                {nowPlayingTitle.charAt(0)}
              </span>
            )}
          </button>
          <div className="profile-now-playing__body">
            <span className="profile-now-playing__eyebrow">
              <span className="profile-now-playing__dot" aria-hidden="true" />
              Now playing
            </span>
            <button
              type="button"
              className="profile-now-playing__title"
              onClick={() => onGameClick(nowPlaying.igdbGameId, nowPlayingImage)}
            >
              {nowPlayingTitle}
            </button>
            <span className="profile-now-playing__started">
              Started {formatShortDate(nowPlaying.createdAt)}
            </span>
          </div>
          {isOwnProfile && (
            <button
              type="button"
              className="profile-now-playing__update"
              onClick={() => navigate(`/game/${nowPlaying.igdbGameId}`)}
              aria-label={`Update status for ${nowPlayingTitle}`}
            >
              Update
            </button>
          )}
        </section>
      )}

      {/* TASTE cell — persona pills + genre DNA (read-only from the
          cached E0 taste vector) above the avg rating + distribution.
          Hidden entirely when the user has zero reviews; the DNA/tags
          block independently hides itself when it has nothing real to
          derive (see ProfileTasteDNA). */}
      {allReviews.length > 0 && (
        <section className="profile-home__section profile-taste-section" aria-label="Taste">
          <div className="profile-home__section-header">
            <h3 className="profile-home__section-title">Taste</h3>
          </div>
          <ProfileTasteDNA userId={targetUserId} allReviews={allReviews} isOwnProfile={isOwnProfile} />
          <ProfileRatingsChart
            reviews={allReviews}
            onReviewTap={onReviewTap}
            currentUserId={currentUserId}
            hideTitle
          />
        </section>
      )}

      {/* FAVORITE GAMES cell — 3-up grid. Hidden when empty on others'
          profiles; own profile shows an empty-state CTA. */}
      {(favoriteGames.length > 0 || isOwnProfile) && (
        <section className="profile-home__section profile-home__section--card">
          <div className="profile-home__section-header">
            <h3 className="profile-home__section-title">Favorite Games</h3>
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
              {favoriteGames.slice(0, 3).map((g) => (
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
                  {g.why && (
                    <span className="profile-favorite-card__why">
                      {g.why}
                    </span>
                  )}
                </button>
              ))}
              {isOwnProfile && favoriteGames.length < 3 && (
                <button
                  type="button"
                  role="listitem"
                  className="profile-favorite-card profile-favorite-card--add"
                  onClick={onEditFavorites}
                  aria-label="Add a favorite game"
                >
                  <span className="profile-favorite-card__cover profile-favorite-card__cover--add">
                    <LuPlus size={22} aria-hidden="true" />
                  </span>
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Pinned Lists — hidden entirely when the user has no pinned
          lists; chevron routes to the Lists tab. */}
      <PinnedListsSection
        pinnedLists={pinnedLists}
        onSeeAll={onListsChevron}
      />

      {/* TWO-CELL ROW — Challenge (green) | Next milestone (own profile,
          cobalt). Challenge now renders on visitor profiles too once the
          owner actually has a goal set (user_goals RLS is privacy-aware,
          not owner-only — see migration profile_visitor_rls_fix); a
          visitor never sees the "Set a goal" CTA or an editable ring,
          since those are owner-only actions. Next milestone stays
          own-profile only — badge stats are signed-in-device-only data
          that can't be read for another user. */}
      {(isOwnProfile || goalProgress?.hasGoal) && (
        <div className="profile-bento-row">
          <section className="profile-home__section profile-home__section--card profile-challenge-cell" aria-label={`${goalProgress?.year ?? currentYear} challenge`}>
            <h3 className="profile-home__section-title profile-home__section-title--compact">
              {goalProgress?.year ?? currentYear} Challenge
            </h3>
            {goalProgress === null ? (
              // `null` = not resolved yet. Never render "Set a goal" or a
              // fabricated 0/0 here — a real goal could still come back.
              // (Visitors only reach this row once goalProgress.hasGoal is
              // already true, so this skeleton only ever shows on own profile.)
              <div className="profile-challenge-compact" aria-hidden="true">
                <Skeleton variant="circle" width={52} height={52} />
                <div className="profile-challenge-compact__info">
                  <Skeleton variant="text" width={48} height={18} />
                  <Skeleton variant="text" width={72} height={13} style={{ marginTop: 6 }} />
                </div>
              </div>
            ) : (
              <div className="profile-challenge-compact">
                <GoalRing
                  current={goalProgress.current}
                  target={goalProgress.target}
                  year={goalProgress.year}
                  variant="compact"
                  onSet={isOwnProfile ? onSetGoal : undefined}
                />
                <div className="profile-challenge-compact__info">
                  {goalProgress.hasGoal ? (
                    <>
                      <p className="profile-challenge-compact__headline">
                        {goalProgress.current}/{goalProgress.target}
                      </p>
                      <p className="profile-challenge-compact__sub">
                        {goalProgress.current >= goalProgress.target
                          ? 'Goal reached!'
                          : `${goalProgress.target - goalProgress.current} to go`}
                      </p>
                    </>
                  ) : isOwnProfile ? (
                    <button
                      type="button"
                      className="profile-challenge-compact__set-goal"
                      onClick={onSetGoal}
                    >
                      Set a {goalProgress.year} goal
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            {circleRank != null && (
              <p className="profile-challenge-compact__circle">
                {circleRank === 1 ? '🥇 ' : ''}#{circleRank} in your circle
              </p>
            )}
          </section>

          {nextBadge && (
            <section className="profile-home__section profile-home__section--card profile-next-badge-cell" aria-label="Next milestone">
              <h3 className="profile-home__section-title profile-home__section-title--compact">
                Next milestone
              </h3>
              <button
                type="button"
                className="profile-next-badge"
                onClick={handleSeeAllBadges}
                aria-label={`Next badge: ${nextBadge.name}, ${nextBadge.progress(stats)} of ${nextBadge.target}`}
              >
                <span className="profile-next-badge__icon" aria-hidden="true">
                  <nextBadge.icon size={20} strokeWidth={1.7} />
                </span>
                <span className="profile-next-badge__body">
                  <span className="profile-next-badge__name">{nextBadge.name}</span>
                  <span
                    className="profile-next-badge__track"
                    role="progressbar"
                    aria-valuenow={nextBadge.progress(stats)}
                    aria-valuemin={0}
                    aria-valuemax={nextBadge.target}
                  >
                    <span
                      className="profile-next-badge__fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, (nextBadge.progress(stats) / nextBadge.target) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="profile-next-badge__count">
                    {nextBadge.progress(stats)} / {nextBadge.target}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="profile-next-badge__earned-link"
                onClick={handleSeeAllBadges}
              >
                {earned.length} earned →
              </button>
            </section>
          )}
        </div>
      )}

      {/* ACTIVITY footer — vertical timeline, day-grouped, milestone tags */}
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

const DIARY_VIBE_LABELS = {
  masterpiece: 'Masterpiece',
  underrated:  'Underrated',
  mid:         'Mid',
  rage_quit:   'Rage Quit',
  comfort:     'Comfort',
}

const DIARY_LIFE_LABELS = {
  childhood:   'Childhood',
  teen_years:  'Teen Years',
  college:     'College',
  burnout:     'Burnout',
  healing:     'Healing',
  traveling:   'Traveling',
  new_chapter: 'New Chapter',
}

const DiaryChevron = () => (
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
)

function DiaryTab({ userId, entries, lifeReviews = [], onEntryClick, onReviewClick }) {
  // Merge journal entries and life-tagged reviews, sorted newest-first.
  const merged = React.useMemo(() => {
    const journalItems = (entries || []).map((e) => ({ ...e, _type: 'journal' }))
    const reviewItems = (lifeReviews || []).map((r) => ({ ...r, _type: 'review' }))
    return [...journalItems, ...reviewItems].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )
  }, [entries, lifeReviews])

  if (merged.length === 0) {
    return (
      <div className="profile-diary">
        <div className="profile-diary__empty">
          <p className="profile-diary__empty-text">No diary entries yet.</p>
          <p className="profile-diary__empty-sub">
            Add journal notes while playing, or tag a review with a life moment.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="profile-diary">
      {/* On This Day — hides itself when there are no prior-year matches */}
      {userId && <OnThisDaySection userId={userId} />}

      <ul className="profile-diary__list" aria-label="Diary">
        {merged.map((item) => {
          if (item._type === 'review') {
            const lifeLabel = DIARY_LIFE_LABELS[item.life_context] || item.life_context
            const vibeLabel = item.vibe_stamp ? DIARY_VIBE_LABELS[item.vibe_stamp] : null
            return (
              <li key={`review-${item.id}`} className="profile-diary__row profile-diary__row--review">
                <button
                  type="button"
                  className="profile-diary__row-btn"
                  onClick={() => onReviewClick?.(item.id)}
                  aria-label={`Review of ${item.game_title || 'game'} — ${lifeLabel}`}
                >
                  {item.game_image ? (
                    <img
                      src={item.game_image}
                      alt={item.game_title || ''}
                      className="profile-diary__cover"
                    />
                  ) : (
                    <div className="profile-diary__cover profile-diary__cover--placeholder" aria-hidden="true" />
                  )}
                  <div className="profile-diary__meta">
                    <p className="profile-diary__game-title">
                      {item.game_title || 'Unknown game'}
                    </p>
                    <div className="profile-diary__life-row">
                      <span className="profile-diary__life-pill">{lifeLabel}</span>
                      {vibeLabel && (
                        <span
                          className="profile-diary__vibe-pill"
                          data-vibe={item.vibe_stamp}
                        >
                          {vibeLabel}
                        </span>
                      )}
                    </div>
                    <time
                      className="profile-diary__date"
                      dateTime={item.created_at}
                      title={new Date(item.created_at).toLocaleString()}
                    >
                      {formatDiaryDate(item.created_at)}
                    </time>
                    {item.body ? (
                      <p className="profile-diary__snippet">
                        {item.body.slice(0, 100)}{item.body.length > 100 ? '…' : ''}
                      </p>
                    ) : null}
                  </div>
                  <DiaryChevron />
                </button>
              </li>
            )
          }

          // Journal entry row
          const moodMeta = item.mood ? getMoodMeta(item.mood) : null
          const hoursLabel = item.hours_played != null
            ? `${item.hours_played} hr${item.hours_played !== 1 ? 's' : ''}`
            : null

          return (
            <li key={`journal-${item.id}`} className="profile-diary__row">
              <button
                type="button"
                className="profile-diary__row-btn"
                onClick={() => onEntryClick(item.id)}
                aria-label={`Open journal entry: ${item.title || item.game_title || 'entry'}`}
              >
                {item.game_image ? (
                  <img
                    src={item.game_image}
                    alt={item.game_title || ''}
                    className="profile-diary__cover"
                  />
                ) : (
                  <div className="profile-diary__cover profile-diary__cover--placeholder" aria-hidden="true" />
                )}
                <div className="profile-diary__meta">
                  <p className="profile-diary__game-title">
                    {item.game_title || 'Unknown game'}
                  </p>
                  {item.title && (
                    <p className="profile-diary__entry-title">{item.title}</p>
                  )}
                  {/* Mood + hours inline pills */}
                  {(moodMeta || hoursLabel) && (
                    <div className="profile-diary__pills-row">
                      {moodMeta && (
                        <span className="profile-diary__mood-pill">
                          {moodMeta.emoji} {moodMeta.label}
                        </span>
                      )}
                      {hoursLabel && (
                        <span className="profile-diary__hours-pill">⏱ {hoursLabel}</span>
                      )}
                    </div>
                  )}
                  <time
                    className="profile-diary__date"
                    dateTime={item.created_at}
                    title={new Date(item.created_at).toLocaleString()}
                  >
                    {formatDiaryDate(item.created_at)}
                  </time>
                  {item.is_spoiler ? (
                    <p className="profile-diary__snippet profile-diary__snippet--spoiler">
                      [spoiler]
                    </p>
                  ) : item.body ? (
                    <p className="profile-diary__snippet">
                      {item.body.slice(0, 100)}{item.body.length > 100 ? '…' : ''}
                    </p>
                  ) : null}
                </div>
                <DiaryChevron />
              </button>
            </li>
          )
        })}
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
