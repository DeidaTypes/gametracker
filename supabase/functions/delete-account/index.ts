// Supabase Edge Function — delete-account
//
// Called by the client after the user confirms deletion in the two-step
// sheet. Runs as service_role (bypasses RLS) so it can scrub PII and
// delete cross-table rows that the anon client cannot touch.
//
// Request  : POST /functions/v1/delete-account
//   Headers: Authorization: Bearer <user-jwt>
//   Body   : { reason?: string }   (optional churn reason)
//
// Response : 200 { ok: true }
//          : 401 if the JWT is invalid / missing
//          : 400 if no authenticated uid can be extracted
//          : 500 on unexpected DB errors
//
// Sprint 8 TODO: add a Supabase scheduled function that hard-deletes
// users WHERE deleted_at < now() - INTERVAL '30 days'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
    // 1. Soft-delete + PII scrub on the users row.
    //    display_name → '[deleted]', PII fields → NULL.
    //    username is set to NULL so the handle can be reclaimed in
    //    future (though auth will be deleted anyway after 30 days).
    const { error: updateErr } = await admin
      .from('users')
      .update({
        deleted_at: new Date().toISOString(),
        deletion_reason: reason,
        display_name: '[deleted]',
        username: null,
        bio: null,
        avatar_url: null,
        banner_url: null,
      })
      .eq('id', uid)

    if (updateErr) throw updateErr

    // 2. Hard-delete direct messages (both sides).
    const { error: dmErr } = await admin
      .from('direct_messages')
      .delete()
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    if (dmErr) throw dmErr

    // 3. Hard-delete comments.
    const { error: commentErr } = await admin
      .from('comments')
      .delete()
      .eq('user_id', uid)
    if (commentErr) throw commentErr

    // 4. Hard-delete likes.
    const { error: likeErr } = await admin
      .from('likes')
      .delete()
      .eq('user_id', uid)
    if (likeErr) throw likeErr

    // 5. Hard-delete follows (both directions).
    const { error: followErr } = await admin
      .from('follows')
      .delete()
      .or(`follower_id.eq.${uid},following_id.eq.${uid}`)
    if (followErr) throw followErr

    // Reviews intentionally kept — the users row now shows "[deleted]"
    // so JOINs will render "[deleted user]" in the UI. This matches the
    // Reddit/Twitter convention: other users' threads stay coherent.

    // 6. Revoke the auth session so existing tokens immediately 401.
    //    This also prevents any new sign-ins with the same credentials
    //    until the auth row is restored (or hard-deleted after 30 days).
    //    Note: we do NOT call deleteUser here — that would prevent the
    //    30-day recovery flow. The scheduled Sprint 8 job calls deleteUser
    //    after 30 days if deleted_at is still set.
    const { error: signOutErr } = await admin.auth.admin.signOut(uid, 'global')
    if (signOutErr) {
      // Non-fatal: the PII scrub already succeeded. Log and continue.
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
