/**
 * Vercel Serverless Function — Open Graph HTML generator.
 *
 * Called by middleware.js when a social crawler (Facebook, Twitter/X, Slack,
 * iMessage, Discord, etc.) fetches a content URL. Returns a minimal but
 * complete HTML page whose <head> is packed with the OG / Twitter Card meta
 * tags that produce rich link previews. The <body> contains a redirect so
 * any regular browser that somehow lands here gets bounced to the SPA page.
 *
 * Supported paths (matched by middleware.js):
 *   /review/:id   → review title, game, rating, reviewer
 *   /reviews/:id  → same (alias)
 *   /user/:handle → display name, bio, avatar
 *   /list/:id     → list title, description, owner
 *   /game/:id     → generic game page (IGDB data not available server-side)
 *
 * Data source: Supabase REST API using the public anon key — all relevant
 * tables are RLS-public for SELECT by anonymous users.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const APP_ORIGIN = 'https://gametracker.app'
const DEFAULT_IMAGE = `${APP_ORIGIN}/og-default.png`

// ── Supabase REST helper ───────────────────────────────────────────────────

async function sbFetch(table, params) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
        'Accept-Profile': 'public',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) ? data[0] ?? null : data
  } catch {
    return null
  }
}

// ── Entity fetchers ───────────────────────────────────────────────────────

async function fetchReview(id) {
  const row = await sbFetch('reviews', {
    select: 'id,body,rating,game_title,game_image,user_id',
    id: `eq.${id}`,
    limit: 1,
  })
  if (!row) return null

  const user = await sbFetch('users', {
    select: 'username,display_name',
    id: `eq.${row.user_id}`,
    limit: 1,
  })

  return {
    title: `${user?.display_name || 'Someone'}'s review of ${row.game_title || 'a game'}`,
    description: (row.body || '').slice(0, 160).replace(/\s+$/, '') + (row.body?.length > 160 ? '…' : ''),
    image: normalizeImageUrl(row.game_image),
    url: `${APP_ORIGIN}/review/${id}`,
  }
}

async function fetchUser(username) {
  const row = await sbFetch('users', {
    select: 'username,display_name,bio,avatar_url',
    'username': `ilike.${username}`,
    limit: 1,
  })
  if (!row) return null
  return {
    title: `${row.display_name || row.username || username} on Checkpoint`,
    description: row.bio || 'Check out their game library and reviews on Checkpoint.',
    image: row.avatar_url || DEFAULT_IMAGE,
    url: `${APP_ORIGIN}/user/${row.username || username}`,
  }
}

async function fetchList(id) {
  const row = await sbFetch('lists', {
    select: 'id,title,description,user_id,cover_image_url',
    id: `eq.${id}`,
    limit: 1,
  })
  if (!row) return null

  const user = await sbFetch('users', {
    select: 'display_name,username',
    id: `eq.${row.user_id}`,
    limit: 1,
  })

  return {
    title: `${row.title || 'A list'} — by ${user?.display_name || 'Checkpoint user'}`,
    description: row.description || 'A curated list of games on Checkpoint.',
    image: normalizeImageUrl(row.cover_image_url) || DEFAULT_IMAGE,
    url: `${APP_ORIGIN}/list/${id}`,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeImageUrl(url) {
  if (!url) return DEFAULT_IMAGE
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('http')) return url
  return DEFAULT_IMAGE
}

function escape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtml({ title, description, image, url }) {
  const t = escape(title)
  const d = escape(description)
  const i = escape(image || DEFAULT_IMAGE)
  const u = escape(url || APP_ORIGIN)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${t}</title>
  <meta name="description" content="${d}" />

  <!-- Open Graph -->
  <meta property="og:type"        content="website" />
  <meta property="og:site_name"   content="Checkpoint" />
  <meta property="og:title"       content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url"         content="${u}" />
  <meta property="og:image"       content="${i}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:site"        content="@gametracker" />
  <meta name="twitter:title"       content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image"       content="${i}" />

  <!-- Redirect real browsers to the SPA -->
  <meta http-equiv="refresh" content="0;url=${u}" />
  <link rel="canonical" href="${u}" />
</head>
<body>
  <p>Redirecting to <a href="${u}">${t}</a>…</p>
</body>
</html>`
}

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const rawPath = req.query?.path || '/'

  // Parse entity type + ID from the path.
  const reviewMatch = rawPath.match(/^\/reviews?\/([^/?#]+)/)
  const userMatch = rawPath.match(/^\/user\/([^/?#]+)/)
  const listMatch = rawPath.match(/^\/list\/([^/?#]+)/)
  const gameMatch = rawPath.match(/^\/game\/([^/?#]+)/)

  let meta = null

  if (reviewMatch) {
    meta = await fetchReview(reviewMatch[1])
  } else if (userMatch) {
    meta = await fetchUser(userMatch[1])
  } else if (listMatch) {
    meta = await fetchList(listMatch[1])
  } else if (gameMatch) {
    meta = {
      title: 'Checkpoint — Discover & Track Games',
      description: 'Track what you play, write reviews, and discover new titles.',
      image: DEFAULT_IMAGE,
      url: `${APP_ORIGIN}${rawPath}`,
    }
  }

  // Fallback for unmatched paths or Supabase errors.
  if (!meta) {
    meta = {
      title: 'Checkpoint — Your Video Game Library',
      description: 'Track what you play, write reviews, and discover new titles.',
      image: DEFAULT_IMAGE,
      url: `${APP_ORIGIN}${rawPath}`,
    }
  }

  const html = buildHtml(meta)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  res.status(200).send(html)
}
