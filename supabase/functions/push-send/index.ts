// Supabase Edge Function — push-send
//
// Sends one APNs push per device token for a notification row, a direct
// message, or a badge refresh. Called only by the database (pg_net triggers
// in 20261022190000_push.sql), never by the app.
//
// Auth: deployed with --no-verify-jwt and gated on a shared `x-push-secret`
// header that must equal PUSH_SEND_SECRET (the same value lives in Vault as
// push_send_secret so the triggers can send it).
//
// Every decision about WHETHER to push (self, deleted users, blocks, push
// prefs, previews) is made in SQL by public.push_context. This function only
// turns the answer into an APNs request, and deletes tokens APNs reports as
// dead.
//
// APNs uses token-based auth (a .p8 key). Secrets:
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (full .p8 contents),
//   APNS_BUNDLE_ID, APNS_ENV ('sandbox' | 'production'), PUSH_SEND_SECRET
// If any is missing the function answers 503 and sends nothing.
//
// Request  : POST /functions/v1/push-send
//   Headers: x-push-secret: <PUSH_SEND_SECRET>
//   Body   : { source: 'notification' | 'message' | 'badge', id: uuid }
// Response : 200 { sent, failed, removed } | 200 { skipped: reason }
//          : 401 bad secret, 400 bad body, 503 not configured, 500 db error

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const PUSH_SEND_SECRET = Deno.env.get('PUSH_SEND_SECRET') || ''
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') || ''
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') || ''
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') || ''
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') || ''
const APNS_ENV = (Deno.env.get('APNS_ENV') || '').trim().toLowerCase()

const APNS_HOSTS: Record<string, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

const SOURCES = new Set(['notification', 'message', 'badge'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREVIEW_CHARS = 60

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

/* ============================================================
   APNs provider token (ES256 JWT)
   ============================================================ */

// Apple rejects tokens older than an hour and throttles refreshes faster
// than every 20 minutes; 50 minutes sits between the two.
const JWT_TTL_MS = 50 * 60 * 1000
let cachedJwt: { token: string; issuedAt: number } | null = null
let cachedKey: CryptoKey | null = null

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  // Accept the .p8 as pasted (real newlines) or with literal "\n" escapes.
  const b64 = APNS_PRIVATE_KEY
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  cachedKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  return cachedKey
}

async function providerToken(): Promise<string> {
  const now = Date.now()
  if (cachedJwt && now - cachedJwt.issuedAt < JWT_TTL_MS) return cachedJwt.token
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }))
  const claims = base64Url(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(now / 1000) }))
  const input = `${header}.${claims}`
  // WebCrypto returns the raw r||s signature, which is what JWS ES256 wants.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await signingKey(),
    new TextEncoder().encode(input),
  )
  const token = `${input}.${base64Url(new Uint8Array(sig))}`
  cachedJwt = { token, issuedAt: now }
  return token
}

/* ============================================================
   Copy and routes — mirror COPY / routeFor in
   src/pages/NotificationsInbox.jsx. Keep the two in step.
   ============================================================ */

type Actor = { id: string; username: string | null; display_name: string | null } | null
type Payload = Record<string, unknown>
type Context = {
  send: true
  source: 'notification' | 'message' | 'badge'
  type: string
  recipient_id: string
  actor: Actor
  entity_id: string | null
  payload: Payload
  preview: string | null
  badge: number
  tokens: string[]
}

const COPY: Record<string, { actor: boolean; text: string; title?: (p: Payload) => unknown }> = {
  follow: { actor: true, text: 'started following you' },
  reaction: { actor: true, text: 'reacted to your review' },
  comment: { actor: true, text: 'commented on your review' },
  friend_started: { actor: true, text: 'started playing a game in your backlog' },
  review_like: { actor: true, text: 'liked your review' },
  list_comment: { actor: true, text: 'commented on your list', title: (p) => p.list_title },
  mention: { actor: true, text: 'mentioned you' },
  qa_answer: { actor: true, text: 'answered your question' },
  qa_best: { actor: true, text: 'picked your answer as best' },
  qa_stuck_answered: { actor: false, text: "A question you're stuck on was answered" },
  admin_report: { actor: false, text: 'New report to review' },
}

function actorName(actor: Actor): string {
  return actor?.display_name || actor?.username || 'Someone'
}

function alertBody(ctx: Context): string | null {
  if (ctx.source === 'message') {
    const name = actorName(ctx.actor)
    if (!ctx.preview) return `New message from ${name}`
    const text = ctx.preview.length > PREVIEW_CHARS
      ? `${ctx.preview.slice(0, PREVIEW_CHARS).trimEnd()}…`
      : ctx.preview
    return `${name}: ${text}`
  }
  const copy = COPY[ctx.type]
  if (!copy) return null
  if (!copy.actor) return copy.text
  const title = copy.title ? copy.title(ctx.payload) : null
  return `${actorName(ctx.actor)} ${copy.text}${typeof title === 'string' && title ? ` ${title}` : ''}`
}

type Route = { path: string; state?: Record<string, string> }

function qaRoute(p: Payload): Route | null {
  if (typeof p.question_id !== 'string') return null
  return {
    path: `/qa/q/${p.question_id}`,
    ...(typeof p.answer_id === 'string' ? { state: { focusAnswerId: p.answer_id } } : {}),
  }
}

function routeFor(ctx: Context): Route | null {
  const p = ctx.payload || {}
  const username = ctx.actor?.username
  if (ctx.source === 'message') {
    return { path: username ? `/messages/${encodeURIComponent(username)}` : '/messages' }
  }
  switch (ctx.type) {
    case 'follow':
      return username ? { path: `/user/${encodeURIComponent(username)}` } : null
    case 'reaction':
    case 'comment':
    case 'review_like':
      return ctx.entity_id ? { path: `/review/${ctx.entity_id}` } : null
    case 'friend_started':
      return ctx.entity_id ? { path: `/game/${ctx.entity_id}` } : null
    case 'list_comment': {
      const id = (typeof p.list_id === 'string' && p.list_id) || ctx.entity_id
      return id ? { path: `/list/${id}` } : null
    }
    case 'qa_answer':
    case 'qa_stuck_answered':
    case 'qa_best':
      return qaRoute(p)
    case 'mention':
      if (p.source === 'review_comment' && typeof p.review_id === 'string') {
        return { path: `/reviews/${p.review_id}/comments` }
      }
      if (p.source === 'activity_comment' && typeof p.activity_event_id === 'string') {
        return { path: `/activity/${p.activity_event_id}/comments` }
      }
      if (p.source === 'list_comment' && typeof p.list_id === 'string') {
        return { path: `/list/${p.list_id}` }
      }
      if (p.source === 'qa_answer') return qaRoute(p)
      return null
    case 'admin_report':
      return { path: '/settings/moderation' }
    default:
      return null
  }
}

/* ============================================================
   Send
   ============================================================ */

type Result = { token: string; status: number; reason: string | null }

async function sendOne(token: string, body: string, priority: 5 | 10): Promise<Result> {
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken()}`,
    'apns-topic': APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': String(priority),
    'content-type': 'application/json',
  }
  try {
    const res = await fetch(`${APNS_HOSTS[APNS_ENV]}/3/device/${token}`, {
      method: 'POST',
      headers,
      body,
    })
    let reason: string | null = null
    if (res.status !== 200) {
      try {
        reason = (await res.json())?.reason ?? null
      } catch {
        reason = null
      }
    } else {
      await res.body?.cancel()
    }
    if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') cachedJwt = null
    return { token, status: res.status, reason }
  } catch (err) {
    console.error('[push-send] APNs request failed:', err instanceof Error ? err.message : String(err))
    return { token, status: 0, reason: 'network' }
  }
}

// 410 = the app was removed / token retired. BadDeviceToken also fires when
// a sandbox token is sent to production (or the reverse); the app registers
// again on its next launch, so deleting is safe either way.
function isDeadToken(r: Result): boolean {
  return r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken')
}

/* ============================================================
   Handler
   ============================================================ */

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  if (!PUSH_SEND_SECRET || !safeEqual(req.headers.get('x-push-secret') || '', PUSH_SEND_SECRET)) {
    return json(401, { error: 'unauthorized' })
  }

  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY || !APNS_BUNDLE_ID || !APNS_HOSTS[APNS_ENV]) {
    console.error('[push-send] APNs secrets are not configured')
    return json(503, { error: 'apns_not_configured' })
  }

  let source: string
  let id: string
  try {
    const body = await req.json()
    source = String(body?.source || '')
    id = String(body?.id || '')
  } catch {
    return json(400, { error: 'bad_body' })
  }
  if (!SOURCES.has(source) || !UUID_RE.test(id)) return json(400, { error: 'bad_body' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data, error } = await admin.rpc('push_context', { p_source: source, p_id: id })
  if (error) {
    console.error('[push-send] push_context failed:', error.message)
    return json(500, { error: 'context_failed' })
  }
  if (!data?.send) return json(200, { skipped: data?.reason ?? 'unknown' })

  const ctx = data as Context
  if (ctx.source !== 'badge' && ctx.actor?.id && ctx.actor.id === ctx.recipient_id) {
    return json(200, { skipped: 'self' })
  }

  const badge = Math.max(0, Number(ctx.badge) || 0)
  let payload: Record<string, unknown>
  let priority: 5 | 10

  // content-available lets AppDelegate apply the badge while the app is open:
  // iOS does not touch the icon badge for a push that arrives in the foreground.
  if (ctx.source === 'badge') {
    payload = { aps: { badge, 'content-available': 1 } }
    priority = 5
  } else {
    const alert = alertBody(ctx)
    if (!alert) return json(200, { skipped: 'no_copy' })
    const route = routeFor(ctx)
    // Groups DMs per sender (and everything else per type) in Notification Center.
    const threadId = ctx.source === 'message' && ctx.actor?.id ? `dm:${ctx.actor.id}` : ctx.type
    payload = {
      aps: {
        alert: { body: alert },
        badge,
        sound: 'default',
        'thread-id': threadId,
        'content-available': 1,
      },
      ...(route ? { path: route.path } : {}),
      ...(route?.state ? { state: route.state } : {}),
    }
    priority = 10
  }

  const body = JSON.stringify(payload)
  const tokens = Array.isArray(ctx.tokens) ? ctx.tokens : []
  const results = await Promise.all(tokens.map((t) => sendOne(t, body, priority)))

  const dead = results.filter(isDeadToken).map((r) => r.token)
  if (dead.length > 0) {
    const { error: delErr } = await admin.from('device_tokens').delete().in('token', dead)
    if (delErr) console.error('[push-send] dead token cleanup failed:', delErr.message)
  }

  const failed = results.filter((r) => r.status !== 200)
  for (const f of failed) {
    if (!isDeadToken(f)) console.error(`[push-send] APNs ${f.status}: ${f.reason ?? 'unknown'}`)
  }

  return json(200, {
    sent: results.length - failed.length,
    failed: failed.length,
    removed: dead.length,
  })
})
