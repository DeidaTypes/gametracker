// @ts-ignore
// supabase/functions/igdb-proxy/index.ts
// No JWT verification needed for this public proxy
//
// Supabase Edge Function — igdb-proxy
//
// Replaces the localhost-only dev proxy (vite.config.js) and the Vercel
// serverless proxies (api/igdb, api/twitch) so the app can reach IGDB from
// anywhere — including a physical iPhone running the Capacitor build, which
// cannot see the developer's localhost.
//
// Unlike the old pass-through proxies, this function owns the Twitch OAuth
// flow server-side: the client never sees the IGDB client ID / secret. The
// frontend just sends the IGDB query and gets the JSON back.
//
// Request  : POST /functions/v1/igdb-proxy
//   Body   : { endpoint: string, query: string }
//              endpoint — IGDB endpoint name, e.g. "games", "genres", "themes"
//              query    — raw IGDB query body (Apicalypse syntax)
//
// Response : 200 <IGDB JSON array>            on success
//          : 400 if endpoint/query are missing or the IGDB query is invalid
//          : 500 if Twitch credentials are missing or token fetch fails
//          : 502 on upstream IGDB / Twitch network errors
//
// Secrets (set via `npx supabase secrets set ...`):
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET

const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// Only IGDB v4 endpoints the app actually queries are allowed through, so the
// function can't be turned into an open proxy for arbitrary IGDB endpoints.
//
// `multiquery` was added for the Discover deck (Sprint 7A) so a single HTTP
// request can carry up to 10 sub-queries — reduces fan-out to one IGDB call
// per refill instead of three parallel `games` calls, keeping us comfortably
// under the ~4 req/s rate ceiling.
const ALLOWED_ENDPOINTS = new Set([
  'games',
  'genres',
  'themes',
  'keywords',
  'player_perspectives',
  'game_modes',
  'companies',
  'involved_companies',
  'game_time_to_beats',
  'multiquery',
])

// ── Twitch OAuth token cache (per warm instance) ────────────────────────────
// Edge Function instances are reused between invocations while warm, so caching
// the app-access token here avoids re-authenticating with Twitch on every call.
let tokenCache: { token: string | null; expiresAt: number } = {
  token: null,
  expiresAt: 0,
}
let tokenFlight: Promise<string> | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }
  if (tokenFlight) return tokenFlight

  tokenFlight = fetchNewToken().finally(() => {
    tokenFlight = null
  })
  return tokenFlight
}

async function fetchNewToken(): Promise<string> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Twitch token request failed: ${res.status} - ${detail}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Twitch token request returned no access_token')
  }

  // Refresh an hour early to avoid serving a token that expires mid-request.
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 3600) * 1000,
  }
  return tokenCache.token!
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: jsonHeaders,
    })
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response(
      JSON.stringify({
        error:
          'IGDB proxy is missing Twitch credentials. Set TWITCH_CLIENT_ID and ' +
          'TWITCH_CLIENT_SECRET via `npx supabase secrets set`.',
      }),
      { status: 500, headers: jsonHeaders },
    )
  }

  // ── Parse + validate body ─────────────────────────────────────────
  let endpoint: unknown
  let query: unknown
  try {
    const body = await req.json()
    endpoint = body?.endpoint
    query = body?.query
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  if (typeof endpoint !== 'string' || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return new Response(
      JSON.stringify({ error: `Unsupported or missing endpoint: ${String(endpoint)}` }),
      { status: 400, headers: jsonHeaders },
    )
  }

  if (typeof query !== 'string' || !query.trim()) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  // ── Authenticate + forward to IGDB ────────────────────────────────
  let token: string
  try {
    token = await getAccessToken()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[igdb-proxy] token error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  try {
    const upstream = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Client-ID': CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
      body: query,
    })

    const text = await upstream.text()

    // If IGDB rejects the token, clear the cache so the next call re-auths.
    if (upstream.status === 401) {
      tokenCache = { token: null, expiresAt: 0 }
    }

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[igdb-proxy] upstream error:', message)
    return new Response(JSON.stringify({ error: 'IGDB proxy error', detail: message }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
})
