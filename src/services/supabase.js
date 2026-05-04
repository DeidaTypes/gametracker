import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Hard fail loudly in dev. Without these, every auth call would silently
  // 401 and the empty-state debugging spiral is brutal. Better to crash
  // here with an actionable message.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Add them to your .env file at the project root and restart `npm run dev`.'
  )
}

/**
 * App-wide Supabase client.
 *
 * persistSession + autoRefreshToken keep the user logged in across page
 * reloads (session is stored in localStorage by default). detectSessionInUrl
 * lets future flows (magic link, OAuth) automatically pick up the session
 * fragment after a redirect back to the app.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})

export default supabase
