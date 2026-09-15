import { supabase } from './supabase'

/**
 * Calls the delete-account Edge Function.
 *
 * The function hard-deletes the user's private data (trackers, journal,
 * sessions, taste data, badges, streaks, goals, DMs, blocks, follows,
 * likes, saves, pins, reactions, notifications), leaves reviews/lists/
 * comments in place but attributed to an anonymized "[deleted user]"
 * profile (so other users' comment threads, saves, and collaborations
 * stay intact), and permanently locks the auth credential (scrambled
 * password + long ban) so the account cannot sign back in. There is no
 * recovery window — deletion is immediate and final, per Apple's
 * requirement that account deletion actually remove the account rather
 * than merely hide it.
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
