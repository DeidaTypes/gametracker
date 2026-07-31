// @ts-nocheck
// supabase/functions/new-notable/index.ts
//
// Supabase Edge Function — new-notable
//
// The daily refresh tick for Discover's "New & Notable" rail + see-all.
// Invoked once a day by pg_cron (see supabase/new_notable_schedule.sql) and
// manually for smoke tests / diagnosis. This is the ONLY place New &
// Notable touches IGDB; Explore reads exclusively from new_notable_pool via
// get_new_notable() (rail) or a direct table read (see-all) — see
// src/services/newNotableService.js.
//
// Each tick:
//   1. refresh the candidate pool from IGDB — released games only, then
//      classify into the two notability lanes, curate the rail, upsert,
//      prune stale rows — see pool.ts + lanes.ts
//   2. report lane counts and how many rows the release gate rejected
//
// Auth: deployed with verify_jwt=false; requires x-engine-secret matching
// the ENGINE_SECRET env var (same shared secret taste-engine and
// themed-drops use, supplied by pg_cron from Vault).
//
// Request  : POST { trigger?, action? }
//   action  'tick' (default) | 'diagnose' | 'status'
// Response : 200 { ok, ... }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshNewNotablePool } from './pool.ts'
import { summarizeLanes } from './lanes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ENGINE_SECRET = Deno.env.get('ENGINE_SECRET') || ''
const PROXY_URL = `${SUPABASE_URL}/functions/v1/igdb-proxy`

// Mirror the client + themed-drops/taste-engine throttle exactly.
const RATE_WINDOW_MS = 1000
const RATE_MAX = 4
const MAX_CONCURRENCY = 8
const MULTIQUERY_MAX_SUBQUERIES = 10

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-engine-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// ── IGDB throttle ───────────────────────────────────────────────────────────
const rateWindow: number[] = []
const igdbStats = { requests: 0, inFlight: 0, peakConcurrency: 0, peakPerSecond: 0 }

async function throttle() {
  while (true) {
    const now = Date.now()
    while (rateWindow.length && now - rateWindow[0] >= RATE_WINDOW_MS) rateWindow.shift()
    if (rateWindow.length < RATE_MAX) { rateWindow.push(now); return }
    await new Promise((r) => setTimeout(r, RATE_WINDOW_MS - (now - rateWindow[0]) + 5))
  }
}

async function igdb(endpoint: string, query: string): Promise<any> {
  await throttle()
  igdbStats.requests++
  igdbStats.peakPerSecond = Math.max(igdbStats.peakPerSecond, rateWindow.length)
  igdbStats.inFlight++
  igdbStats.peakConcurrency = Math.max(igdbStats.peakConcurrency, igdbStats.inFlight)
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ endpoint, query }),
      })
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
        continue
      }
      const text = await res.text()
      if (!res.ok) throw new Error(`IGDB ${endpoint} ${res.status}: ${text.slice(0, 300)}`)
      return JSON.parse(text)
    }
    throw new Error(`IGDB ${endpoint}: exhausted retries`)
  } finally {
    igdbStats.inFlight--
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= items.length) return
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Bundle sub-queries into /multiquery POSTs (<=10 each), <=8 POSTs in flight. */
async function igdbMulti(
  subs: { endpoint: string; name: string; body: string }[],
): Promise<Map<string, any[]>> {
  const batches: typeof subs[] = []
  for (let i = 0; i < subs.length; i += MULTIQUERY_MAX_SUBQUERIES) {
    batches.push(subs.slice(i, i + MULTIQUERY_MAX_SUBQUERIES))
  }

  const results = new Map<string, any[]>()
  const responses = await mapPool(batches, MAX_CONCURRENCY, async (batch) => {
    const body = batch
      .map((s) => `query ${s.endpoint} "${s.name}" {\n${s.body.trim()}\n};`)
      .join('\n')
    return await igdb('multiquery', body)
  })

  for (const res of responses) {
    for (const entry of res ?? []) {
      if (entry?.name) results.set(entry.name, entry.result ?? [])
    }
  }
  return results
}

// ── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: jsonHeaders,
    })
  }

  if (!ENGINE_SECRET || req.headers.get('x-engine-secret') !== ENGINE_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: jsonHeaders,
    })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is a valid tick */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const started = Date.now()
  igdbStats.requests = 0
  igdbStats.peakConcurrency = 0
  igdbStats.peakPerSecond = 0
  rateWindow.length = 0

  try {
    const action = body.action ?? 'tick'
    let payload: any

    if (action === 'status') {
      const { count } = await supabase
        .from('new_notable_pool')
        .select('igdb_game_id', { count: 'exact', head: true })
      const { data: latest } = await supabase
        .from('new_notable_pool')
        .select('refreshed_at')
        .order('refreshed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      payload = { pool_size: count ?? 0, last_refresh: latest?.refreshed_at ?? null }
    } else if (action === 'diagnose') {
      // Lane counts against the CURRENT cache, the release-gate assertion,
      // and the pre-fix date-only baseline pulled live from IGDB — so the
      // before/after comparison is always measured against what is actually
      // cached right now rather than against numbers in a comment.
      const { data: rows, error } = await supabase
        .from('new_notable_pool')
        .select('name, lane, release_date, total_rating_count, hypes, rail_rank')
      if (error) throw new Error(`new_notable_pool read failed: ${error.message}`)

      const nowIso = new Date().toISOString()
      const pool = rows ?? []
      const railRows = pool.filter((r: any) => r.rail_rank != null)
      // The acceptance check: not one unreleased game anywhere in the pool,
      // and by extension none on the rail.
      const unreleased = pool.filter((r: any) => !r.release_date || r.release_date > nowIso)

      const now = Math.floor(Date.now() / 1000)
      const dateOnlyQuery =
        `fields name, total_rating_count, hypes; ` +
        `where first_release_date >= ${now - 90 * 86400} & first_release_date <= ${now} & cover != null; ` +
        `sort first_release_date desc; limit 20;`
      const dateOnlyBaseline = await igdb('games', dateOnlyQuery)
      const zeroSignalBaseline = (dateOnlyBaseline ?? []).filter(
        (g: any) => (g.total_rating_count ?? 0) === 0 && (g.hypes ?? 0) === 0,
      ).length

      payload = {
        after: {
          lanes: summarizeLanes(pool),
          rail_size: railRows.length,
          unreleased_in_pool: unreleased.length,
          unreleased_on_rail: unreleased.filter((r: any) => r.rail_rank != null).length,
          unreleased_examples: unreleased.slice(0, 5).map((r: any) => r.name),
          oldest_release: pool.reduce(
            (min: string | null, r: any) => (!min || r.release_date < min ? r.release_date : min),
            null,
          ),
          newest_release: pool.reduce(
            (max: string | null, r: any) => (!max || r.release_date > max ? r.release_date : max),
            null,
          ),
        },
        before_baseline: {
          description: 'Live date-only query mirroring the pre-fix getRecentReleasesForDiscover(20)',
          sample_size: (dateOnlyBaseline ?? []).length,
          zero_signal_count: zeroSignalBaseline,
        },
      }
    } else {
      const result = await refreshNewNotablePool(supabase, igdbMulti, igdb)
      payload = { refresh: result }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action,
        duration_ms: Date.now() - started,
        igdb: {
          requests: igdbStats.requests,
          peak_per_second: igdbStats.peakPerSecond,
          peak_concurrency: igdbStats.peakConcurrency,
        },
        ...payload,
      }, null, 2),
      { headers: jsonHeaders },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[new-notable]', message)
    return new Response(
      JSON.stringify({ ok: false, error: message, duration_ms: Date.now() - started }),
      { status: 500, headers: jsonHeaders },
    )
  }
})
