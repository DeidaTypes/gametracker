import { lazy } from 'react'

/**
 * Pushed screens only. The four tab roots (Home, Discover, Library,
 * Profile) stay static imports in App.jsx so a tab tap never waits on
 * a chunk. Visitor Profile uses that same Profile module, so it stays
 * in the main chunk too.
 *
 * Each loader caches its promise. Prefetch and React.lazy share it, so
 * a push after idle does not start a second download.
 */
const loaders = []

function lazyRoute(loader) {
  let pending = null
  const load = () => {
    if (!pending) pending = loader()
    return pending
  }
  loaders.push(load)
  return lazy(load)
}

export const ActivityCalendar = lazyRoute(() => import('../pages/ActivityCalendar'))
export const CategoryResults = lazyRoute(() => import('../pages/CategoryResults'))
export const ChallengeDetail = lazyRoute(() => import('../pages/ChallengeDetail'))
export const CurrentlyPlaying = lazyRoute(() => import('../pages/CurrentlyPlaying'))
export const DeveloperDetail = lazyRoute(() => import('../pages/DeveloperDetail'))
export const DiscoverCollectionsAll = lazyRoute(() => import('../pages/DiscoverCollectionsAll'))
export const DiscoverNewAll = lazyRoute(() => import('../pages/DiscoverNewAll'))
export const DiscoverReviewsAll = lazyRoute(() => import('../pages/DiscoverReviewsAll'))
export const GameDetail = lazyRoute(() => import('../pages/GameDetail'))
export const GameReviewsAll = lazyRoute(() => import('../pages/GameReviewsAll'))
export const GameSessions = lazyRoute(() => import('../pages/GameSessions'))
export const JournalEntry = lazyRoute(() => import('../pages/JournalEntry'))
export const JournalNew = lazyRoute(() => import('../pages/JournalNew'))
export const ListDetail = lazyRoute(() => import('../pages/ListDetail'))
export const MessagesInbox = lazyRoute(() => import('../pages/MessagesInbox'))
export const MessagesThread = lazyRoute(() => import('../pages/MessagesThread'))
export const Moderation = lazyRoute(() => import('../pages/Moderation'))
export const NotificationsInbox = lazyRoute(() => import('../pages/NotificationsInbox'))
export const ReviewComments = lazyRoute(() => import('../pages/ReviewComments'))
export const ReviewDetail = lazyRoute(() => import('../pages/ReviewDetail'))
export const ReviewNew = lazyRoute(() => import('../pages/ReviewNew'))
export const PlusPaywall = lazyRoute(() => import('../pages/PlusPaywall'))
export const Reviews = lazyRoute(() => import('../pages/Reviews'))
export const Search = lazyRoute(() => import('../pages/Search'))
export const Settings = lazyRoute(() => import('../pages/Settings'))
export const SettingsAccessibility = lazyRoute(() => import('../pages/SettingsAccessibility'))
export const SettingsAccount = lazyRoute(() => import('../pages/SettingsAccount'))
export const SettingsAppearance = lazyRoute(() => import('../pages/SettingsAppearance'))
export const SettingsBlocked = lazyRoute(() => import('../pages/SettingsBlocked'))
export const SettingsEmail = lazyRoute(() => import('../pages/SettingsEmail'))
export const SettingsHelp = lazyRoute(() => import('../pages/SettingsHelp'))
export const SettingsNotifications = lazyRoute(() => import('../pages/SettingsNotifications'))
export const SettingsPassword = lazyRoute(() => import('../pages/SettingsPassword'))
export const SettingsPrivacy = lazyRoute(() => import('../pages/SettingsPrivacy'))
export const SmartListDetail = lazyRoute(() => import('../pages/SmartListDetail'))
export const Stats = lazyRoute(() => import('../pages/Stats'))
export const ThemedDropDetail = lazyRoute(() => import('../pages/ThemedDropDetail'))
export const UserActivity = lazyRoute(() => import('../pages/UserActivity'))
export const UserBadgesPage = lazyRoute(() => import('../pages/UserBadgesPage'))
export const UserFollowers = lazyRoute(() => import('../pages/UserFollowers'))
export const UserFollowing = lazyRoute(() => import('../pages/UserFollowing'))
export const UserLibrary = lazyRoute(() => import('../pages/UserLibrary'))
export const Wishlist = lazyRoute(() => import('../pages/Wishlist'))
export const QaBestAnswers = lazyRoute(() => import('../pages/qa/QaBestAnswers'))
export const QaGame = lazyRoute(() => import('../pages/qa/QaGame'))
export const QaMine = lazyRoute(() => import('../pages/qa/QaMine'))
export const QaQuestion = lazyRoute(() => import('../pages/qa/QaQuestion'))
export const QaSearch = lazyRoute(() => import('../pages/qa/QaSearch'))

/**
 * Warm every pushed-route chunk, plus the libraries those screens pull
 * in only when they render. Called once Home has painted, from idle.
 */
export function prefetchLazyRoutes() {
  for (const load of loaders) {
    load().catch(() => {})
  }
  import('lottie-react').catch(() => {})
  import('../assets/lottie/celebration.json').catch(() => {})
  import('recharts').catch(() => {})
  import('qrcode').catch(() => {})
}
