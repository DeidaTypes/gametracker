import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  LuChevronLeft,
  LuChevronRight,
  LuPlay,
  LuCheck,
  LuStar,
  LuPlus,
  LuShare2,
  LuUserPlus,
  LuPin,
  LuArrowUpDown,
} from 'react-icons/lu'
import { HiDotsVertical } from 'react-icons/hi'
import { SlidersHorizontal } from 'lucide-react'
import {
  FaInstagram,
  FaXTwitter,
  FaYoutube,
  FaTiktok,
} from 'react-icons/fa6'
import { useAuth } from '../contexts/AuthContext'
import { getReviewsForUser } from '../services/reviewService'
import { getListsForUser } from '../services/listService'
import { getProfile, initializeProfile, generateDefaultAvatar } from '../services/profileService'
import { getActivitiesForUser } from '../services/activityService'
import {
  followUser,
  unfollowUser,
  isFollowing as fetchIsFollowing,
  getFollowerCount,
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
import { fetchUserBannerUrl } from '../services/storageService'
import EditProfileModal from '../components/EditProfileModal'
import CreateListModal from '../components/CreateListModal'
import BadgesRow from '../components/BadgesRow'
import ReviewCard from '../components/ReviewCard'
import ReorderPinsModal from '../components/ReorderPinsModal'
import SortSheet from '../components/SortSheet'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { createList, addGameToList } from '../services/listService'
import { showToast } from '../components/Toast'
import './Profile.css'

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
      username:
        row.users?.username || row.users?.display_name || 'Anonymous',
      avatarUrl: row.users?.avatar_url || '',
    },
    title: null,
    body: row.body || '',
    rating: Number(row.rating) || 0,
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
  const { userId } = useParams()
  const { user } = useAuth()

  // /profile (no param) is always the signed-in user. /user/:username
  // routes will pass `userId` once Sprint 6 wires that surface.
  const isOwnProfile = !userId
  const targetUserId = userId || user?.id

  // Local profile blob (display name / avatar / bio / socials / favorites).
  // Lives in localStorage for the signed-in user; for "another user"
  // viewing we'd fetch from Supabase but Sprint 5 only wires the own-
  // profile UX so we still source everything from localStorage here.
  const [profile, setProfile] = useState(null)

  // Tabs: 'home' (default), 'reviews', 'lists'
  const [activeTab, setActiveTab] = useState('home')

  // Modals / sheets
  const [showEditModal, setShowEditModal] = useState(false)
  const [showSortSheet, setShowSortSheet] = useState(false)
  const [showCreateListModal, setShowCreateListModal] = useState(false)

  // Header kebab dropdown
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef(null)

  // Sort selection — same shape as before so callers downstream still
  // read a `{ reviews, lists }` object.
  const [activeSort, setActiveSort] = useState(readSortFromStorage)

  // Data
  const [allReviews, setAllReviews] = useState([])
  const [customLists, setCustomLists] = useState([])
  const [activities, setActivities] = useState([])
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

  // ── Follow graph (Sprint 6) ─────────────────────────────────────
  // followersCount is the count shown on the Followers stat numeral.
  // `following` is the state of the Follow / Following toggle on
  // another user's profile (always false on own). `followPending`
  // debounces rapid taps so the optimistic UI doesn't race itself.
  const [followersCount, setFollowersCount] = useState(0)
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
    const userProfile = getProfile() || initializeProfile()
    setProfile(userProfile)

    if (targetUserId) {
      try {
        // Sprint 6 P3 — pins fetched in parallel with the main reviews
        // load so the Pinned section paints in the same frame as the
        // sorted list below it. The pinned-review IDs are then merged
        // into the like/comment prefetch below so cards in the Pinned
        // section render with filled hearts + accurate comment counts.
        const [rows, lists, acts, pins] = await Promise.all([
          getReviewsForUser(targetUserId),
          getListsForUser(targetUserId),
          getActivitiesForUser(targetUserId, { limit: 8 }),
          getPinsForUser(targetUserId),
        ])
        setAllReviews(rows)
        setPinnedRows(pins)
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
            prefetchLikeStatesForReviews(ids),
            getCommentCountsForReviews(ids),
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
        setReviewLikeCounts(new Map())
        setPinnedRows([])
      }
    } else {
      setAllReviews([])
      setCustomLists([])
      setActivities([])
      setReviewLikeCounts(new Map())
      setPinnedRows([])
    }
  }, [targetUserId])

  useEffect(() => {
    loadProfileData()
    const refresh = () => loadProfileData()
    window.addEventListener('storage', refresh)
    window.addEventListener('reviewAdded', refresh)
    window.addEventListener('profileUpdated', refresh)
    window.addEventListener('libraryUpdated', refresh)
    window.addEventListener('activityUpdated', refresh)
    // Sprint 6 P3 — pin changes triggered from a ReviewCard kebab can
    // be either on this profile (own) or on a card embedded in some
    // other screen (Home/Game detail). Either way we re-load so the
    // Pinned section stays in sync without a hard refresh.
    window.addEventListener(PIN_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('reviewAdded', refresh)
      window.removeEventListener('profileUpdated', refresh)
      window.removeEventListener('libraryUpdated', refresh)
      window.removeEventListener('activityUpdated', refresh)
      window.removeEventListener(PIN_CHANGED_EVENT, refresh)
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
      const [followers, amFollowing] = await Promise.all([
        getFollowerCount(targetUserId),
        isOwnProfile ? Promise.resolve(false) : fetchIsFollowing(targetUserId),
      ])
      setFollowersCount(followers)
      setFollowing(amFollowing)
    } catch (err) {
      console.error('[profile] follow state load failed:', err)
    }
  }, [targetUserId, isOwnProfile])

  useEffect(() => {
    loadFollowState()
  }, [loadFollowState])

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

  /* ── Action handlers ──────────────────────────────────────────── */

  const handleProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile)
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

  if (!profile) {
    return (
      <div className="profile-page" aria-hidden="true">
        <div className="profile-header">
          <div className="profile-header__row1">
            <span className="profile-header__back" />
            <span className="profile-header__title-sk skeleton" />
            <span className="profile-header__actions-sk skeleton" />
          </div>
          <div className="profile-header__row2">
            <div className="skeleton profile-header__avatar-sk" />
            <div className="profile-header__stats-sk">
              <div className="skeleton profile-header__stat-sk" />
              <div className="skeleton profile-header__stat-sk" />
              <div className="skeleton profile-header__stat-sk" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── Display data ─────────────────────────────────────────────── */

  const defaultAvatar = generateDefaultAvatar(profile.displayName || 'User')
  const avatarDisplay = profile.avatar?.type === 'data' ? profile.avatar.data : null

  // Sprint 7 — own profile reads from localStorage blob; other profiles
  // use the Supabase-fetched value loaded in `loadProfileData`.
  const displayBannerUrl = isOwnProfile
    ? (profile.bannerUrl || null)
    : otherUserBannerUrl

  // Sprint 1 P5 preserved: username is the centered serif label. Falls
  // back to displayName if the user hasn't set a username yet (so the
  // header never reads "@undefined" or empty).
  const headerUsername =
    profile.username?.trim() || profile.displayName?.trim() || 'You'

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
  const homeRecentActivity = activities.slice(0, 8)

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="profile-page">
        {/* ═════════════════════════════════════════════════════════
            HEADER — six rows in fixed order
            ═════════════════════════════════════════════════════════ */}
        <header className="profile-header">
          {/* Row 1 — top nav */}
          <div className="profile-header__row1">
            <button
              type="button"
              className="profile-header__icon-btn"
              onClick={() => navigate(-1)}
              aria-label="Go back"
            >
              <LuChevronLeft size={22} aria-hidden="true" />
            </button>
            <h1 className="profile-header__username">{headerUsername}</h1>
            <div className="profile-header__nav-actions">
              {showFilterIcon && (
                <button
                  type="button"
                  className="profile-header__icon-btn"
                  aria-label="Sort options"
                  onClick={() => setShowSortSheet(true)}
                >
                  <SlidersHorizontal size={20} aria-hidden="true" />
                </button>
              )}
              <div className="profile-header__kebab-wrap" ref={kebabRef}>
                <button
                  type="button"
                  className="profile-header__icon-btn"
                  aria-label="More options"
                  aria-expanded={kebabOpen}
                  onClick={() => setKebabOpen((v) => !v)}
                >
                  <HiDotsVertical size={20} aria-hidden="true" />
                </button>
                {kebabOpen && (
                  <div className="profile-header__kebab-menu" role="menu">
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
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Banner — full-bleed strip above the avatar row.
              Only rendered when a banner_url is set; absent means flat
              surface background with no negative margin on the avatar. */}
          {displayBannerUrl && (
            <div className="profile-header__banner" aria-hidden="true">
              <img
                src={displayBannerUrl}
                alt=""
                className="profile-header__banner-img"
                loading="lazy"
              />
            </div>
          )}

          {/* Row 2 — avatar + 3 stat numerals */}
          <div className={`profile-header__row2${displayBannerUrl ? ' profile-header__row2--has-banner' : ''}`}>
            <button
              type="button"
              className={`profile-header__avatar${isOwnProfile ? ' profile-header__avatar--editable' : ''}`}
              onClick={() => isOwnProfile && setShowEditModal(true)}
              aria-label={isOwnProfile ? 'Edit profile' : 'Profile avatar'}
            >
              {avatarDisplay ? (
                <img
                  src={avatarDisplay}
                  alt={profile.displayName}
                  className="profile-header__avatar-img"
                />
              ) : (
                <div
                  className="profile-header__avatar-fallback"
                  style={{ backgroundColor: defaultAvatar.color }}
                >
                  {defaultAvatar.initials}
                </div>
              )}
            </button>

            <div className="profile-header__stats" role="group" aria-label="Profile stats">
              <button
                type="button"
                className="profile-header__stat"
                onClick={() => setActiveTab('reviews')}
                aria-label={`${reviewCount} reviews — view reviews tab`}
              >
                <span className="profile-header__stat-value">{reviewCount}</span>
                <span className="profile-header__stat-label">Reviews</span>
              </button>
              <button
                type="button"
                className="profile-header__stat"
                onClick={() => navigate('/library?status=played')}
                aria-label={`${playedCount} played games`}
              >
                <span className="profile-header__stat-value">{playedCount}</span>
                <span className="profile-header__stat-label">Played</span>
              </button>
              <button
                type="button"
                className="profile-header__stat"
                onClick={() => {
                  const handle =
                    profile.username || profile.displayName || 'user'
                  navigate(`/user/${encodeURIComponent(handle)}/followers`)
                }}
                aria-label={`${followersCount} followers — view list`}
              >
                <span className="profile-header__stat-value">{followersCount}</span>
                <span className="profile-header__stat-label">Followers</span>
              </button>
            </div>
          </div>

          {/* Row 3 — display name */}
          <div className="profile-header__row3">
            <h2 className="profile-header__display-name">
              {profile.displayName}
            </h2>
          </div>

          {/* Row 4 — bio (Sprint 1 P5: empty-state CTA preserved on own profile) */}
          {(() => {
            if (profile.bio) {
              return (
                <div className="profile-header__row4">
                  <p className="profile-header__bio">{profile.bio}</p>
                </div>
              )
            }
            if (isOwnProfile) {
              return (
                <div className="profile-header__row4">
                  <button
                    type="button"
                    className="profile-header__bio-cta"
                    onClick={() => setShowEditModal(true)}
                  >
                    Tell people what you play →
                  </button>
                </div>
              )
            }
            return null
          })()}

          {/* Row 5 — social links + share */}
          <div className="profile-header__row5">
            <div className="profile-header__socials">
              {setSocials.map((p) => {
                const handle = (profile[p.profileField] || '').trim()
                const Icon = p.Icon
                return (
                  <button
                    type="button"
                    key={p.key}
                    className="profile-header__social"
                    onClick={() => openExternalLink(p.url(handle))}
                    aria-label={`Open ${p.key} profile @${handle}`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="profile-header__social-handle">
                      @{handle}
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="profile-header__share"
              onClick={handleShareProfile}
              aria-label="Share profile"
            >
              <LuShare2 size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Row 6 — actions */}
          <div className="profile-header__row6">
            {isOwnProfile ? (
              <button
                type="button"
                className="profile-header__edit-btn"
                onClick={() => setShowEditModal(true)}
              >
                Edit Profile
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`profile-header__follow-btn${
                    following ? ' profile-header__follow-btn--following' : ''
                  }`}
                  onClick={handleFollowToggle}
                  disabled={followPending}
                  aria-pressed={following}
                  aria-label={following ? 'Unfollow' : 'Follow'}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
                <button
                  type="button"
                  className="profile-header__msg-btn"
                  onClick={() => {
                    // Sprint 6 P2 — DMs are real now. Route to the
                    // thread page using the partner's username (or a
                    // sensible fallback). If no thread exists yet, the
                    // thread page renders empty and the user can send
                    // the first message from there.
                    const handle =
                      profile?.username ||
                      profile?.displayName ||
                      ''
                    if (!handle) return
                    navigate(`/messages/${encodeURIComponent(handle)}`)
                  }}
                >
                  Send Message
                </button>
                <button
                  type="button"
                  className={`profile-header__follow-icon-btn${
                    following ? ' profile-header__follow-icon-btn--following' : ''
                  }`}
                  onClick={handleFollowToggle}
                  disabled={followPending}
                  aria-pressed={following}
                  aria-label={following ? 'Unfollow' : 'Follow'}
                >
                  <LuUserPlus size={18} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </header>

        {/* ═════════════════════════════════════════════════════════
            TAB BAR — Home / Reviews / Lists (Popular/New styling)
            ═════════════════════════════════════════════════════════ */}
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          {[
            { id: 'home', label: 'Home' },
            { id: 'reviews', label: 'Reviews' },
            { id: 'lists', label: 'Lists' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`profile-tab${activeTab === tab.id ? ' profile-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═════════════════════════════════════════════════════════
            TAB CONTENT
            ═════════════════════════════════════════════════════════ */}
        <div className="profile-tab-content">
          {activeTab === 'home' && (
            <HomeTab
              favoriteGames={favoriteGames}
              activities={homeRecentActivity}
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
              onWriteReview={() => navigate('/review/new')}
              currentUserId={user?.id}
              onPinReview={handlePinReview}
              onUnpinReview={handleUnpinReview}
              onOpenReorder={() => setShowReorderModal(true)}
            />
          )}

          {activeTab === 'lists' && (
            <ListsTab
              lists={sortedLists}
              isOwnProfile={isOwnProfile}
              onTapList={(id) => navigate(`/list/${id}`)}
              onCreateList={() => setShowCreateListModal(true)}
              authorUsername={profile.username || profile.displayName || ''}
              authorAvatarUrl={avatarDisplay}
              authorAvatarFallback={defaultAvatar}
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
}) {
  return (
    <div className="profile-home">
      {/* Section 1 — Favorite Games (hidden when empty) */}
      {favoriteGames.length > 0 && (
        <section className="profile-home__section">
          <h3 className="profile-home__section-title">Favorite Games</h3>
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
        </section>
      )}

      {/* Section 2 — Badges (Sprint 5 P9). BadgesRow owns its own
          section header + chevron so it can disappear entirely when
          there are zero earned + zero in-progress badges (it returns
          null in that case). Wrapping it in a bare <section> here
          would leave an empty container in the DOM. */}
      <BadgesRow user={user} username={userIdentifier} />

      {/* Section 3 — Recent Activity */}
      <section className="profile-home__section">
        <div className="profile-home__section-header">
          <h3 className="profile-home__section-title">Recent Activity</h3>
          <button
            type="button"
            className="profile-home__chevron-btn"
            onClick={onActivityChevron}
            aria-label="See full activity log"
          >
            <LuChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        {activities.length === 0 ? (
          <p className="profile-home__empty">No activity yet.</p>
        ) : (
          <div className="profile-activity-row" role="list">
            {activities.map((a) => {
              const ActivityIcon = getActivityIcon(a)
              const image = a.igdbGameId
                ? gameImageMap.get(String(a.igdbGameId))
                : null
              const targetHref = a.igdbGameId
                ? `/game/${a.igdbGameId}`
                : a.targetId
                ? `/list/${a.targetId}`
                : null
              return (
                <button
                  key={a.id}
                  type="button"
                  role="listitem"
                  className="profile-activity-thumb"
                  onClick={() => {
                    if (a.igdbGameId) {
                      onGameClick(a.igdbGameId, image)
                    } else if (targetHref) {
                      window.location.assign(targetHref)
                    }
                  }}
                  aria-label={a.gameTitle || 'Activity'}
                >
                  <div className="profile-activity-thumb__cover">
                    {image ? (
                      <img src={image} alt="" loading="lazy" />
                    ) : (
                      <span className="profile-activity-thumb__fallback">
                        {(a.gameTitle || '?').charAt(0)}
                      </span>
                    )}
                    <span className="profile-activity-thumb__icon" aria-hidden="true">
                      <ActivityIcon size={12} />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
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
  onWriteReview,
  currentUserId,
  onPinReview,
  onUnpinReview,
  onOpenReorder,
}) {
  const hasPins = pinnedRows.length > 0

  if (!hasPins && reviews.length === 0) {
    return (
      <div className="profile-reviews">
        <div className="profile-empty">
          <p className="profile-empty__copy">No reviews yet</p>
          {isOwnProfile && (
            <button
              type="button"
              className="profile-empty__cta"
              onClick={onWriteReview}
            >
              Write a review
            </button>
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
  onTapList,
  onCreateList,
  authorUsername,
  authorAvatarUrl,
  authorAvatarFallback,
}) {
  if (lists.length === 0) {
    return (
      <div className="profile-lists">
        <div className="profile-empty">
          <p className="profile-empty__copy">No lists yet</p>
          {isOwnProfile && (
            <button
              type="button"
              className="profile-empty__cta"
              onClick={onCreateList}
            >
              Create a list
            </button>
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
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/* List row matches Musicboard reference image #2: 6-cover horizontal
   mosaic strip on top, then list name (bold), description (1 line),
   author row, and a like/comment/share row at the bottom. */
function ListRow({
  list,
  onTap,
  authorUsername,
  authorAvatarUrl,
  authorAvatarFallback,
}) {
  const slots = Array.from({ length: 6 }, (_, i) => list.previewGames?.[i] || null)
  return (
    <article className="profile-list-row" onClick={onTap}>
      <div className="profile-list-row__mosaic">
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
            @{authorUsername || 'you'}
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
        </div>
      </div>
    </article>
  )
}

export default Profile
