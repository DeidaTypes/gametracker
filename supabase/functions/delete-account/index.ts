// Supabase Edge Function — delete-account
//
// Called by the client after the user confirms deletion in the two-step
// sheet. Runs as service_role (bypasses RLS) so it can scrub PII, delete
// cross-table rows the anon/authenticated client cannot touch, and lock
// the auth credential itself.
//
// ── Deletion model (App Store / Apple 5.1.1(v) compliance) ────────────
// Apple requires deletion to ACTUALLY remove the account, not merely
// hide it behind a client-side flag. This function:
//
//   1. Hard-deletes every row that is exclusively the user's own private
//      data and has nothing else hanging off it via FK cascade (trackers,
//      journal, sessions, taste data, badges, streaks, goals, DMs,
//      blocks, follows, likes, saves, pins, reactions, list_comments,
//      list_collaborators, notifications, legacy activities log).
//
//   2. Leaves reviews / lists / comments / review_comments / activity_events
//      in place rather than deleting them. Each of those has OTHER USERS'
//      content hanging off it via ON DELETE CASCADE (comments, replies,
//      likes, saves, collaborators, pins) — hard-deleting the parent row
//      would silently destroy other people's contributions. Instead they
//      stay, attributed to the now-anonymized profile below, exactly like
//      the Reddit/Twitter "[deleted user]" convention.
//
//   3. Immediately and permanently scrubs every PII field on the
//      public.users row (name, handle, bio, avatar, banner, favorites,
//      badges, presence) and stamps deleted_at / deletion_reason. This is
//      not a "pending" flag — there is no restore path.
//
//   4. Locks the auth credential itself: a long random password + a
//      ~100-year ban_duration, so the account cannot sign back in via
//      password, magic link, or any linked OAuth identity. Existing
//      sessions are also revoked immediately.
//
// We deliberately do NOT call auth.admin.deleteUser() here. public.users.id
// has `ON DELETE CASCADE` back to auth.users(id), and reviews/lists/
// activity_events have their OWN children cascading from them — a hard
// delete of the auth row would ripple through and delete other users'
// comments/saves/collaborators on this user's reviews and lists. Locking
// the credential achieves the same "cannot be used again" outcome without
// that collateral damage. See the audit notes in the PR description for
// the full per-table reasoning and the live-data verification queries.
//
// There is intentionally no 30-day client-facing recovery window / restore
// RPC. A soft delete a user can undo by simply signing back in reads as
// "hidden," not "deleted," to an App Store reviewer testing the flow.
//
// Request  : POST /functions/v1/delete-account
//   Headers: Authorization: Bearer <user-jwt>
//   Body   : { reason?: string }   (optional churn reason)
//
// Response : 200 { ok: true }
//          : 401 if the JWT is invalid / missing
//          : 400 if no authenticated uid can be extracted
//          : 500 on unexpected DB errors

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ~100 years. GoTrue has no literal "forever" ban; a duration this long is
// the accepted way to express "permanent" without a magic sentinel value.
const PERMANENT_BAN_DURATION = '876600h'

// This project's GoTrue password policy requires at least one lowercase,
// one uppercase, one digit, and one special character. crypto.randomUUID()
// alone is all-lowercase hex + hyphens and satisfies none of the upper/
// digit-adjacent/special requirements reliably, so admin.updateUserById()
// rejected it with a 500 (discovered live: "auth lock: Password should
// contain at least one character of each: ..."), which aborted the
// function AFTER the users/data mutations had already committed — leaving
// the row anonymized but the credential still live and the client stuck on
// a generic error with no sign-out. This builds a random password that
// provably contains all four classes.
function generateCompliantRandomPassword(): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const special = '!@#$%^&*()_+-=[]{}'
  const all = lower + upper + digits + special
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)]

  // One guaranteed char from each required class...
  const required = [pick(lower), pick(upper), pick(digits), pick(special)]
  // ...plus a long random tail from the full set for entropy.
  const tail = Array.from({ length: 28 }, () => pick(all))

  // Shuffle so the required chars aren't predictably in the first 4 slots.
  const chars = [...required, ...tail]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

// Tables that hold ONLY this user's own data with nothing else cascading
// from them (verified against live FK constraints — see PR notes). Safe to
// hard-delete outright. `column` is the single-column ownership filter;
// tables needing an OR across two columns are handled separately below.
const OWNED_TABLES_SINGLE_COLUMN = [
  // play_sessions before game_trackers: deleting a session fires
  // fn_play_sessions_rollup (SECURITY DEFINER, AFTER DELETE), which tries to
  // decrement the matching game_trackers row. Deleting in this order means
  // that trigger's UPDATE is a harmless 0-row no-op instead of racing a
  // tracker row this same request is about to delete anyway.
  { table: 'play_sessions', column: 'user_id' },
  { table: 'game_trackers', column: 'user_id' },
  { table: 'journal_entries', column: 'user_id' },
  { table: 'game_journal', column: 'user_id' },
  { table: 'user_taste_vectors', column: 'user_id' },
  { table: 'user_swipe_signals', column: 'user_id' },
  { table: 'user_goals', column: 'user_id' },
  { table: 'user_streaks', column: 'user_id' },
  { table: 'user_streak_milestones', column: 'user_id' },
  { table: 'user_badges', column: 'user_id' },
  { table: 'review_pins', column: 'user_id' },
  { table: 'reactions', column: 'user_id' },
  { table: 'likes', column: 'user_id' },
  { table: 'review_likes', column: 'user_id' },
  { table: 'comment_likes', column: 'user_id' },
  { table: 'list_saves', column: 'user_id' },
  { table: 'list_collaborators', column: 'user_id' },
  { table: 'list_comments', column: 'user_id' },
  { table: 'activities', column: 'user_id' },
]

// Tables where the user can appear on either side of a relationship.
const OWNED_TABLES_TWO_COLUMNS = [
  { table: 'notifications', columns: ['recipient_user_id', 'actor_user_id'] },
  { table: 'direct_messages', columns: ['sender_id', 'recipient_id'] },
  { table: 'blocked_users', columns: ['blocker_id', 'blocked_id'] },
  { table: 'follows', columns: ['follower_id', 'followee_id'] },
]

Deno.serve(async (req: Request) => {
  // Handle pre-flight CORS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Auth ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Build a user-scoped client so we can verify the JWT and extract uid.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // User client — used only to verify the JWT and get uid.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const uid = user.id

  // ── Parse optional body ──────────────────────────────────────────
  let reason: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.reason === 'string' && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 120)
    }
  } catch {
    // body is optional — ignore parse errors
  }

  // ── Service-role client — bypasses RLS for cross-table deletes ───
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  try {
    // 0. Idempotency guard: if this account was already processed, don't
    //    redo the destructive work (and don't reset deleted_at's timestamp).
    const { data: existing, error: existingErr } = await admin
      .from('users')
      .select('deleted_at')
      .eq('id', uid)
      .maybeSingle()
    if (existingErr) throw existingErr

    if (!existing?.deleted_at) {
      // 1. Hard-delete single-column-owned tables.
      for (const { table, column } of OWNED_TABLES_SINGLE_COLUMN) {
        const { error } = await admin.from(table).delete().eq(column, uid)
        if (error) throw new Error(`${table}: ${error.message}`)
      }

      // 2. Hard-delete two-sided tables (either side of the relationship).
      for (const { table, columns } of OWNED_TABLES_TWO_COLUMNS) {
        const filter = columns.map((c) => `${c}.eq.${uid}`).join(',')
        const { error } = await admin.from(table).delete().or(filter)
        if (error) throw new Error(`${table}: ${error.message}`)
      }

      // NOTE: reviews, lists, comments, review_comments, and activity_events
      // are intentionally NOT touched here. See header comment — they stay,
      // now attributed to the anonymized profile row written below, so
      // other users' comments/likes/saves/collaborators/replies on this
      // user's content are not collaterally destroyed.

      // 3. Scrub PII + stamp deletion on the users row itself.
      const { error: updateErr } = await admin
        .from('users')
        .update({
          deleted_at: new Date().toISOString(),
          deletion_reason: reason,
          display_name: '[deleted user]',
          username: null,
          bio: null,
          avatar_url: null,
          banner_url: null,
          // favorite_games / showcase_badges are NOT NULL with array/jsonb
          // defaults on the live schema — clear to empty, not null.
          favorite_games: [],
          showcase_badges: [],
          current_obsessions: null,
          genre_badge: null,
          platform_badge: null,
          presence_opt_in: false,
          streak_share_opt_in: false,
        })
        .eq('id', uid)
      if (updateErr) throw new Error(`users: ${updateErr.message}`)
    }

    // 4. Lock the auth credential permanently: scramble the password and
    //    ban the account so it cannot sign in via password, magic link, or
    //    any linked OAuth identity. This — not deleteUser() — is what makes
    //    "deleted" durable without cascading into other users' content
    //    (see header comment).
    const randomPassword = generateCompliantRandomPassword()
    const { error: lockErr } = await admin.auth.admin.updateUserById(uid, {
      password: randomPassword,
      ban_duration: PERMANENT_BAN_DURATION,
    })
    if (lockErr) throw new Error(`auth lock: ${lockErr.message}`)

    // 5. Revoke any existing sessions immediately so already-issued tokens
    //    stop working right away rather than waiting for natural expiry.
    const { error: signOutErr } = await admin.auth.admin.signOut(uid, 'global')
    if (signOutErr) {
      // Non-fatal: the ban already blocks re-authentication. Log and continue.
      console.error('[delete-account] signOut failed (non-fatal):', signOutErr.message)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[delete-account] error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
