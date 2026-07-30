// @ts-nocheck
// supabase/functions/themed-drops/index.ts
//
// Supabase Edge Function — themed-drops
//
// The scheduler + selection tick for Themed Drops. Invoked daily by pg_cron
// (see supabase/themed_drops_schedule.sql) and manually for smoke tests. This
// is the ONLY place Themed Drops touches IGDB; Explore reads exclusively from
// the cache tables via get_active_themed_drop().
//
// ── Why cron timing does not matter ─────────────────────────────────────────
// The obvious design is "cron wakes at 00:00 Thursday and activates the
// weekend drop". That makes the product's headline promise — the drop changes
// at midnight — depend on a scheduler firing on time, and it fails visibly
// (empty Explore) when a run is late or errors.
//
// Instead the calendar is the source of truth. drop_schedule tiles the
// timeline with non-overlapping windows, and get_active_themed_drop() resolves
// "live" as the window containing now(). The swap is therefore exact to the
// second and involves no code running at all.
//
// Cron's only job is to stay AHEAD: keep the calendar filled and make sure
// upcoming windows already have their games cached. A late run costs nothing.
// A run that fails for LOOKAHEAD_DAYS straight would let a window open
// unselected, which is why the lookahead spans several windows.
//
// Each tick:
//   1. assert the filter library matches the DB registry
//   2. ensure_drop_schedule() — fill the calendar forward
//   3. refresh the candidate pool if stale (the only IGDB traffic)
//   4. select games for every pending window inside the lookahead
//   5. report
//
// Auth: deployed with verify_jwt=false; requires x-engine-secret matching the
// ENGINE_SECRET env var, which pg_cron supplies from Vault. Same pattern as
// taste-engine.
//
// Request  : POST { trigger?, action?, force_pool?, reselect_schedule_id? }
//   action  'tick' (default) | 'refresh_pool' | 'status'
// Response : 200 { ok, ... }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { assertLibraryInSync } from './filterLibrary.ts'
import { refreshCandidatePool } from './pool.ts'
import { diagnoseThemes, NO_REPEAT_DAYS, selectForDrop } from './selection.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ENGINE_SECRET = Deno.env.get('ENGINE_SECRET') || ''
const PROXY_URL = `${SUPABASE_URL}/functions/v1/igdb-proxy`

// Mirror the client + taste-engine throttle exactly.
const RATE_WINDOW_MS = 1000
const RATE_MAX = 4
const MAX_CONCURRENCY = 8
const MULTIQUERY_MAX_SUBQUERIES = 10

// How far ahead to keep the calendar filled, and how far ahead to pre-select.
// Windows are 3-4 days, so 12 days of lookahead pre-selects the current window
// plus the next three — the job can fail for over a week without a user ever
// seeing an empty drop.
const SCHEDULE_HORIZON_WEEKS = 4
const LOOKAHEAD_DAYS = 12

// Games do not cross a rating floor overnight, and the pool is the only IGDB
// cost in the system. Refresh at most every 3 days.
const POOL_TTL_MS = 3 * 24 * 60 * 60 * 1000

const PAGE_SIZE = 1000 // Supabase caps a single select at 1000 rows

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

/**
 * Bundle sub-queries into /multiquery POSTs (<=10 each), <=8 POSTs in flight.
 * Turns a full pool refresh into ~4 requests instead of ~31.
 */
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

// ── Supabase helpers ────────────────────────────────────────────────────────
async function selectAllRows(supabase: any, table: string, columns: string) {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

// ── The tick ────────────────────────────────────────────────────────────────
async function runTick(supabase: any, opts: { forcePool?: boolean; reselectId?: string }) {
  const report: any = { pool: null, scheduled: 0, selections: [] }

  // 1. The DB validates author compositions against drop_filter_types. If that
  // registry lists a type this code cannot evaluate, an owner could save a
  // theme that passes validation and then fails at selection — precisely the
  // failure mode the design exists to prevent. Check before doing any work.
  const { data: registry, error: regErr } = await supabase.from('drop_filter_types').select('key')
  if (regErr) throw new Error(`drop_filter_types read failed: ${regErr.message}`)
  assertLibraryInSync((registry ?? []).map((r: any) => r.key))

  // 2. Fill the calendar forward.
  const { data: created, error: schedErr } = await supabase.rpc('ensure_drop_schedule', {
    horizon_weeks: SCHEDULE_HORIZON_WEEKS,
  })
  if (schedErr) throw new Error(`ensure_drop_schedule failed: ${schedErr.message}`)
  report.scheduled = created ?? 0

  // 3. Refresh the pool if stale. The only IGDB traffic in the system.
  const { data: freshRow } = await supabase
    .from('drop_candidate_pool')
    .select('refreshed_at')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastRefresh = freshRow?.refreshed_at ? Date.parse(freshRow.refreshed_at) : 0
  const poolStale = Date.now() - lastRefresh > POOL_TTL_MS

  if (opts.forcePool || poolStale) {
    report.pool = await refreshCandidatePool(supabase, igdbMulti, igdb)
  } else {
    report.pool = { skipped: true, reason: 'fresh', last_refresh: freshRow?.refreshed_at }
  }

  // 4. Select for every pending window inside the lookahead.
  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS * 86400000).toISOString()
  const { data: windows, error: winErr } = await supabase
    .from('drop_schedule')
    .select('id, slot, theme_id, starts_at, ends_at, cycle_index, selection_state')
    .lte('starts_at', horizon)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
  if (winErr) throw new Error(`drop_schedule read failed: ${winErr.message}`)

  const pending = (windows ?? []).filter(
    (w: any) => w.selection_state !== 'selected' || w.id === opts.reselectId,
  )
  if (!pending.length) return report

  // Load the pool once and reuse it for every window in this tick.
  const pool = await selectAllRows(
    supabase,
    'drop_candidate_pool',
    'igdb_game_id, name, cover_image_id, total_rating, total_rating_count, release_year, ' +
      'genre_ids, genre_names, theme_ids, theme_names, game_mode_ids, collection_ids, ' +
      'time_to_beat_seconds, time_to_beat_count, popularity_pct',
  )

  const { data: themes, error: themeErr } = await supabase
    .from('drop_themes')
    .select('id, slug, display_name, composition, drop_size')
  if (themeErr) throw new Error(`drop_themes read failed: ${themeErr.message}`)
  const themeById = new Map((themes ?? []).map((t: any) => [t.id, t]))

  for (const win of pending) {
    const theme = themeById.get(win.theme_id)
    if (!theme) {
      await markFailed(supabase, win.id, `Theme ${win.theme_id} no longer exists.`)
      report.selections.push({ schedule_id: win.id, error: 'missing_theme' })
      continue
    }

    try {
      // Re-selecting a window must not let it exclude its OWN previous picks.
      await supabase.from('drop_history').delete().eq('schedule_id', win.id)
      await supabase.from('drop_games').delete().eq('schedule_id', win.id)

      // (c) No-repeat. Dated from the WINDOW START, not now: a drop selected
      // days early would otherwise measure its window from the wrong instant.
      // No upper bound, so an already-selected future window also blocks a
      // repeat — two adjacent drops sharing a game is the exact thing this
      // rule exists to prevent.
      const cutoff = new Date(
        Date.parse(win.starts_at) - NO_REPEAT_DAYS * 86400000,
      ).toISOString()

      const recent = await selectRecentHistory(supabase, cutoff)

      const result = selectForDrop(
        pool,
        { slug: theme.slug, composition: theme.composition, drop_size: theme.drop_size },
        recent,
        win.id,
      )

      if (result.games.length) {
        const gameRows = result.games.map((g, i) => ({
          schedule_id: win.id,
          igdb_game_id: g.igdb_game_id,
          rank: i + 1,
          selection_score: g.selection_score,
          quality_score: g.quality_score,
          discovery_score: g.discovery_score,
          game_title: g.name,
          cover_image_id: g.cover_image_id,
          total_rating: g.total_rating,
          total_rating_count: g.total_rating_count,
          release_year: g.release_year,
          genre_ids: g.genre_ids,
          genre_names: g.genre_names,
          theme_names: g.theme_names,
          time_to_beat_seconds: g.time_to_beat_seconds,
        }))

        const { error: gErr } = await supabase.from('drop_games').insert(gameRows)
        if (gErr) throw new Error(`drop_games insert failed: ${gErr.message}`)

        const { error: hErr } = await supabase.from('drop_history').insert(
          result.games.map((g) => ({
            igdb_game_id: g.igdb_game_id,
            schedule_id: win.id,
            theme_id: theme.id,
            shown_at: win.starts_at,
          })),
        )
        if (hErr) throw new Error(`drop_history insert failed: ${hErr.message}`)
      }

      await supabase
        .from('drop_schedule')
        .update({
          selection_state: result.games.length ? 'selected' : 'failed',
          selection_note: result.audit.note,
          game_count: result.games.length,
          selected_at: new Date().toISOString(),
        })
        .eq('id', win.id)

      report.selections.push({
        schedule_id: win.id,
        slot: win.slot,
        starts_at: win.starts_at,
        theme: theme.slug,
        ...result.audit,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markFailed(supabase, win.id, message)
      report.selections.push({ schedule_id: win.id, theme: theme.slug, error: message })
    }
  }

  return report
}

async function selectRecentHistory(supabase: any, cutoffIso: string): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('drop_history')
      .select('igdb_game_id')
      .gt('shown_at', cutoffIso)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`drop_history read failed: ${error.message}`)
    for (const r of data ?? []) ids.add(Number(r.igdb_game_id))
    if (!data || data.length < PAGE_SIZE) break
  }
  return ids
}

async function markFailed(supabase: any, scheduleId: string, note: string) {
  await supabase
    .from('drop_schedule')
    .update({ selection_state: 'failed', selection_note: note.slice(0, 500) })
    .eq('id', scheduleId)
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
      const { data } = await supabase.rpc('get_active_themed_drop', { target: null })
      payload = { active_drop: data }
    } else if (action === 'diagnose') {
      // Pool depth per theme. Run this after adding a theme — it is the only
      // way to know whether a new composition has enough games behind it to
      // stay fresh, and it uses the real filter library so the answer matches
      // what selection will actually do.
      const pool = await selectAllRows(
        supabase,
        'drop_candidate_pool',
        'igdb_game_id, name, total_rating, total_rating_count, release_year, genre_ids, ' +
          'genre_names, theme_ids, theme_names, game_mode_ids, collection_ids, ' +
          'time_to_beat_seconds, popularity_pct',
      )
      const { data: themes } = await supabase
        .from('drop_themes')
        .select('slug, display_name, composition, drop_size, slot_eligibility')
        .eq('is_active', true)
        .order('rotation_order')

      const withTtb = pool.filter((p: any) => p.time_to_beat_seconds != null).length
      payload = {
        pool_size: pool.length,
        time_to_beat_coverage: `${withTtb} / ${pool.length} (${((withTtb / pool.length) * 100).toFixed(1)}%)`,
        no_repeat_days: NO_REPEAT_DAYS,
        themes: diagnoseThemes(pool, themes ?? []),
      }
    } else if (action === 'refresh_pool') {
      payload = { pool: await refreshCandidatePool(supabase, igdbMulti, igdb) }
    } else {
      payload = await runTick(supabase, {
        forcePool: Boolean(body.force_pool),
        reselectId: body.reselect_schedule_id ?? null,
      })
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
    console.error('[themed-drops]', message)
    return new Response(
      JSON.stringify({ ok: false, error: message, duration_ms: Date.now() - started }),
      { status: 500, headers: jsonHeaders },
    )
  }
})
