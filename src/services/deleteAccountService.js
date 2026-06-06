import { supabase } from './supabase'

/**
 * Calls the delete-account Edge Function.
 *
 * The function scrubs PII, hard-deletes messages/comments/likes/follows,
 * and revokes the current auth session. Reviews are left with an
 * anonymised author so other users' threads stay coherent.
 *
 * @param {string|null} reason  Optional churn reason from the dropdown.
 * @throws {Error} on network failure or non-2xx response.
 */
export async function deleteAccount(reason = null) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('No active session. Please sign in first.')
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set.')
  }

  const url = `${supabaseUrl}/functions/v1/delete-account`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
    body: JSON.stringify({ reason }),
  })

  if (!res.ok) {
    let message = `Server error ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
}

/**
 * Checks whether the signed-in user has a pending soft-deletion.
 *
 * Returns null if there is no active session or the profile row doesn't
 * exist. Returns an object with `deleted_at` if the account is pending.
 *
 * @returns {Promise<{ deleted_at: string } | null>}
 */
export async function getPendingDeletion() {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) return null

  // We must bypass the normal `deleted_at IS NULL` RLS filter here.
  // The users_select_own policy allows the owner to read their own row
  // regardless of deleted_at, so this call will succeed.
  const { data, error } = await supabase
    .from('users')
    .select('deleted_at')
    .eq('id', session.user.id)
    .maybeSingle()

  if (error || !data) return null
  if (!data.deleted_at) return null
  return { deleted_at: data.deleted_at }
}

/**
 * Restores a soft-deleted account within the 30-day recovery window.
 * Calls the restore_deleted_account() Postgres function (SECURITY DEFINER).
 *
 * @throws {Error} if the RPC fails.
 */
export async function restoreAccount() {
  const { error } = await supabase.rpc('restore_deleted_account')
  if (error) throw new Error(error.message)
}

/**
 * Calculates the number of days remaining in the 30-day recovery window.
 *
 * @param {string} deletedAt  ISO timestamp string from the users row.
 * @returns {number}  days remaining, clamped to [0, 30].
 */
export function daysUntilHardDelete(deletedAt) {
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const deletedMs = new Date(deletedAt).getTime()
  const expiresMs = deletedMs + WINDOW_MS
  const remaining = Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000))
  return Math.max(0, Math.min(30, remaining))
}
