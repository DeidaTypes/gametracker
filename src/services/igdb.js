// IGDB API Service
// You'll need to get your Client ID and Client Secret from:
// https://dev.twitch.tv/console/apps
// Then get an access token from: https://id.twitch.tv/oauth2/token

import { normalizeGame, normalizeGames } from './normalizeGame'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'
import { buildWhyLine } from './swipeService'

// IGDB documents a soft cap of ~4 requests/second per Twitch app token with
// bursts of up to 8 in-flight. We sit well under that with the per-batch
// `getDiscoveryDeck` pattern (one multiquery + occasional taste-seed lookup),
// but a lightweight throttle is cheap insurance for refill bursts.
const RATE_WINDOW_MS = 1000
const RATE_MAX_REQUESTS = 4
const rateWindow = []
async function throttleIgdb() {
  while (true) {
    const now = Date.now()
    while (rateWindow.length && now - rateWindow[0] >= RATE_WINDOW_MS) {
      rateWindow.shift()
    }
    if (rateWindow.length < RATE_MAX_REQUESTS) {
      rateWindow.push(now)
      return
    }
    const wait = RATE_WINDOW_MS - (now - rateWindow[0]) + 5
    await new Promise((r) => setTimeout(r, wait))
  }
}

/**
 * Run a timeout-wrapped fetch, retrying ONCE on a transient connection
 * failure (timeout / network drop / aborted socket). This is the
 * "fail fast and retry" half of the resume-recovery story: the very first
 * IGDB request after the app returns from background can ride a socket the
 * OS tore down while the WebView was suspended. fetchWithTimeout guarantees
 * that stale request rejects quickly (instead of spinning forever); this
 * wrapper then transparently retries on a brand-new connection so the user
 * sees games load rather than an error banner.
 *
 * Only rejections (timeout/network) are retried — an HTTP response that
 * arrives with a non-2xx status resolves normally and is handled by the
 * caller, so we never retry a genuine 400/401.
 */
async function fetchIgdbWithRetry(input, init, retries = 1) {
  try {
    return await fetchWithTimeout(input, init)
  } catch (err) {
    if (retries > 0) {
      return fetchIgdbWithRetry(input, init, retries - 1)
    }
    throw err
  }
}

const CLIENT_ID = import.meta.env.VITE_IGDB_CLIENT_ID || 'YOUR_CLIENT_ID'
const CLIENT_SECRET = import.meta.env.VITE_IGDB_CLIENT_SECRET || 'YOUR_CLIENT_SECRET'

// Deployed Supabase Edge Function that owns the Twitch OAuth flow and forwards
// queries to IGDB. Preferred path: works from anywhere (including a physical
// iPhone running the Capacitor build, which cannot reach the dev localhost) and
// keeps the IGDB client ID / secret server-side.
const PROXY_URL = (import.meta.env.VITE_IGDB_PROXY_URL || '').replace(/\/$/, '')

// Supabase anon key — required by the Edge Function gateway as an Authorization
// bearer token. Without it the platform rejects the request with 401 before it
// ever reaches the igdb-proxy function.
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Legacy base URL for the pass-through proxy. Empty in dev → relative paths hit
// the Vite dev-server proxy (vite.config.js). Only used when VITE_IGDB_PROXY_URL
// is not set (e.g. local web dev without the Edge Function).
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// Debug: Log if credentials are loaded (without exposing secrets). When the
// Edge Function proxy is configured the client doesn't need IGDB credentials,
// so the warning is only relevant for the legacy pass-through path.
if (!PROXY_URL) {
  if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
    console.warn('⚠️ IGDB API credentials not found! Make sure you have a .env file with VITE_IGDB_CLIENT_ID and VITE_IGDB_CLIENT_SECRET')
  } else {
    console.log('✅ IGDB API credentials loaded successfully')
  }
} else {
  console.log('✅ IGDB requests routed through Supabase Edge Function proxy')
}

let tokenCache = { token: null, expiresAt: 0 }
let tokenFlight = null

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  if (tokenFlight) return tokenFlight

  tokenFlight = fetchNewToken().finally(() => { tokenFlight = null })
  return tokenFlight
}

async function fetchNewToken() {
  if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
    throw new Error(
      'IGDB API credentials not configured. Please create a .env file with:\nVITE_IGDB_CLIENT_ID=your_client_id\nVITE_IGDB_CLIENT_SECRET=your_client_secret'
    )
  }

  const response = await fetchIgdbWithRetry(`${API_BASE}/api/twitch/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 400) {
      throw new Error('Invalid API credentials. Please check your CLIENT_ID and CLIENT_SECRET in the .env file.')
    } else if (response.status === 401) {
      throw new Error('Unauthorized. Your API credentials may be incorrect. Please verify them at https://dev.twitch.tv/console/apps')
    }
    throw new Error(`Failed to get access token: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  if (!data.access_token) {
    throw new Error('Failed to get access token: Invalid response from Twitch')
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 3600) * 1000,
  }
  return tokenCache.token
}

// ── Response cache — deduplicates concurrent identical IGDB queries ──────────

const responseCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const inflightRequests = new Map()

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
}

function extractCoverUrl(game) {
  if (game.cover?.image_id) return coverUrlFromImageId(game.cover.image_id)
  if (game.cover?.url) return `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
  return null
}

export async function igdbRequest(endpoint, query) {
  const cacheKey = `${endpoint}::${query}`

  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    if (import.meta.env.DEV) console.log(`[⏱ igdb] cache HIT (${cacheKey.slice(0,60)})`)
    return cached.data
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey)
  }

  const request = executeIgdbRequest(endpoint, query, cacheKey)
  inflightRequests.set(cacheKey, request)
  request.finally(() => inflightRequests.delete(cacheKey))

  return request
}

async function executeIgdbRequest(endpoint, query, cacheKey) {
  // Preferred path: the Supabase Edge Function authenticates with Twitch
  // server-side, so the client just sends { endpoint, query }.
  if (PROXY_URL) {
    return executeViaEdgeProxy(endpoint, query, cacheKey)
  }

  const token = await getAccessToken()

  await throttleIgdb()
  const response = await fetchIgdbWithRetry(`${API_BASE}/api/igdb/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${token}`,
    },
    body: query,
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 401) {
      tokenCache = { token: null, expiresAt: 0 }
      throw new Error('Unauthorized. Your access token may have expired or your API credentials are invalid.')
    } else if (response.status === 400) {
      throw new Error(`Invalid API request: ${errorText}`)
    }
    throw new Error(`IGDB API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()

  responseCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL })

  return data
}

// Edge Function path — POST { endpoint, query } to the deployed igdb-proxy and
// return the IGDB JSON. Twitch auth happens server-side inside the function.
async function executeViaEdgeProxy(endpoint, query, cacheKey) {
  await throttleIgdb()
  const _t0 = Date.now()
  const response = await fetchIgdbWithRetry(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SUPABASE_ANON_KEY
        ? {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          }
        : {}),
    },
    body: JSON.stringify({ endpoint, query }),
  })

  if (import.meta.env.DEV) console.log(`[⏱ igdb] EdgeProxy TTFB (${endpoint}): ${Date.now() - _t0}ms`)
  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 401) {
      throw new Error('Unauthorized. The IGDB proxy could not authenticate with Twitch — check the TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET Edge Function secrets.')
    } else if (response.status === 400) {
      throw new Error(`Invalid API request: ${errorText}`)
    }
    throw new Error(`IGDB API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  if (import.meta.env.DEV) console.log(`[⏱ igdb] EdgeProxy total (${endpoint}, query=${query.slice(0,40).replace(/\n/g,' ')}…): ${Date.now() - _t0}ms, rows=${Array.isArray(data)?data.length:'?'}`)

  responseCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL })

  return data
}

export async function getPopularGames(limit = 50) {
  const fiveYearsAgo = Math.floor(Date.now() / 1000) - (5 * 31536000)

  const query = `fields name, cover.image_id, genres.name, rating, rating_count, summary, first_release_date;
where cover != null & rating != null & rating_count != null & first_release_date >= ${fiveYearsAgo} & rating_count > 10;
sort rating_count desc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)

    if (games.length < limit) {
      const relaxedQuery = `fields name, cover.image_id, genres.name, rating, rating_count, summary, first_release_date;
where cover != null & rating != null & first_release_date >= ${fiveYearsAgo};
sort rating_count desc;
limit ${limit};`
      return formatGames(await igdbRequest('games', relaxedQuery))
    }

    return formatGames(games)
  } catch (error) {
    console.error('Error in getPopularGames:', error)
    try {
      const fallbackQuery = `fields name, cover.image_id, genres.name, rating, rating_count, summary, first_release_date;
where cover != null & rating != null & first_release_date >= ${fiveYearsAgo};
sort rating desc;
limit ${limit};`
      return formatGames(await igdbRequest('games', fallbackQuery))
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError)
      throw error
    }
  }
}

/**
 * Upcoming releases — games whose first_release_date falls within the
 * next 30 days. Sorted ascending so the soonest releases appear first.
 */
export async function getUpcomingReleases(limit = 30) {
  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysFromNow = now + (30 * 24 * 60 * 60)

  // Explore's NewReleaseCard only needs name + cover + release date.
  // Removed: genres.name, rating, rating_count, summary, involved_companies.company.name
  // (each extra field adds IGDB query cost; involved_companies requires a subquery join).
  const query = `fields name, cover.image_id, first_release_date;
where first_release_date > ${now} & first_release_date < ${thirtyDaysFromNow} & cover != null;
sort first_release_date asc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    return formatUpcomingGames(games)
  } catch (error) {
    console.error('Error in getUpcomingReleases:', error)
    return []
  }
}

// Upcoming-release formatter: keeps IGDB asc release order (don't re-sort by rating).
function formatUpcomingGames(games) {
  return normalizeGames(
    games
      .filter((game) => game.name)
      .map((game) => {
        const coverUrl = extractCoverUrl(game)

        let releaseDate = null
        let year = null
        if (game.first_release_date) {
          releaseDate = new Date(game.first_release_date * 1000)
          year = releaseDate.getFullYear()
        }

        return {
          id: game.id,
          title: game.name,
          developer: game.involved_companies?.[0]?.company?.name || 'Unknown',
          genre: game.genres?.map((g) => g.name).join(', ') || 'Unknown',
          rating: game.rating ? (game.rating / 20).toFixed(1) : null,
          year,
          image: coverUrl,
          description: game.summary || '',
          releaseDate,
        }
      }),
    'igdb'
  )
}

// NOTE: getRecentReleasesForDiscover / getRecentReleasesPage (the old
// date-only "New & Notable" queries) were removed — that section is now
// served entirely from the new_notable_pool cache table, gated by the
// release check + two-lane notability check in
// supabase/functions/new-notable/lanes.ts.
// See src/services/newNotableService.js. Live IGDB is touched only by the
// daily new-notable Edge Function, never on an Explore view.

export async function getRecentlyReleasedGames(limit = 30) {
  const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)
  const now = Math.floor(Date.now() / 1000)

  const query = `fields name, cover.image_id, genres.name, rating, rating_count, first_release_date;
where first_release_date >= ${oneYearAgo} & first_release_date <= ${now} & cover != null & rating != null;
sort first_release_date desc;
limit ${limit};`

  try {
    return formatGames(await igdbRequest('games', query))
  } catch (error) {
    console.error('Error in getRecentlyReleasedGames:', error)
    throw error
  }
}

export async function getTopGamesOfTheWeek(limit = 20) {
  const twoWeeksAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60)
  const now = Math.floor(Date.now() / 1000)

  const query = `fields name, cover.image_id, genres.name, rating, rating_count, first_release_date;
where first_release_date >= ${twoWeeksAgo} & first_release_date <= ${now} & cover != null & rating != null & rating_count != null;
sort rating_count desc;
limit ${limit * 2};`

  try {
    let games = await igdbRequest('games', query)

    if (games.length < limit) {
      const threeMonthsAgo = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60)
      const fallbackQuery = `fields name, cover.image_id, genres.name, rating, rating_count, first_release_date;
where first_release_date >= ${threeMonthsAgo} & first_release_date <= ${now} & cover != null & rating != null;
sort rating_count desc;
limit ${limit * 2};`
      games = await igdbRequest('games', fallbackQuery)
    }

    return formatGames(games)
  } catch (error) {
    console.error('Error in getTopGamesOfTheWeek:', error)
    return getPopularGames(limit)
  }
}

/**
 * Sprint 5 P5: lightweight feed of popular games trending this week.
 * Used by the Home → Popular/New section ("Popular" tab). Returns the
 * compact { id, name, coverUrl, rating } shape — no DLC filtering, no
 * normalizeGame pass — because the caller renders covers in a 120px row,
 * not in the full library grid.
 *
 * Filter rationale:
 *   - rating_count > 5            → enough player ratings to be meaningful
 *   - cover != null               → no broken art in the row
 *   - first_release_date != null  → known release date (not a placeholder)
 *   - updated_at >= sevenDaysAgo  → recently active in IGDB (people are
 *                                   still talking about / patching it)
 */
export async function fetchPopularThisWeek() {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

  const query = `fields name, cover.image_id, rating;
where rating_count > 5 & cover != null & first_release_date != null & updated_at >= ${sevenDaysAgo};
sort rating_count desc;
limit 8;`

  try {
    const games = await igdbRequest('games', query)
    return shapeForCoverRow(games)
  } catch (err) {
    console.error('[igdb] fetchPopularThisWeek failed:', err)
    return []
  }
}

/**
 * Sprint 5 P5: brand-new releases from the last 7 days, ordered by hype.
 * Used by the Home → Popular/New section ("New" tab).
 */
export async function fetchNewThisWeek() {
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - 7 * 24 * 60 * 60

  const query = `fields name, cover.image_id, rating, hypes;
where first_release_date >= ${sevenDaysAgo} & first_release_date <= ${now} & cover != null;
sort hypes desc;
limit 8;`

  try {
    const games = await igdbRequest('games', query)
    return shapeForCoverRow(games)
  } catch (err) {
    console.error('[igdb] fetchNewThisWeek failed:', err)
    return []
  }
}

// Map raw IGDB rows into the compact shape the Home cover row expects.
// Rating is converted from IGDB's 0–100 scale to a 0–5 number (or null
// if absent) so the row can show "4.3" without each call site doing math.
function shapeForCoverRow(games) {
  return (games || [])
    .filter((g) => g && g.name && g.cover?.image_id)
    .map((g) => ({
      id: g.id,
      name: g.name,
      coverUrl: coverUrlFromImageId(g.cover.image_id),
      rating: typeof g.rating === 'number' ? g.rating / 20 : null,
    }))
}

// Genre/theme name -> IGDB id never changes, so once resolved it's cached
// for the life of the tab. Browse-category fetching calls getGamesByGenre
// for the same handful of genre names repeatedly (initial browse fetch,
// Search's genre cards, category-detail pages), and each call used to
// pay for a full "look up the id" round-trip before the actual games
// query could even start. Caching the id collapses that back down to a
// single hop after the first lookup.
const genreIdCache = new Map()
const themeIdCache = new Map()

async function resolveGenreId(genreName) {
  if (genreIdCache.has(genreName)) return genreIdCache.get(genreName)
  const genreQuery = `fields id;
where name = "${genreName}";`
  const genres = await igdbRequest('genres', genreQuery)
  if (genres.length === 0) return null
  const id = genres[0].id
  genreIdCache.set(genreName, id)
  return id
}

async function resolveThemeId(themeName) {
  if (themeIdCache.has(themeName)) return themeIdCache.get(themeName)
  const themeQuery = `fields id;
where name = "${themeName}";`
  const themes = await igdbRequest('themes', themeQuery)
  if (themes.length === 0) return null
  const id = themes[0].id
  themeIdCache.set(themeName, id)
  return id
}

/**
 * Fetch top games tagged with an IGDB *theme* (e.g. "Horror", "Sci-fi").
 * Themes are distinct from genres in IGDB — Horror is a theme, not a genre.
 */
export async function getGamesByTheme(themeName, limit = 30) {
  try {
    const themeId = await resolveThemeId(themeName)

    if (themeId == null) {
      console.warn(`Theme "${themeName}" not found`)
      return []
    }

    const sevenYearsAgo = Math.floor(Date.now() / 1000) - (7 * 31536000)

    const query = `fields name, cover.image_id, rating, rating_count, first_release_date;
where themes = ${themeId} & cover != null & rating != null & first_release_date >= ${sevenYearsAgo};
sort rating_count desc;
limit ${limit};`

    return formatGames(await igdbRequest('games', query))
  } catch (error) {
    console.error(`Error fetching games for theme ${themeName}:`, error)
    return []
  }
}

export async function getGamesByGenre(genreName, limit = 30) {
  try {
    const genreId = await resolveGenreId(genreName)

    if (genreId == null) {
      console.warn(`Genre "${genreName}" not found`)
      return []
    }

    const sevenYearsAgo = Math.floor(Date.now() / 1000) - (7 * 31536000)

    const query = `fields name, cover.image_id, rating, rating_count, first_release_date;
where genres = ${genreId} & cover != null & rating != null & first_release_date >= ${sevenYearsAgo};
sort rating_count desc;
limit ${limit};`

    return formatGames(await igdbRequest('games', query))
  } catch (error) {
    console.error(`Error fetching games for genre ${genreName}:`, error)
    return []
  }
}


// Filter out DLC, expansions, and special editions - keep only base games
function filterOutDLC(games) {
  if (!games || games.length === 0) {
    return []
  }
  
  // Patterns that indicate DLC, expansions, or special editions
  const dlcPatterns = [
    // ANY edition with a name before "Edition" (but keep "Remastered" and "Remake")
    /:\s*\w+\s+edition(?!.*remaster|.*remake)/i,  // ": Something Edition" (but not Remastered)
    /\s+edition$/i,  // "Name Edition" at end of title
    
    // DLC and expansions
    /:\s*(dlc|expansion|season pass|battle pass|content pack)/i,
    /\s+(dlc|expansion|season pass|battle pass|content pack|expansion pass)/i,
    
    // Specific DLC indicators - anything after colon that looks like subtitle DLC
    /:\s*(the\s+)?(echoes|rising|awakening|prophecy|legacy|shadow|wrath|age|dawn|dusk|fall|coming|fate|curse|valhalla)\s+(of|the)/i,
    /:\s*\w+\s+(tide|fallen|rising|darkness|light|storm)/i,
    /:\s*valhalla/i,  // God of War: Valhalla
    
    // Packs and bundles
    /\s+(pack|bundle|add-on|addon|cosmetic|skin|outfit)(?!\s+rat)/i, // "pack" but not "pack rat" game
    
    // Episode/Chapter DLC
    /:\s*episode\s+\d+/i,
    /:\s*chapter\s+\d+/i,
    
    // Specific edition markers at end of title
    /\s+-\s+.+\s+edition$/i,  // " - Something Edition" at end
    
    // Launch/Pre-order/Digital editions
    /:\s*(launch|pre-order|day one|digital|standard|physical)\s+edition/i,
  ]
  
  return games.filter(game => {
    const title = game.name || game.title || ''
    
    // Check if title matches any DLC pattern
    for (const pattern of dlcPatterns) {
      if (pattern.test(title)) {
        return false // Exclude this game
      }
    }
    
    return true // Keep this game
  })
}

// Search games — returns IGDB's natural relevance order.
// Ranking / re-ordering is handled entirely by searchService.rankGames().
export async function searchGames(searchTerm, limit = 30) {
  if (!searchTerm || !searchTerm.trim()) {
    return []
  }

  const escapedTerm = searchTerm.trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

  const fetchLimit = Math.min(limit * 4, 200)
  const query = `fields name, cover.image_id, genres.name, rating, rating_count, summary, involved_companies.company.name, first_release_date;
search "${escapedTerm}";
limit ${fetchLimit};`

  try {
    const games = await igdbRequest('games', query)

    const gamesWithCovers = games.filter(game => game.cover && (game.cover.image_id || game.cover.url))

    const baseGames = filterOutDLC(gamesWithCovers)

    return formatGamesRaw(baseGames.slice(0, limit * 2))
  } catch (error) {
    console.error('❌ Error in searchGames:', error)
    throw error
  }
}

/**
 * Search games combining an optional free-text term with IGDB where-clause
 * fragments produced by parseNaturalQuery.
 *
 * When `term` is non-empty the IGDB `search "…"` endpoint is used; the
 * extra where fragments narrow results (cover required is always added).
 * When `term` is empty the query becomes a pure filter with
 * `sort rating_count desc` so you get popular matching games.
 *
 * Falls back to plain searchGames(term) on any API error so the caller
 * never has to handle a structured-search failure itself.
 *
 * @param {string}   term            Free-text portion (may be empty string)
 * @param {string[]} whereFragments  IGDB where conditions to AND together
 * @param {number}   limit
 * @returns {Promise<Array>}
 */
export async function searchGamesWithFilters(term, whereFragments, limit = 30) {
  const hasTerm = Boolean(term && term.trim())
  const hasWhere = whereFragments && whereFragments.length > 0

  if (!hasTerm && !hasWhere) return []

  const combinedWhere = [
    ...(hasWhere ? whereFragments : []),
    'cover != null',
    'rating != null',
    'rating_count > 3',
  ].join(' & ')

  const fields =
    'fields name, cover.image_id, genres.name, rating, rating_count, summary, involved_companies.company.name, first_release_date;'

  const fetchLimit = Math.min(limit * 4, 200)

  let query
  if (hasTerm) {
    const escaped = term.trim()
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
    query = `${fields}\nsearch "${escaped}";\nwhere ${combinedWhere};\nlimit ${fetchLimit};`
  } else {
    query = `${fields}\nwhere ${combinedWhere};\nsort rating_count desc;\nlimit ${fetchLimit};`
  }

  try {
    const games = await igdbRequest('games', query)
    const filtered = filterOutDLC(
      games.filter((g) => g.cover && (g.cover.image_id || g.cover.url))
    )
    return formatGamesRaw(filtered.slice(0, limit * 2))
  } catch (err) {
    console.warn('[igdb] searchGamesWithFilters failed, falling back to plain search:', err)
    if (hasTerm) return searchGames(term, limit)
    return []
  }
}

/**
 * Fetch IDs of short games via the game_time_to_beats endpoint.
 * Used by the natural-query "short"/"quick" filter path in useSearch.
 *
 * @param {number} maxSecs  Upper bound for "normally" completion time (default 2700 = 45 min)
 * @param {number} maxIds   How many IDs to return (default 200)
 * @returns {Promise<number[]>}
 */
export async function fetchShortGameIds(maxSecs = 2700, maxIds = 200) {
  const ttbQuery =
    `fields game; where normally <= ${maxSecs} & normally != null; ` +
    `sort normally asc; limit ${maxIds};`
  try {
    const rows = await igdbRequest('game_time_to_beats', ttbQuery)
    return (rows || []).map((r) => Number(r.game)).filter(Boolean)
  } catch (err) {
    console.warn('[igdb] fetchShortGameIds failed:', err)
    return []
  }
}

// Get similar games by style (themes, player perspectives, game modes, keywords)
export async function getSimilarGamesByStyle(gameData, excludeGameId, limit = 20) {
  if (!gameData) {
    return []
  }

  try {
    console.log('🎨 Finding similar style games for:', gameData.title)
    console.log('📊 Game style data:', {
      themes: gameData.themes,
      playerPerspectives: gameData.playerPerspectives,
      gameModes: gameData.gameModes,
      keywords: gameData.keywords,
      genres: gameData.genres
    })
    
    const styleCriteria = []
    
    // Get theme IDs - use more themes for better matching
    if (gameData.themes && gameData.themes.length > 0) {
      for (const themeName of gameData.themes.slice(0, 5)) {
        try {
          const themeQuery = `fields id;
where name = "${themeName}";`
          const themes = await igdbRequest('themes', themeQuery)
          if (themes.length > 0) {
            styleCriteria.push({ type: 'theme', id: themes[0].id, name: themeName })
          }
        } catch (err) {
          console.warn(`Failed to get theme ID for "${themeName}":`, err)
        }
      }
    }
    
    // Get player perspective IDs
    if (gameData.playerPerspectives && gameData.playerPerspectives.length > 0) {
      for (const ppName of gameData.playerPerspectives.slice(0, 3)) {
        try {
          const ppQuery = `fields id;
where name = "${ppName}";`
          const perspectives = await igdbRequest('player_perspectives', ppQuery)
          if (perspectives.length > 0) {
            styleCriteria.push({ type: 'perspective', id: perspectives[0].id, name: ppName })
          }
        } catch (err) {
          console.warn(`Failed to get perspective ID for "${ppName}":`, err)
        }
      }
    }
    
    // Get game mode IDs
    if (gameData.gameModes && gameData.gameModes.length > 0) {
      for (const gmName of gameData.gameModes.slice(0, 3)) {
        try {
          const gmQuery = `fields id;
where name = "${gmName}";`
          const modes = await igdbRequest('game_modes', gmQuery)
          if (modes.length > 0) {
            styleCriteria.push({ type: 'mode', id: modes[0].id, name: gmName })
          }
        } catch (err) {
          console.warn(`Failed to get mode ID for "${gmName}":`, err)
        }
      }
    }
    
    // Get keyword IDs - keywords are very specific to gameplay style
    if (gameData.keywords && gameData.keywords.length > 0) {
      for (const keywordName of gameData.keywords.slice(0, 5)) {
        try {
          const keywordQuery = `fields id;
where name = "${keywordName}";`
          const keywords = await igdbRequest('keywords', keywordQuery)
          if (keywords.length > 0) {
            styleCriteria.push({ type: 'keyword', id: keywords[0].id, name: keywordName })
          }
        } catch (err) {
          console.warn(`Failed to get keyword ID for "${keywordName}":`, err)
        }
      }
    }

    console.log('✅ Style criteria found:', styleCriteria.length, styleCriteria.map(c => `${c.type}:${c.name}`))

    if (styleCriteria.length === 0) {
      // Fallback to genres if no style data available
      console.log('⚠️ No style criteria found, falling back to genre-based similarity')
      if (gameData.genres && gameData.genres.length > 0) {
        return getSimilarGames(gameData.genres, excludeGameId, limit)
      }
      return []
    }

    // Build query with style criteria - prioritize games that match multiple style elements
    const sevenYearsAgo = Math.floor(Date.now() / 1000) - (7 * 31536000)
    
    // Get IDs by type
    const themeIds = styleCriteria.filter(c => c.type === 'theme').map(c => c.id)
    const perspectiveIds = styleCriteria.filter(c => c.type === 'perspective').map(c => c.id)
    const modeIds = styleCriteria.filter(c => c.type === 'mode').map(c => c.id)
    const keywordIds = styleCriteria.filter(c => c.type === 'keyword').map(c => c.id)
    
    // Build where clause - require games to match multiple style elements for better accuracy
    // Use AND logic within each category, OR between categories, but prioritize multi-match
    const whereConditions = []
    if (themeIds.length > 0) {
      whereConditions.push(`themes = [${themeIds.join(',')}]`)
    }
    if (perspectiveIds.length > 0) {
      whereConditions.push(`player_perspectives = [${perspectiveIds.join(',')}]`)
    }
    if (modeIds.length > 0) {
      whereConditions.push(`game_modes = [${modeIds.join(',')}]`)
    }
    if (keywordIds.length > 0) {
      whereConditions.push(`keywords = [${keywordIds.join(',')}]`)
    }
    
    if (whereConditions.length === 0) {
      return []
    }
    
    // Use OR logic to find games matching any style criteria, then filter by match count
    const whereClause = whereConditions.join(' | ')
    
    const query = `fields name, cover.image_id, genres.name, rating, rating_count, first_release_date, themes.id, themes.name, player_perspectives.id, player_perspectives.name, game_modes.id, game_modes.name, keywords.id, keywords.name;
where (${whereClause}) & cover != null & id != ${excludeGameId};
limit ${limit * 5};`

    const games = await igdbRequest('games', query)
    
    console.log(`📦 Found ${games.length} potential style matches`)
    
    if (games.length === 0) {
      console.log('⚠️ No style-based games found')
      return []
    }
    
    // Score games by how many style elements they match - require multiple matches
    const gamesWithStyleScores = games.map(game => {
      let styleScore = 0
      let matchCount = 0 // Count how many different style categories match
      
      // Check theme matches
      if (themeIds.length > 0 && game.themes) {
        const gameThemeIds = game.themes.map(t => {
          if (typeof t === 'object' && t.id) return t.id
          if (typeof t === 'number') return t
          return null
        }).filter(Boolean)
        const matchingThemes = themeIds.filter(id => gameThemeIds.includes(id)).length
        if (matchingThemes > 0) {
          styleScore += matchingThemes * 5 // Themes weighted much higher
          matchCount++
        }
      }
      
      // Check perspective matches
      if (perspectiveIds.length > 0 && game.player_perspectives) {
        const gamePPIds = game.player_perspectives.map(pp => {
          if (typeof pp === 'object' && pp.id) return pp.id
          if (typeof pp === 'number') return pp
          return null
        }).filter(Boolean)
        const matchingPP = perspectiveIds.filter(id => gamePPIds.includes(id)).length
        if (matchingPP > 0) {
          styleScore += matchingPP * 4 // Perspectives weighted high
          matchCount++
        }
      }
      
      // Check mode matches
      if (modeIds.length > 0 && game.game_modes) {
        const gameModeIds = game.game_modes.map(gm => {
          if (typeof gm === 'object' && gm.id) return gm.id
          if (typeof gm === 'number') return gm
          return null
        }).filter(Boolean)
        const matchingModes = modeIds.filter(id => gameModeIds.includes(id)).length
        if (matchingModes > 0) {
          styleScore += matchingModes * 3
          matchCount++
        }
      }
      
      // Check keyword matches - keywords are very specific to gameplay style
      if (keywordIds.length > 0 && game.keywords) {
        const gameKeywordIds = game.keywords.map(k => {
          if (typeof k === 'object' && k.id) return k.id
          if (typeof k === 'number') return k
          return null
        }).filter(Boolean)
        const matchingKeywords = keywordIds.filter(id => gameKeywordIds.includes(id)).length
        if (matchingKeywords > 0) {
          styleScore += matchingKeywords * 6 // Keywords weighted highest - most specific to style
          matchCount++
        }
      }
      
      // Bonus for matching multiple categories
      if (matchCount >= 2) {
        styleScore += 10 // Bonus for multi-category matches
      }
      if (matchCount >= 3) {
        styleScore += 20 // Bigger bonus for triple matches
      }
      
      return { ...game, styleScore, matchCount }
    })
    
    // Filter out games with very low style scores (require at least 2 matches or high keyword match)
    const qualityMatches = gamesWithStyleScores.filter(game => {
      return game.styleScore >= 5 || game.matchCount >= 2
    })
    
    console.log(`🎯 Quality matches: ${qualityMatches.length} games with style score >= 5 or 2+ category matches`)
    
    // Sort by style score first (highest first), then by match count, then rating
    const sortedGames = qualityMatches
      .sort((a, b) => {
        // First sort by style score
        const styleDiff = b.styleScore - a.styleScore
        if (styleDiff !== 0) return styleDiff
        
        // Then by match count (more categories matched = better)
        const matchDiff = b.matchCount - a.matchCount
        if (matchDiff !== 0) return matchDiff
        
        // Then by rating
        if (a.rating && b.rating) {
          return b.rating - a.rating
        }
        if (a.rating_count && b.rating_count) {
          return b.rating_count - a.rating_count
        }
        return 0
      })
      .slice(0, limit)
    
    console.log(`✨ Top style matches:`, sortedGames.slice(0, 5).map(g => ({ 
      name: g.name, 
      styleScore: g.styleScore, 
      matchCount: g.matchCount 
    })))
    
    // Remove styleScore and matchCount before formatting
    const gamesToFormat = sortedGames.map(({ styleScore, matchCount, ...game }) => game)
    
    if (gamesToFormat.length === 0) {
      console.log('⚠️ No quality style matches found after filtering')
      // Don't fallback to generic games - return empty rather than showing irrelevant games
      return []
    }
    
    return formatGames(gamesToFormat)
  } catch (error) {
    console.error('❌ Error fetching similar games by style:', error)
    return []
  }
}

// Get similar games based on genres (excluding the current game)
export async function getSimilarGames(gameGenres, excludeGameId, limit = 20) {
  if (!gameGenres || gameGenres.length === 0) {
    // Fallback: get popular games if no genres
    try {
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    } catch (err) {
      console.error('Error fetching fallback popular games:', err)
      return []
    }
  }

  try {
    // Get genre IDs for all genres
    const genreIds = []
    for (const genreName of gameGenres.slice(0, 3)) { // Use up to 3 genres
      try {
        const genreQuery = `fields id;
where name = "${genreName}";`
        const genres = await igdbRequest('genres', genreQuery)
        if (genres.length > 0) {
          genreIds.push(genres[0].id)
        }
      } catch (err) {
        console.warn(`Failed to get genre ID for "${genreName}":`, err)
      }
    }

    if (genreIds.length === 0) {
      // Fallback: get popular games
      console.log('No genre IDs found, falling back to popular games')
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    }

    // Get games that share at least one genre, excluding the current game
    // More lenient - don't require first_release_date filter
    const tenYearsAgo = Math.floor(Date.now() / 1000) - (10 * 31536000)
    
    const query = `fields name, cover.image_id, genres.name, rating, rating_count, first_release_date;
where genres = [${genreIds.join(',')}] & cover != null & id != ${excludeGameId};
sort rating desc;
limit ${limit * 3};`

    const games = await igdbRequest('games', query)
    
    if (games.length === 0) {
      // Fallback: get popular games
      console.log('No games found with genres, falling back to popular games')
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    }
    
    // Format and sort by rating (highest to lowest)
    const formattedGames = formatGames(games)
      .filter(game => game.id !== excludeGameId) // Double-check exclusion
      .slice(0, limit) // Limit results
    
    return formattedGames.length > 0 ? formattedGames : []
  } catch (error) {
    console.error('Error fetching similar games:', error)
    // Fallback: get popular games
    try {
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    } catch (fallbackErr) {
      console.error('Fallback also failed:', fallbackErr)
      return []
    }
  }
}

// Get games by developer name — searches IGDB companies, then fetches their games
export async function getGamesByDeveloper(developerName, limit = 50) {
  if (!developerName || !developerName.trim()) return { company: null, games: [] }

  const escaped = developerName.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  try {
    const companyQuery = `fields id, name, description, logo.url;
where name ~ "${escaped}"*;
limit 1;`
    const companies = await igdbRequest('companies', companyQuery)

    if (companies.length === 0) {
      const fuzzyQuery = `fields id, name, description, logo.url;
search "${escaped}";
limit 1;`
      const fuzzyResult = await igdbRequest('companies', fuzzyQuery)
      if (fuzzyResult.length === 0) return { company: null, games: [] }
      companies.push(fuzzyResult[0])
    }

    const company = companies[0]
    let logoUrl = null
    if (company.logo?.url) {
      logoUrl = `https:${company.logo.url.replace('t_thumb', 't_logo_med')}`
    }

    const icQuery = `fields game.name, game.cover.image_id, game.genres.name, game.rating, game.rating_count, game.summary, game.first_release_date, game.involved_companies.company.name;
where company = ${company.id} & developer = true;
limit ${limit};`
    const involvedCompanies = await igdbRequest('involved_companies', icQuery)

    const games = involvedCompanies
      .filter(ic => ic.game && ic.game.name && ic.game.cover?.image_id)
      .map(ic => {
        const g = ic.game
        const coverUrl = coverUrlFromImageId(g.cover?.image_id)
        const year = g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null
        const genres = g.genres?.map(gr => gr.name).join(', ') || 'Unknown'
        const developer = g.involved_companies?.[0]?.company?.name || company.name
        const rating = g.rating ? (g.rating / 20).toFixed(1) : null

        return {
          id: g.id,
          title: g.name,
          developer,
          genre: genres,
          rating,
          year,
          image: coverUrl,
          description: g.summary || '',
        }
      })
      .sort((a, b) => {
        const rA = parseFloat(a.rating) || 0
        const rB = parseFloat(b.rating) || 0
        if (rB !== rA) return rB - rA
        return (b.year || 0) - (a.year || 0)
      })

    return {
      company: { id: company.id, name: company.name, description: company.description || null, logo: logoUrl },
      games: normalizeGames(games, 'igdb'),
    }
  } catch (error) {
    console.error('Error in getGamesByDeveloper:', error)
    throw error
  }
}

export async function getGameById(gameId) {
  const query = `fields name, cover.image_id, genres.name, rating, summary, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, platforms.name, screenshots.url, first_release_date, websites.url, videos.video_id, themes.name, player_perspectives.name, game_modes.name, keywords.name, similar_games;
where id = ${gameId};`

  try {
    const games = await igdbRequest('games', query)
    if (games.length === 0) {
      throw new Error('Game not found')
    }
    return formatGameDetails(games[0])
  } catch (error) {
    console.error('Error in getGameById:', error)
    throw error
  }
}

/**
 * Batch-fetch lightweight game records by a list of numeric IGDB IDs.
 * Used to resolve the `similar_games` IDs returned by getGameById.
 */
export async function getGamesByIds(ids) {
  if (!ids || ids.length === 0) return []
  const limited = ids.slice(0, 12)
  const query = `fields name, cover.image_id, genres.name, rating, first_release_date, involved_companies.company.name, involved_companies.developer;
where id = (${limited.join(',')});
limit ${limited.length};`
  try {
    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (err) {
    console.error('Error in getGamesByIds:', err)
    return []
  }
}

// Format detailed game data
function formatGameDetails(game) {
  const coverUrl = extractCoverUrl(game)

  const releaseDate = game.first_release_date
    ? new Date(game.first_release_date * 1000)
    : null
  const year = releaseDate ? releaseDate.getFullYear() : null

  const genres = game.genres?.map((g) => g.name) || []
  const platforms = game.platforms?.map((p) => p.name) || []
  const themes = game.themes?.map((t) => t.name) || []
  const playerPerspectives = game.player_perspectives?.map((pp) => pp.name) || []
  const gameModes = game.game_modes?.map((gm) => gm.name) || []
  const keywords = game.keywords?.map((k) => k.name) || []

  // Get developers and publishers
  const developers = game.involved_companies
    ?.filter((ic) => ic.developer)
    .map((ic) => ic.company?.name)
    .filter(Boolean) || []
  
  const publishers = game.involved_companies
    ?.filter((ic) => ic.publisher)
    .map((ic) => ic.company?.name)
    .filter(Boolean) || []

  const screenshots = game.screenshots?.map((s) => 
    `https:${s.url.replace('t_thumb', 't_screenshot_big')}`
  ) || []

  const rating = game.rating ? (game.rating / 20).toFixed(1) : null

  // similar_games is returned as an array of numeric IDs (not expanded objects)
  const similarGameIds = Array.isArray(game.similar_games)
    ? game.similar_games.map(g => (typeof g === 'object' ? g.id : g)).filter(Boolean)
    : []

  const genreIds = game.genres?.map((g) => g.id).filter(Boolean) || []
  const themeIds = game.themes?.map((t) => t.id).filter(Boolean) || []

  const normalized = normalizeGame({
    id: game.id,
    title: game.name,
    description: game.summary || 'No description available.',
    developer: developers[0] || 'Unknown',
    developers: developers,
    publisher: publishers[0] || 'Unknown',
    publishers: publishers,
    genre: genres.join(', ') || 'Unknown',
    genres: genres,
    rating: rating,
    year: year,
    releaseDate: releaseDate,
    image: coverUrl,
    platforms: platforms,
    screenshots: screenshots,
    websites: game.websites?.map((w) => w.url) || [],
    themes: themes,
    playerPerspectives: playerPerspectives,
    gameModes: gameModes,
    keywords: keywords,
  }, 'igdb')

  normalized.similarGameIds = similarGameIds
  normalized.genreIds = genreIds
  normalized.themeIds = themeIds
  return normalized
}

/**
 * Fetch up to 8 similar games for the SimilarGamesRow component.
 * Filters by shared genres (and themes if available), rating > 70 (IGDB scale),
 * and cover presence. Falls back gracefully to an empty array on any error.
 */
export async function fetchSimilarGamesForRow(gameId, genreIds = [], themeIds = []) {
  if (!gameId) return []

  const numericGameId = Number(gameId)
  const hasGenres = genreIds.length > 0
  const hasThemes = themeIds.length > 0

  let whereClause = `id != ${numericGameId} & cover != null & rating > 70`
  if (hasGenres) {
    whereClause += ` & genres = (${genreIds.slice(0, 3).join(',')})`
  }
  if (hasThemes) {
    whereClause += ` & themes = (${themeIds.slice(0, 3).join(',')})`
  }

  const query = `fields name, cover.image_id, rating;
where ${whereClause};
sort rating desc;
limit 8;`

  try {
    const games = await igdbRequest('games', query)

    if (!games || games.length === 0) {
      // Retry without themes constraint if we had one
      if (hasThemes && hasGenres) {
        const fallbackWhere = `id != ${numericGameId} & cover != null & rating > 70 & genres = (${genreIds.slice(0, 3).join(',')})`
        const fallbackQuery = `fields name, cover.image_id, rating;
where ${fallbackWhere};
sort rating desc;
limit 8;`
        const fallbackGames = await igdbRequest('games', fallbackQuery)
        return (fallbackGames || []).map(g => ({
          id: g.id,
          title: g.name,
          image: g.cover?.image_id
            ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
            : null,
        })).filter(g => g.image)
      }
      return []
    }

    return games.map(g => ({
      id: g.id,
      title: g.name,
      image: g.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
        : null,
    })).filter(g => g.image)
  } catch (err) {
    console.error('[fetchSimilarGamesForRow] error:', err)
    return []
  }
}

/**
 * fetchSwipeDeckPool — legacy popularity-sorted pool (kept for reference).
 * New code uses getDiscoveryDeck() for varied, randomized discovery.
 * @deprecated Use getDiscoveryDeck() instead.
 */
export async function fetchSwipeDeckPool(limit = 40) {
  const fiveYearsAgo = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 60 * 60

  const query = `fields name, cover.image_id, rating, rating_count, first_release_date, involved_companies.company.name, involved_companies.developer;
where cover != null & rating > 72 & rating_count > 30 & first_release_date >= ${fiveYearsAgo};
sort rating_count desc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (err) {
    console.error('[igdb] fetchSwipeDeckPool failed:', err)
    return []
  }
}

// ─── Multiquery — bundle up to 10 sub-queries into a single IGDB request ─────
//
// IGDB's /multiquery endpoint accepts a body of `query <endpoint> "<name>" { ... };`
// blocks (semicolon-separated, max 10) and returns `[{ name, result }, ...]`.
// One HTTP request, multiple result sets — keeps us under the 4 req/s ceiling
// when the discovery deck fans out across 3 randomised axes.
//
// Block params:
//   endpoint — IGDB endpoint name (almost always 'games' for our use)
//   name     — caller-supplied label; appears verbatim in the response
//   body     — `fields ...; where ...; sort ...; limit ...;` (apicalypse)
//
// `multiquery` was added to the Supabase Edge Function proxy in
// supabase/functions/igdb-proxy/index.ts; older proxy deployments will
// reject the endpoint with a 400. We trip a session-scoped flag on the
// first such rejection so callers can fall back to parallel queries
// without re-paying the 400 on every refill.
let multiQueryUnsupported = false
export function isMultiQuerySupported() {
  return !multiQueryUnsupported
}

export async function igdbMultiQuery(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return []
  if (multiQueryUnsupported) {
    throw new Error('multiquery endpoint marked unsupported this session')
  }
  const limited = blocks.slice(0, 10)
  const compose = limited
    .map(({ endpoint, name, body }) => {
      const safeName = String(name || `q_${Math.random().toString(36).slice(2, 8)}`)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
      return `query ${endpoint} "${safeName}" {\n${body.trim()}\n};`
    })
    .join('\n')

  try {
    const data = await igdbRequest('multiquery', compose)
    return Array.isArray(data) ? data : []
  } catch (err) {
    // If the proxy rejects multiquery as an unsupported endpoint, stop
    // retrying it for the rest of the session — callers will fall back to
    // parallel `games` queries which are always allowed.
    const msg = err instanceof Error ? err.message : String(err)
    if (/Unsupported or missing endpoint|multiquery/i.test(msg)) {
      multiQueryUnsupported = true
    }
    throw err
  }
}

// ─── Discovery deck — randomized multi-axis discovery engine ─────────────────
//
// Every session a fresh mix: 3 axis queries bundled into a single IGDB
// multiquery, with independently randomised genre, era window, and offset.
// Quality-gated (not popularity-sorted), so a classic 1998 JRPG and a 2023
// indie can both surface. When a taste signal is supplied, one axis pins
// itself to a top liked genre so the deck feels personally relevant.

const IGDB_GENRES_CACHE_KEY = 'gt:igdb-genres:v1'
const IGDB_GENRES_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Fetch all IGDB genres and cache them in localStorage for 7 days. */
async function fetchIgdbGenres() {
  try {
    const raw = localStorage.getItem(IGDB_GENRES_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (Date.now() < cached.expiresAt && Array.isArray(cached.genres) && cached.genres.length > 0) {
        return cached.genres
      }
    }
  } catch { /* ignore */ }

  const query = `fields id, name; limit 50;`
  const genres = await igdbRequest('genres', query)

  if (Array.isArray(genres) && genres.length > 0) {
    const toCache = genres
      .filter((g) => g && g.id && g.name)
      .map((g) => ({ id: g.id, name: g.name }))
    try {
      localStorage.setItem(
        IGDB_GENRES_CACHE_KEY,
        JSON.stringify({ genres: toCache, expiresAt: Date.now() + IGDB_GENRES_CACHE_TTL })
      )
    } catch { /* storage full — ignore */ }
    return toCache
  }
  return []
}

// Fallback genre set when the IGDB genres endpoint is unavailable.
const FALLBACK_GENRES = [
  { id: 12, name: 'Role-playing (RPG)' },
  { id: 31, name: 'Adventure' },
  { id: 5,  name: 'Shooter' },
  { id: 8,  name: 'Platform' },
  { id: 9,  name: 'Puzzle' },
  { id: 11, name: 'Real Time Strategy (RTS)' },
  { id: 14, name: 'Sport' },
  { id: 15, name: 'Strategy' },
  { id: 25, name: 'Hack and slash/Beat \'em up' },
  { id: 32, name: 'Indie' },
]

// Era windows for the randomized discovery axis.
const DISCOVERY_ERAS = [
  { label: 'classic', start: 0,          end: 946684800  }, // before 2000
  { label: '2000s',   start: 946684800,  end: 1262304000 }, // 2000–2010
  { label: '2010s',   start: 1262304000, end: 1514764800 }, // 2010–2018
  { label: 'modern',  start: 1514764800, end: null        }, // 2018–now
]

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Fetch games from IGDB similar_games lists of the user's top-rated titles,
 * filtered to quality-gate and not already in excludeIds/seenInBatch.
 * Used as a minority taste seed — keeps the deck feeling personally relevant.
 */
async function fetchDiscoveryTasteSeed(tasteIgdbIds, excludeIds, seenInBatch) {
  if (!tasteIgdbIds || tasteIgdbIds.length === 0) return []
  try {
    const simQuery = `fields similar_games;
where id = (${tasteIgdbIds.join(',')});
limit ${tasteIgdbIds.length};`
    const results = await igdbRequest('games', simQuery)

    const seedIds = []
    const localSeen = new Set()
    for (const g of results || []) {
      for (const sid of g.similar_games || []) {
        const id = typeof sid === 'object' ? sid.id : sid
        const key = String(id)
        if (!localSeen.has(key) && !excludeIds.has(key) && !seenInBatch.has(key)) {
          localSeen.add(key)
          seedIds.push(id)
        }
      }
    }
    if (!seedIds.length) return []

    const limited = seedIds.slice(0, 20)
    const gameQuery = `fields name, cover.image_id, first_release_date, rating, rating_count, genres.name, themes.id, themes.name;
where id = (${limited.join(',')}) & cover != null;
limit ${limited.length};`

    const games = await igdbRequest('games', gameQuery)
    return (games || []).filter((g) => g.id && g.name && g.cover?.image_id)
  } catch (err) {
    console.warn('[igdb] fetchDiscoveryTasteSeed failed:', err)
    return []
  }
}

/**
 * getDiscoveryDeck — randomized, varied discovery pool for "Swipe to Discover".
 *
 * Fires ONE IGDB multiquery carrying 3 axis sub-queries, each with
 * independently randomised:
 *   • genre  — from the cached /genres list, biased toward the user's top
 *              liked genres when a tasteSignal is supplied
 *   • era    — pre-2000 / 2000s / 2010s / 2018+ (equal probability per slot)
 *   • offset — 0–99, so repeated calls rarely return the same page
 *
 * Quality gate:
 *   cover != null               always has artwork
 *   rating ≥ 70 & rating_count ≥ 10   keeps good, recognisable games
 *
 * Explicit fields requested per axis: name, cover.image_id, first_release_date,
 * rating, rating_count, genres.name, themes.id, themes.name. Themes are
 * required so we can match against the taste signal and render a "why" line.
 *
 * Each returned card is annotated with `whyLine` — a one-line reason it
 * surfaced based on the taste signal — when one can honestly be generated.
 *
 * On any failure (e.g. proxy missing the `multiquery` allow-list entry until
 * redeploy), falls through to the legacy 3-parallel-`games` path.
 *
 * @param {Object}      opts
 * @param {Set<string>} opts.excludeIds   – IGDB IDs to exclude (library + seen)
 * @param {number[]}    opts.tasteGameIds – IGDB IDs of user's top-rated games
 * @param {object|null} opts.tasteSignal  – output of swipeService.getTasteSignal
 * @param {number}      opts.limit        – max cards to return (default 30)
 * @returns {Promise<Array>} formatted game objects with optional whyLine
 */
export async function getDiscoveryDeck({
  excludeIds = new Set(),
  tasteGameIds = [],
  tasteSignal = null,
  limit = 30,
} = {}) {
  const now = Math.floor(Date.now() / 1000)

  // Resolve genre list — cached; falls back to a hardcoded set if IGDB is down.
  let allGenres = FALLBACK_GENRES
  try {
    const fetched = await fetchIgdbGenres()
    if (fetched.length > 0) allGenres = fetched
  } catch { /* use fallback */ }

  // Build the genre pool. When a taste signal exists, pin one axis to a
  // top-liked genre so the deck actively reflects the user's taste; the
  // other two stay fully random so we never tunnel-vision.
  const tastePinned = pickTastePinnedGenre(allGenres, tasteSignal)
  const eras = DISCOVERY_ERAS.map((e) => ({ ...e, end: e.end ?? now }))

  const axes = Array.from({ length: 3 }, (_, i) => {
    const genre  = (i === 0 && tastePinned) ? tastePinned : randomPick(allGenres)
    const era    = randomPick(eras)
    const offset = Math.floor(Math.random() * 100)
    const body =
      `fields name, cover.image_id, first_release_date, rating, rating_count, ` +
      `genres.name, themes.id, themes.name; ` +
      `where cover != null & rating != null & rating_count != null` +
      ` & rating >= 70 & rating_count >= 10` +
      ` & genres = (${genre.id})` +
      ` & first_release_date >= ${era.start} & first_release_date < ${era.end}; ` +
      `sort rating desc; limit 25; offset ${offset};`
    return { name: `axis_${i}`, endpoint: 'games', body, genre, era, offset }
  })

  if (import.meta.env.DEV) {
    axes.forEach(({ genre, era, offset }, i) =>
      console.log(
        `[discovery] axis ${i} → genre="${genre.name}"${tastePinned && i === 0 ? ' (taste-pinned)' : ''}` +
          ` era="${era.label}" offset=${offset}`
      )
    )
  }

  // Run one multiquery; fall back to 3 parallel games queries if the proxy
  // hasn't been redeployed with the multiquery endpoint allow-list entry yet.
  let axisResults = []
  try {
    const multi = await igdbMultiQuery(axes)
    const byName = new Map(multi.map((r) => [r.name, r.result || []]))
    axisResults = axes.map((a) => byName.get(a.name) || [])
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[discovery] multiquery failed, falling back to parallel games', err)
    const settled = await Promise.allSettled(
      axes.map(({ body }) => igdbRequest('games', body))
    )
    axisResults = settled.map((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
  }

  // Combine, de-dupe, exclude library/seen IDs.
  const seenInBatch = new Set()
  const combined = []
  for (const result of axisResults) {
    for (const g of result) {
      if (!g?.id || !g?.name || !g?.cover?.image_id) continue
      const key = String(g.id)
      if (seenInBatch.has(key) || excludeIds.has(key)) continue
      seenInBatch.add(key)
      combined.push(g)
    }
  }

  // Tier-1 fallback: drop era constraint, keep genre + rating floor.
  if (combined.length === 0) {
    try {
      const safeGenre = tastePinned || randomPick(allGenres)
      const safeQuery =
        `fields name, cover.image_id, first_release_date, rating, rating_count, genres.name, themes.id, themes.name; ` +
        `where cover != null & rating != null & rating_count != null` +
        ` & rating >= 70 & rating_count >= 30 & genres = (${safeGenre.id}); ` +
        `sort rating_count desc; limit 25; offset ${Math.floor(Math.random() * 50)};`
      const fallback1 = await igdbRequest('games', safeQuery)
      for (const g of fallback1 || []) {
        if (!g?.id || !g?.name || !g?.cover?.image_id) continue
        const key = String(g.id)
        if (!seenInBatch.has(key) && !excludeIds.has(key)) {
          seenInBatch.add(key)
          combined.push(g)
        }
      }
    } catch { /* non-fatal */ }
  }

  // Tier-2 fallback: legacy popularity pool — proven to always return.
  if (combined.length === 0) {
    try {
      const pool = await fetchSwipeDeckPool(40)
      const filtered = pool.filter((g) => !excludeIds.has(String(g.id)))
      // Already formatted — shuffle and return, no whyLine (no theme data).
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[filtered[i], filtered[j]] = [filtered[j], filtered[i]]
      }
      return filtered.slice(0, limit)
    } catch { return [] }
  }

  // Optional taste seed — minority (≤ ¼ of limit) from similar_games of the
  // user's top-rated played titles. Same fields requested so cards from the
  // seed path also carry themes for the whyLine annotator.
  if (tasteGameIds.length > 0) {
    const seedGames = await fetchDiscoveryTasteSeed(tasteGameIds.slice(0, 3), excludeIds, seenInBatch)
    const seedLimit = Math.ceil(limit / 4)
    for (const g of seedGames.slice(0, seedLimit)) {
      const key = String(g.id)
      if (!seenInBatch.has(key)) {
        seenInBatch.add(key)
        combined.push(g)
      }
    }
  }

  // Negative bias: drop a candidate when its only genre is one the user has
  // strongly disliked. We allow at most 1 disliked candidate per refill so
  // a single bad mood doesn't permanently kill an entire genre.
  const filtered = applyTasteNegativeBias(combined, tasteSignal)

  // Fisher-Yates shuffle so genre/era mix is interleaved, not grouped.
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[filtered[i], filtered[j]] = [filtered[j], filtered[i]]
  }

  // Format → annotate with whyLine. The annotator is pure, side-effect-free,
  // and returns null when there isn't a real reason to surface — we never
  // fake one (acceptance criterion: "why lines are real").
  const formatted = formatGamesWithThemes(filtered.slice(0, limit))
  if (tasteSignal && tasteSignal.totalSignals > 0) {
    for (const card of formatted) {
      const line = buildWhyLine(card, tasteSignal)
      if (line) card.whyLine = line
    }
  }
  return formatted
}

// ─── Broad discovery pool — full-catalog swipe deck (ALL genres, always) ─────
//
// Scoping candidates to the user's own top genres/themes would mean an
// entire genre the user has never engaged with — Sports, Puzzle, Simulation,
// Racing, Fighting, etc. — could NEVER appear in the pool, no matter how
// good the game is.
//
// This is the fix: query IGDB directly across EVERY major genre, gated only
// by quality (total_rating + total_rating_count), never by genre affinity.
// A taste vector may be supplied to nudge ORDER only (see applyTasteOrderBias)
// — it must never exclude a genre. Coverage first, personalization second.

// Every major IGDB genre — deliberately NOT curated down to "genres this app
// cares about". Sports/Puzzle/Simulation/Racing/Fighting are exactly the
// genres a taste-restricted pool would starve out, so they're included here
// on equal footing with RPG/Adventure/Shooter.
export const BROAD_DISCOVERY_GENRES = [
  { id: 2,  name: 'Point-and-click' },
  { id: 4,  name: 'Fighting' },
  { id: 5,  name: 'Shooter' },
  { id: 7,  name: 'Music' },
  { id: 8,  name: 'Platform' },
  { id: 9,  name: 'Puzzle' },
  { id: 10, name: 'Racing' },
  { id: 11, name: 'Real Time Strategy (RTS)' },
  { id: 12, name: 'Role-playing (RPG)' },
  { id: 13, name: 'Simulator' },
  { id: 14, name: 'Sport' },
  { id: 15, name: 'Strategy' },
  { id: 16, name: 'Turn-based strategy (TBS)' },
  { id: 24, name: 'Tactical' },
  { id: 25, name: 'Hack and slash/Beat \'em up' },
  { id: 26, name: 'Quiz/Trivia' },
  { id: 30, name: 'Pinball' },
  { id: 31, name: 'Adventure' },
  { id: 32, name: 'Indie' },
  { id: 33, name: 'Arcade' },
  { id: 34, name: 'Visual Novel' },
  { id: 35, name: 'Card & Board Game' },
  { id: 36, name: 'MOBA' },
]

// Quality bar — the ONLY filter besides "not already excluded". Deliberately
// symmetric across every genre above: no genre gets a stricter or looser
// bar than any other.
const BROAD_MIN_RATING = 68
const BROAD_MIN_RATING_COUNT = 12
const BROAD_FIELDS =
  'fields name, cover.image_id, first_release_date, total_rating, total_rating_count, genres.name'
const BROAD_QUALITY_WHERE =
  `total_rating != null & total_rating_count != null & total_rating >= ${BROAD_MIN_RATING}` +
  ` & total_rating_count >= ${BROAD_MIN_RATING_COUNT} & cover != null & version_parent = null`

function buildBroadGenreBlock(genre, offset, perGenreLimit) {
  const body =
    `${BROAD_FIELDS}; ` +
    `where ${BROAD_QUALITY_WHERE} & genres = (${genre.id}); ` +
    `sort total_rating_count desc; limit ${perGenreLimit}; offset ${offset};`
  return { genre, offset, endpoint: 'games', name: `genre_${genre.id}`, body }
}

function formatBroadGame(g) {
  if (!g?.id || !g?.name || !g?.cover?.image_id) return null
  const year = g.first_release_date
    ? new Date(g.first_release_date * 1000).getFullYear()
    : null
  const genres = (g.genres || []).map((x) => x.name).filter(Boolean)
  return {
    id: g.id,
    title: g.name,
    image: coverUrlFromImageId(g.cover.image_id),
    year,
    genres,
    genre: genres.join(', ') || null,
    totalRating: g.total_rating != null ? Number(g.total_rating) : null,
    totalRatingCount: g.total_rating_count != null ? Number(g.total_rating_count) : null,
  }
}

/**
 * Light, SECONDARY personalization: nudges cards whose genres the user tends
 * to like slightly earlier in the batch. The random jitter is intentionally
 * large relative to the taste boost so it can never collapse the batch back
 * into a narrow, taste-only feed — the round-robin genre interleave always
 * dominates the overall mix. Never removes a card, never re-groups by genre.
 */
function applyTasteOrderBias(cards, genreWeights) {
  if (!genreWeights) return cards
  return cards
    .map((card) => {
      const boost = (card.genres || []).reduce(
        (max, g) => Math.max(max, genreWeights[g] || 0),
        0
      )
      return { card, key: Math.random() - boost * 0.35 }
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.card)
}

/**
 * fetchBroadDiscoveryBatch — one page of the full-genre-catalog swipe pool.
 *
 * Queries EVERY genre in BROAD_DISCOVERY_GENRES (chunked into ≤10-block
 * /multiquery requests — 3 HTTP calls total for 23 genres, well under the
 * 4 req/s ceiling since this only runs on initial load / background
 * refill, never per-card), quality-gated by total_rating/total_rating_count
 * only. No genre is ever skipped because the user hasn't shown affinity
 * for it.
 *
 * Results are interleaved round-robin across genres before returning, so a
 * single batch is never accidentally dominated by whichever genre happens
 * to have the deepest catalog (e.g. RPG/Adventure) — every genre that
 * returned results gets a fair turn in the mix.
 *
 * Pagination: pass the returned `cursors` back in on the next call to page
 * further into each genre's catalog (a genre's offset only advances when it
 * returned a full page, so a thin genre never gets skipped past). This is
 * what gives the deck infinite supply — the candidate pool is the whole
 * real IGDB catalog, not a small precomputed list, so background-fetching
 * the next page as the user nears the end of the current batch means the
 * deck never dead-ends.
 *
 * @param {Object}                 opts
 * @param {Set<string>}            [opts.excludeIds]    already-tracked/seen IGDB ids
 * @param {Record<string,number>}  [opts.cursors]       per-genre-id offset from a previous call
 * @param {number}                 [opts.perGenreLimit] rows requested per genre per page
 * @param {Record<string,number>|null} [opts.genreWeights] taste vector genre
 *        weights (0–1), used ONLY to nudge order — never to exclude a genre.
 * @returns {Promise<{ cards: Array, cursors: Record<string,number> }>}
 */
export async function fetchBroadDiscoveryBatch({
  excludeIds = new Set(),
  cursors = {},
  perGenreLimit = 5,
  genreWeights = null,
} = {}) {
  const nextCursors = { ...cursors }
  const genres = BROAD_DISCOVERY_GENRES

  const blocks = genres.map((genre) =>
    buildBroadGenreBlock(genre, nextCursors[genre.id] || 0, perGenreLimit)
  )

  // /multiquery caps at 10 sub-queries per request — chunk so every genre
  // still gets queried this batch, just across a couple of HTTP calls.
  const chunks = []
  for (let i = 0; i < blocks.length; i += 10) chunks.push(blocks.slice(i, i + 10))

  const genreBuckets = new Map(genres.map((g) => [g.id, []]))

  const applyChunkResult = (block, rows) => {
    genreBuckets.get(block.genre.id).push(...(rows || []))
    // Only advance the cursor when the genre returned a full page — a short
    // page means we've hit the end of that genre's quality-gated catalog,
    // so re-querying the same offset next time is harmless (dedup handles
    // any repeats via excludeIds).
    if (Array.isArray(rows) && rows.length >= perGenreLimit) {
      nextCursors[block.genre.id] = block.offset + perGenreLimit
    }
  }

  for (const chunk of chunks) {
    try {
      const multi = await igdbMultiQuery(chunk)
      const byName = new Map(multi.map((r) => [r.name, r.result || []]))
      for (const block of chunk) applyChunkResult(block, byName.get(block.name))
    } catch (err) {
      // Multiquery unsupported/failed — fall back to parallel per-genre
      // calls for just this chunk so one bad chunk doesn't sink the batch.
      if (import.meta.env.DEV) console.warn('[broadDiscovery] multiquery chunk failed, falling back', err)
      const settled = await Promise.allSettled(chunk.map((b) => igdbRequest('games', b.body)))
      settled.forEach((r, i) => {
        applyChunkResult(chunk[i], r.status === 'fulfilled' ? r.value : [])
      })
    }
  }

  // Format + de-dupe + exclude, per genre bucket — kept separate so the
  // interleave step below still gets a fair per-genre supply to draw from.
  const seen = new Set()
  for (const [genreId, rows] of genreBuckets) {
    const formatted = []
    for (const row of rows) {
      const card = formatBroadGame(row)
      if (!card) continue
      const key = String(card.id)
      if (seen.has(key) || excludeIds.has(key)) continue
      seen.add(key)
      formatted.push(card)
    }
    genreBuckets.set(genreId, formatted)
  }

  // Round-robin interleave: one pass per "slot" takes one card from every
  // genre bucket that still has one left, so genre order in the final list
  // is mixed, not grouped by catalog depth.
  const interleaved = []
  let more = true
  while (more) {
    more = false
    for (const rows of genreBuckets.values()) {
      const card = rows.shift()
      if (card) {
        interleaved.push(card)
        more = true
      }
    }
  }

  return {
    cards: applyTasteOrderBias(interleaved, genreWeights),
    cursors: nextCursors,
  }
}

// ─── Mood decks — entry chips that seed the swipe stack ──────────────────────
//
// Each mood maps to EXPLICIT IGDB filter criteria. No fabricated groupings —
// every field/ID below is a real IGDB entity ID.
//
// Reliable IGDB attributes used (all densely populated):
//   game_modes:  3  = Co-operative
//   themes:     19  = Horror
//              38  = Open world
//   genres:      9  = Puzzle
//             12  = Role-playing (RPG)
//             31  = Adventure  ← broadest "story-driven" proxy
//
// DROPPED chips and why:
//   "30 min" (ttb strategy) — game_time_to_beats is crowd-sourced and
//      extremely sparse; virtually always fell through to the Puzzle fallback,
//      producing off-theme results. Replaced by Story-driven.
//
//   "I want to cry" (themes = 31, Drama) — Drama is an editorial IGDB tag
//      applied to very few games; reliably returned < 5 results before the
//      rating gate. Replaced by Highly rated.
//
//   "just vibes" (themes = 33,38) — BUG: Apicalypse `= (33,38)` means the
//      game must carry BOTH Sandbox AND Open World simultaneously. Almost no
//      game has both. Replaced by single Open world theme (38 only).
//
// Chip shape:
//   where         – Apicalypse filter fragment prepended to the quality gates;
//                   null means no extra filter (quality gates do all the work).
//   minRating     – minimum IGDB community rating (default 70)
//   minRatingCount – minimum number of IGDB ratings (default 10)
//   maxRatingCount – optional upper-bound on rating_count (Hidden gems only)
//   sortBy        – Apicalypse sort clause (default "rating_count desc")

export const MOOD_CHIPS = [
  {
    id: 'coop',
    label: 'Co-op',
    emoji: '🤝',
    strategy: 'where',
    where: 'game_modes = (3)', // game_mode: Co-operative — densely tagged
    minRating: 70,
    minRatingCount: 10,
  },
  {
    id: 'spooky',
    label: 'Spooky',
    emoji: '👻',
    strategy: 'where',
    where: 'themes = (19)',    // theme: Horror — one of the most-tagged IGDB themes
    minRating: 70,
    minRatingCount: 10,
  },
  {
    id: 'story',
    label: 'Story-driven',
    emoji: '📖',
    strategy: 'where',
    where: 'genres = (31)',    // genre: Adventure — broadest narrative proxy, densely tagged
    minRating: 72,
    minRatingCount: 20,
  },
  {
    id: 'rated',
    label: 'Highly rated',
    emoji: '⭐',
    strategy: 'where',
    where: null,               // no theme/genre filter — quality gates do all the work
    minRating: 85,
    minRatingCount: 50,
  },
  {
    id: 'openworld',
    label: 'Open world',
    emoji: '🌍',
    strategy: 'where',
    where: 'themes = (38)',    // theme: Open world — single reliable theme (not AND'd with Sandbox)
    minRating: 70,
    minRatingCount: 10,
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    emoji: '🧩',
    strategy: 'where',
    where: 'genres = (9)',     // genre: Puzzle
    minRating: 68,
    minRatingCount: 8,
  },
  {
    id: 'hidden',
    label: 'Hidden gems',
    emoji: '💎',
    strategy: 'where',
    where: null,               // no theme/genre gate — niche pool via rating_count ceiling
    minRating: 78,
    minRatingCount: 10,
    maxRatingCount: 500,
    sortBy: 'rating desc',     // surface best-rated obscure games, not most-reviewed
  },
  {
    id: 'rpg',
    label: 'RPG',
    emoji: '🎭',
    strategy: 'where',
    where: 'genres = (12)',    // genre: Role-playing (RPG) — one of IGDB's largest genre pools
    minRating: 70,
    minRatingCount: 15,
  },
  {
    id: 'under2h',
    label: 'Under 2h',
    emoji: '⚡',
    strategy: 'where',
    where: 'genres = (33)',    // genre: Arcade — densely tagged; nearly all entries are sub-2h
    minRating: 65,
    minRatingCount: 8,
  },
  {
    id: 'weekend',
    label: 'Weekend',
    emoji: '🛋️',
    strategy: 'where',
    where: 'genres = (25)',    // genre: Hack and slash/Beat 'em up — reliably 8–15 h campaigns
    minRating: 70,
    minRatingCount: 15,
  },
]

/**
 * Fetch a discovery deck seeded by a mood chip.
 *
 * Mirrors the getDiscoveryDeck signature so SwipeDeck can call it transparently.
 *
 * @param {string}      moodId        – one of MOOD_CHIPS[*].id
 * @param {Object}      opts
 * @param {Set<string>} opts.excludeIds – IGDB IDs to skip (library + seen)
 * @param {number}      opts.limit      – max cards to return (default 30)
 * @returns {Promise<Array>} formatted game objects (same shape as getDiscoveryDeck)
 */
export async function getMoodDeck(moodId, { excludeIds = new Set(), limit = 30 } = {}) {
  const mood = MOOD_CHIPS.find((m) => m.id === moodId)
  if (!mood) return []
  return _moodDeckViaWhere(mood, { excludeIds, limit })
}

async function _moodDeckViaWhere(mood, { excludeIds, limit }) {
  const minRating  = mood.minRating ?? 70
  const minCount   = mood.minRatingCount ?? 10
  const sortBy     = mood.sortBy ?? 'rating_count desc'
  const offset     = Math.floor(Math.random() * 80)

  // Build the WHERE clause — mood.where is optional (null = quality gates only)
  const themeGenreFilter = mood.where ? `${mood.where} & ` : ''
  const maxCountFilter   = mood.maxRatingCount != null
    ? `& rating_count <= ${mood.maxRatingCount} `
    : ''

  const query =
    `fields name, cover.image_id, first_release_date, rating, rating_count, genres.name, themes.id, themes.name; ` +
    `where ${themeGenreFilter}cover != null & rating != null & rating_count != null ` +
    `& rating >= ${minRating} & rating_count >= ${minCount} ${maxCountFilter}; ` +
    `sort ${sortBy}; limit ${limit}; offset ${offset};`

  try {
    const games = await igdbRequest('games', query)
    const fresh = (games || []).filter(
      (g) => g.id && g.name && g.cover?.image_id && !excludeIds.has(String(g.id))
    )
    return formatGamesWithThemes(fresh.slice(0, limit))
  } catch (err) {
    console.error(`[mood] getMoodDeck "${mood.id}" where-strategy failed:`, err)
    return []
  }
}

// Pick a top-liked genre that exists in the IGDB genre catalog. Returns null
// when the taste signal hasn't accumulated anything actionable yet.
function pickTastePinnedGenre(allGenres, taste) {
  if (!taste || !Array.isArray(taste.topGenres) || taste.topGenres.length === 0) return null
  const byName = new Map(allGenres.map((g) => [g.name, g]))
  for (const name of taste.topGenres) {
    if (byName.has(name)) return byName.get(name)
  }
  // Try partial match — "RPG" vs "Role-playing (RPG)".
  for (const name of taste.topGenres) {
    for (const g of allGenres) {
      if (g.name.toLowerCase().includes(String(name).toLowerCase())) return g
    }
  }
  return null
}

// Soft-filter candidates whose only genre matches a strongly disliked one.
// Allows at most one such candidate through per batch — full filtering would
// risk an empty deck for users who skipped a lot early on.
function applyTasteNegativeBias(games, taste) {
  if (!taste || !taste.dislikedGenres) return games
  const heavyDislike = new Set(
    Object.entries(taste.dislikedGenres)
      .filter(([, w]) => w >= 4)
      .map(([name]) => name)
  )
  if (heavyDislike.size === 0) return games

  let allowedDisliked = 1
  const out = []
  for (const g of games) {
    const genres = (g.genres || [])
      .map((x) => (typeof x === 'object' ? x.name : x))
      .filter(Boolean)
    const allDisliked = genres.length > 0 && genres.every((n) => heavyDislike.has(n))
    if (allDisliked) {
      if (allowedDisliked > 0) {
        allowedDisliked--
        out.push(g)
      }
    } else {
      out.push(g)
    }
  }
  return out
}

// Variant of formatGames that preserves theme IDs/names alongside the card.
// We need this on the candidate side so the whyLine annotator and the swipe
// recorder can match cards against the taste signal.
function formatGamesWithThemes(games) {
  const sorted = games
    .filter((game) => game.name)
    .map((game) => {
      const coverUrl = extractCoverUrl(game)

      let releaseDate = null
      let year = null
      if (game.first_release_date) {
        releaseDate = new Date(game.first_release_date * 1000)
        year = releaseDate.getFullYear()
      }

      const genreNames = game.genres?.map((g) => g.name).filter(Boolean) || []
      const developer = game.involved_companies?.[0]?.company?.name || 'Unknown'
      const rating = game.rating ? (game.rating / 20).toFixed(1) : null

      const themeIds = []
      const themeNames = []
      for (const t of game.themes || []) {
        if (t && typeof t === 'object') {
          if (t.id != null) themeIds.push(Number(t.id))
          if (t.name) themeNames.push(String(t.name))
        }
      }

      return {
        id: game.id,
        title: game.name,
        developer,
        genre: genreNames.join(', ') || 'Unknown',
        genres: genreNames,
        themeIds,
        themeNames,
        rating,
        year,
        image: coverUrl,
        description: game.summary || '',
        releaseDate,
      }
    })
    .sort((a, b) => {
      if (a.rating && b.rating) {
        const ratingDiff = parseFloat(b.rating) - parseFloat(a.rating)
        if (ratingDiff !== 0) return ratingDiff
      }
      if (a.releaseDate && b.releaseDate) {
        return b.releaseDate.getTime() - a.releaseDate.getTime()
      }
      if (a.releaseDate && !b.releaseDate) return -1
      if (!a.releaseDate && b.releaseDate) return 1
      return 0
    })

  return normalizeGames(sorted, 'igdb')
}

/**
 * Batch-fetch mood-classification metadata for backlog games.
 *
 * Only fetches the IDs needed for shelf categorisation — no cover or rating
 * data is requested, keeping payloads small. Results are returned as a Map
 * keyed by string game ID.
 *
 * IGDB entity IDs used for shelves:
 *   themes:     19 = Horror, 31 = Drama, 33 = Sandbox, 38 = Open world
 *   game_modes:  3 = Co-operative
 *   genres:      9 = Puzzle
 *
 * @param {Array<string|number>} ids — up to 50 IGDB game IDs per call
 * @returns {Promise<Map<string,{themeIds:number[],gameModeIds:number[],genreIds:number[]}>>}
 */
export async function batchFetchGameMeta(ids) {
  if (!ids || ids.length === 0) return new Map()
  const limited = ids.slice(0, 50)
  const query =
    `fields themes.id, game_modes.id, genres.id; ` +
    `where id = (${limited.join(',')}); ` +
    `limit ${limited.length};`
  try {
    const rows = await igdbRequest('games', query)
    const meta = new Map()
    for (const row of rows || []) {
      meta.set(String(row.id), {
        themeIds:   (row.themes     || []).map((t) => Number(t.id)).filter(Boolean),
        gameModeIds:(row.game_modes || []).map((m) => Number(m.id)).filter(Boolean),
        genreIds:   (row.genres     || []).map((g) => Number(g.id)).filter(Boolean),
      })
    }
    return meta
  } catch (err) {
    console.error('[backlog] batchFetchGameMeta failed:', err)
    return new Map()
  }
}

// Test API connection
export async function testAPIConnection() {
  try {
    console.log('Testing IGDB API connection...')
    const token = await getAccessToken()
    console.log('✅ Access token obtained:', token ? 'Yes' : 'No')
    
    // Try a simple query
    const testQuery = `fields name;
limit 1;`
    const result = await igdbRequest('games', testQuery)
    console.log('✅ API test successful:', result)
    return true
  } catch (error) {
    console.error('❌ API test failed:', error)
    return false
  }
}

// Format games without any sorting — preserves the caller-provided order.
// Used by searchGames() so that rankGames() in searchService has full control.
function formatGamesRaw(games) {
  return normalizeGames(
    games
      .filter(game => game.name)
      .map(game => {
        const coverUrl = extractCoverUrl(game)

        let releaseDate = null
        let year = null
        if (game.first_release_date) {
          releaseDate = new Date(game.first_release_date * 1000)
          year = releaseDate.getFullYear()
        }

        const genres = game.genres?.map(g => g.name).join(', ') || 'Unknown'
        const developer = game.involved_companies?.[0]?.company?.name || 'Unknown'
        const rating = game.rating ? (game.rating / 20).toFixed(1) : null

        return {
          id: game.id,
          title: game.name,
          developer,
          genre: genres,
          rating,
          year,
          image: coverUrl,
          description: game.summary || '',
          releaseDate,
        }
      }),
    'igdb'
  )
}

function formatGames(games) {
  const sorted = games
    .filter((game) => game.name)
    .map((game) => {
      const coverUrl = extractCoverUrl(game)

      let releaseDate = null
      let year = null
      if (game.first_release_date) {
        releaseDate = new Date(game.first_release_date * 1000)
        year = releaseDate.getFullYear()
      }

      const genres = game.genres?.map((g) => g.name).join(', ') || 'Unknown'
      const developer = game.involved_companies?.[0]?.company?.name || 'Unknown'
      const rating = game.rating ? (game.rating / 20).toFixed(1) : null

      return {
        id: game.id,
        title: game.name,
        developer,
        genre: genres,
        rating,
        year,
        image: coverUrl,
        description: game.summary || '',
        releaseDate,
      }
    })
    .sort((a, b) => {
      if (a.rating && b.rating) {
        const ratingDiff = parseFloat(b.rating) - parseFloat(a.rating)
        if (ratingDiff !== 0) return ratingDiff
      }
      if (a.releaseDate && b.releaseDate) {
        return b.releaseDate.getTime() - a.releaseDate.getTime()
      }
      if (a.releaseDate && !b.releaseDate) return -1
      if (!a.releaseDate && b.releaseDate) return 1
      return 0
    })

  return normalizeGames(sorted, 'igdb')
}

