/**
 * Local settings search catalog. One entry per real row on the hub and
 * its sub-screens. Nothing here is fetched.
 *
 * `section` is where the row lives: "Settings" for hub rows, otherwise
 * the sub-screen title. `route` is the screen a result opens. Hub actions
 * that stay on the hub (edit profile, invite, sign out) have no route.
 */

import { APP_VERSION, PRIVACY_URL, RATE_APP_URL, SUPPORT_EMAIL, TERMS_URL } from './site'

const WORD = /[a-z0-9]/i

function wordStartIndex(text, query) {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  if (!q || q.length > lower.length) return -1
  for (let i = 0; i <= lower.length - q.length; i += 1) {
    if (i > 0 && WORD.test(lower[i - 1])) continue
    if (lower.startsWith(q, i)) return i
  }
  return -1
}

/**
 * First range in `label` to draw semibold. Word-start wins over a
 * mid-word hit. Keyword-only matches return null — the label itself
 * has no matched letters.
 */
export function labelMatchRange(label, query) {
  const q = String(query || '').trim()
  if (!q || !label) return null
  const start = wordStartIndex(label, q)
  if (start >= 0) return [start, start + q.length]
  const lower = label.toLowerCase()
  const idx = lower.indexOf(q.toLowerCase())
  if (idx >= 0) return [idx, idx + q.length]
  return null
}

function scoreEntry(entry, query) {
  const labelWord = wordStartIndex(entry.label, query) >= 0
  const labelContains = !labelWord && entry.label.toLowerCase().includes(query)
  let keywordWordHits = 0
  let keywordContainsHits = 0
  for (let i = 0; i < entry.keywords.length; i += 1) {
    const keyword = String(entry.keywords[i]).toLowerCase()
    if (wordStartIndex(keyword, query) >= 0) keywordWordHits += 1
    else if (keyword.includes(query)) keywordContainsHits += 1
  }

  // Lower score ranks first. Word-start label hits beat keyword hits,
  // which beat a match buried mid-word.
  let score = null
  if (labelWord) score = 0
  else if (keywordWordHits > 0) score = 1
  else if (labelContains) score = 2
  else if (keywordContainsHits > 0) score = 3
  if (score == null) return null

  const hits = (labelWord || labelContains ? 1 : 0) + keywordWordHits + keywordContainsHits
  return { score, hits }
}

const ALL_SETTINGS_ENTRIES = [
  {
    id: 'edit-profile',
    label: 'Edit profile',
    section: 'Settings',
    route: null,
    keywords: ['name', 'avatar', 'bio', 'username', 'photo'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    section: 'Settings',
    route: '/settings/appearance',
    keywords: ['theme', 'dark', 'light', 'color', 'cream', 'navy', 'pink'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    section: 'Settings',
    route: '/settings/accessibility',
    keywords: ['a11y', 'motion', 'text', 'contrast'],
  },
  {
    id: 'account',
    label: 'Account',
    section: 'Settings',
    route: '/settings/account',
    keywords: ['login', 'user', 'profile'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    section: 'Settings',
    route: '/settings/notifications',
    keywords: ['push', 'alerts', 'bell', 'notify'],
  },
  {
    id: 'privacy',
    label: 'Privacy & safety',
    section: 'Settings',
    route: '/settings/privacy',
    keywords: ['private', 'safety', 'block'],
  },
  {
    id: 'invite',
    label: 'Invite friends',
    section: 'Settings',
    route: null,
    keywords: ['share', 'invite', 'link', 'friends'],
  },
  {
    id: 'help',
    label: 'Help & about',
    section: 'Settings',
    route: '/settings/help',
    keywords: ['about', 'support', 'help', 'feedback'],
  },
  {
    id: 'sign-out',
    label: 'Sign out',
    section: 'Settings',
    route: null,
    keywords: ['logout', 'log out', 'signout'],
  },

  {
    id: 'email',
    label: 'Email',
    section: 'Account',
    route: '/settings/account',
    keywords: ['address', 'mail', 'inbox'],
  },
  {
    id: 'password',
    label: 'Password',
    section: 'Account',
    route: '/settings/account',
    keywords: ['login', 'security'],
  },
  {
    id: 'delete-account',
    label: 'Delete account',
    section: 'Account',
    route: '/settings/account',
    keywords: ['remove', 'close', 'delete'],
  },

  {
    id: 'match-iphone',
    label: 'Match iPhone light and dark',
    section: 'Appearance',
    route: '/settings/appearance',
    keywords: ['match', 'iphone', 'system', 'automatic'],
  },

  {
    id: 'color-blind',
    label: 'Color-blind mode',
    section: 'Accessibility',
    route: '/settings/accessibility',
    keywords: ['colorblind', 'protan', 'deutan', 'tritan'],
  },
  {
    id: 'reduce-motion',
    label: 'Reduce motion',
    section: 'Accessibility',
    route: '/settings/accessibility',
    keywords: ['animation', 'motion'],
  },
  {
    id: 'larger-text',
    label: 'Larger text',
    section: 'Accessibility',
    route: '/settings/accessibility',
    keywords: ['font', 'size', 'text'],
  },

  {
    id: 'notif-follows',
    label: 'Follows',
    section: 'Notifications',
    route: '/settings/notifications',
    keywords: ['push', 'follower', 'followers'],
  },
  {
    id: 'notif-likes',
    label: 'Likes',
    section: 'Notifications',
    route: '/settings/notifications',
    keywords: ['push', 'like', 'reaction'],
  },
  {
    id: 'notif-comments',
    label: 'Comments and mentions',
    section: 'Notifications',
    route: '/settings/notifications',
    keywords: ['push', 'comment', 'mention', 'reply'],
  },
  {
    id: 'notif-qa',
    label: 'Q&A',
    section: 'Notifications',
    route: '/settings/notifications',
    keywords: ['push', 'question', 'answer', 'stuck', 'best'],
  },
  {
    id: 'notif-friends',
    label: "Friends' activity",
    section: 'Notifications',
    route: '/settings/notifications',
    keywords: ['push', 'friends', 'started', 'playing'],
  },

  {
    id: 'message-me',
    label: 'Message me',
    section: 'Privacy & safety',
    route: '/settings/privacy',
    keywords: ['message', 'dm', 'privacy', 'inbox'],
  },
  {
    id: 'see-activity',
    label: 'See my activity',
    section: 'Privacy & safety',
    route: '/settings/privacy',
    keywords: ['private', 'privacy', 'activity', 'visibility'],
  },
  {
    id: 'blocked',
    label: 'Blocked users',
    section: 'Privacy & safety',
    route: '/settings/privacy',
    keywords: ['block', 'blocked', 'mute'],
  },

  {
    id: 'feedback',
    label: 'Send feedback',
    section: 'Help & about',
    route: '/settings/help',
    keywords: ['email', 'bug', 'support'],
  },
  {
    id: 'rate',
    label: 'Rate the app',
    section: 'Help & about',
    route: '/settings/help',
    keywords: ['review', 'stars', 'store'],
  },
  {
    id: 'privacy-policy',
    label: 'Privacy Policy',
    section: 'Help & about',
    route: '/settings/help',
    keywords: ['legal', 'policy'],
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    section: 'Help & about',
    route: '/settings/help',
    keywords: ['legal', 'tos', 'agreement'],
  },
  {
    id: 'version',
    label: 'Version',
    section: 'Help & about',
    route: '/settings/help',
    keywords: ['build', 'about'],
  },
]

// Help rows that need a configured value are not rendered when it is missing
// (see src/pages/SettingsHelp.jsx), so they must not be searchable either.
const ROW_AVAILABLE = {
  feedback: Boolean(SUPPORT_EMAIL),
  rate: Boolean(RATE_APP_URL),
  'privacy-policy': Boolean(PRIVACY_URL),
  terms: Boolean(TERMS_URL),
  version: Boolean(APP_VERSION),
}

const SETTINGS_INDEX = ALL_SETTINGS_ENTRIES.filter((entry) => ROW_AVAILABLE[entry.id] !== false)

/**
 * Matching sections stay in app order. Inside a section, word-start
 * label matches come first, then keyword matches. A query that hits
 * more of an entry's words ranks above a weaker one ("priv" hits both
 * "private" and "privacy" on See my activity, so that row leads
 * Message me). Ties keep catalog order.
 */
export function searchSettings(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  const hits = []
  for (let index = 0; index < SETTINGS_INDEX.length; index += 1) {
    const entry = SETTINGS_INDEX[index]
    const ranked = scoreEntry(entry, q)
    if (!ranked) continue
    hits.push({ entry, index, ...ranked })
  }

  const sectionOrder = []
  const grouped = new Map()
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]
    const key = hit.entry.section
    if (!grouped.has(key)) {
      grouped.set(key, [])
      sectionOrder.push(key)
    }
    grouped.get(key).push(hit)
  }

  const ordered = []
  for (let s = 0; s < sectionOrder.length; s += 1) {
    const group = grouped.get(sectionOrder[s])
    group.sort((a, b) => a.score - b.score || b.hits - a.hits || a.index - b.index)
    for (let i = 0; i < group.length; i += 1) ordered.push(group[i].entry)
  }
  return ordered
}

export default SETTINGS_INDEX
