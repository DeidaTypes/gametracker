// Supabase Edge Function — revenuecat-webhook
//
// RevenueCat calls this on every purchase lifecycle event. It is the only
// writer of public.users.plus_active / plus_expires_at besides the hourly
// expiry sweep (see migrations/20261026140000_plus.sql).
//
// Auth: deployed with --no-verify-jwt (RevenueCat sends no Supabase JWT) and
// gated on the Authorization header, which must equal REVENUECAT_WEBHOOK_SECRET
// (bare or as "Bearer <secret>").
//
// The event is treated as a signal, not as the source of truth. For every one
// of our users the event touches, the function reads that subscriber's current
// "plus" entitlement from the RevenueCat REST API and writes it. That is what
// RevenueCat recommends, and it gives us for free:
//   * idempotency — a redelivered event writes the same absolute state again;
//   * ordering    — a late EXPIRATION can't undo a newer RENEWAL;
//   * correctness — cancellations keep the future expiry (Plus stays on until
//     then), refunds come back already expired, grace periods are included,
//     transfers turn the old owner off and the new owner on.
//
// App user ids: the app calls Purchases.logIn(<supabase user id>), so our ids
// are UUIDs. Anonymous RevenueCat ids ($RCAnonymousID:...) and anything that is
// not an existing public.users row are ignored.
//
// Logging: event type and counts only. No user ids, product ids or receipts.
//
// Request  : POST /functions/v1/revenuecat-webhook
//   Headers: Authorization: <REVENUECAT_WEBHOOK_SECRET>
//   Body   : RevenueCat webhook payload { api_version, event: {...} }
// Response : 200 { updated, unchanged } | 200 { skipped: reason }
//          : 401 bad secret, 400 bad body, 503 not configured,
//          : 502 RevenueCat API error, 500 db error (RevenueCat retries non-2xx)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') || ''
const REVENUECAT_API_KEY = Deno.env.get('REVENUECAT_API_KEY') || ''

const ENTITLEMENT_ID = 'plus'

// The eight required by the spec, plus the four that also move the
// entitlement's expiry or active state. Without SUBSCRIPTION_EXTENDED the
// expiry sweep would switch Plus off at the old date.
const HANDLED_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'TRANSFER',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  }
  return diff === 0
}

function authorized(header: string): boolean {
  if (!WEBHOOK_SECRET) return false
  // Evaluate both so timing doesn't reveal which form was configured.
  const bare = safeEqual(header, WEBHOOK_SECRET)
  const bearer = safeEqual(header, `Bearer ${WEBHOOK_SECRET}`)
  return bare || bearer
}

function asIdList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

function candidateUserIds(event: Record<string, unknown>): string[] {
  const ids = [
    ...asIdList(event.app_user_id),
    ...asIdList(event.original_app_user_id),
    ...asIdList(event.aliases),
    ...asIdList(event.transferred_from),
    ...asIdList(event.transferred_to),
  ]
  return [...new Set(ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))]
}

type PlusState = { plus_active: boolean; plus_expires_at: string | null }

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

// Current "plus" state for one app user id, straight from RevenueCat.
async function fetchPlusState(appUserId: string): Promise<PlusState> {
  const res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${REVENUECAT_API_KEY}`, Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`revenuecat_api_${res.status}`)
  const body = await res.json()
  const ent = body?.subscriber?.entitlements?.[ENTITLEMENT_ID]
  if (!ent) return { plus_active: false, plus_expires_at: null }

  // Lifetime (non-renewing, no expiry) entitlements have expires_date null.
  const lifetime = ent.expires_date == null
  const expiresAt = lifetime
    ? null
    : laterOf(ent.expires_date ?? null, ent.grace_period_expires_date ?? null)
  const active = lifetime || (expiresAt !== null && Date.parse(expiresAt) > Date.now())
  return { plus_active: active, plus_expires_at: expiresAt }
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Date.parse(a) === Date.parse(b)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (!authorized(req.headers.get('Authorization') || '')) {
    return json(401, { error: 'unauthorized' })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !REVENUECAT_API_KEY) {
    console.error('[revenuecat-webhook] secrets are not configured')
    return json(503, { error: 'not_configured' })
  }

  let event: Record<string, unknown>
  try {
    const body = await req.json()
    event = body?.event
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      return json(400, { error: 'bad_body' })
    }
  } catch {
    return json(400, { error: 'bad_body' })
  }

  const type = event.type as string
  if (!HANDLED_EVENTS.has(type)) {
    return json(200, { skipped: 'event_type' })
  }

  const candidates = candidateUserIds(event)
  if (candidates.length === 0) {
    console.log(`[revenuecat-webhook] ${type}: no app user id to map`)
    return json(200, { skipped: 'no_user' })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: rows, error: lookupErr } = await admin
    .from('users')
    .select('id, plus_active, plus_expires_at')
    .in('id', candidates)
  if (lookupErr) {
    console.error(`[revenuecat-webhook] ${type}: user lookup failed: ${lookupErr.code}`)
    return json(500, { error: 'db_error' })
  }
  if (!rows || rows.length === 0) {
    console.log(`[revenuecat-webhook] ${type}: no matching user`)
    return json(200, { skipped: 'no_user' })
  }

  let updated = 0
  let unchanged = 0
  for (const row of rows) {
    let next: PlusState
    try {
      next = await fetchPlusState(row.id)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      console.error(`[revenuecat-webhook] ${type}: ${reason}`)
      return json(502, { error: 'revenuecat_api' })
    }

    if (
      row.plus_active === next.plus_active &&
      sameInstant(row.plus_expires_at, next.plus_expires_at)
    ) {
      unchanged++
      continue
    }

    const { error: updateErr } = await admin
      .from('users')
      .update(next)
      .eq('id', row.id)
    if (updateErr) {
      console.error(`[revenuecat-webhook] ${type}: update failed: ${updateErr.code}`)
      return json(500, { error: 'db_error' })
    }
    updated++
  }

  console.log(`[revenuecat-webhook] ${type}: updated=${updated} unchanged=${unchanged}`)
  return json(200, { updated, unchanged })
})
