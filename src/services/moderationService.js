import { supabase } from './supabase'
import { SUPPORT_EMAIL } from '../config/site'

/**
 * Moderation — UGC text errors, terms consent, and the admin report queue.
 *
 * Server side lives in supabase/migrations/20261022143000_ugc_safety.sql:
 *   - every user-text table has a trigger that raises message
 *     'content_blocked' (blocklist hit) or 'account_suspended'
 *   - accept_terms() / my_account_status() for consent
 *   - admin_reports / admin_open_report_count / admin_resolve_report, each
 *     gated on flag_enabled('admin') in the database
 */

export const CONTENT_BLOCKED = 'content_blocked'
export const ACCOUNT_SUSPENDED = 'account_suspended'
export const MODERATION_CHANGED_EVENT = 'gt:moderation-changed'

export const CONTENT_BLOCKED_MESSAGE =
  "That includes language we don't allow on Checkpoint. Edit it and try again."

export function accountSuspendedMessage() {
  return SUPPORT_EMAIL
    ? `Your account can't post right now. Contact support at ${SUPPORT_EMAIL}.`
    : "Your account can't post right now. Contact support."
}

function errorText(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return [err.code, err.message, err.details, err.hint, err.cause?.message, err.cause?.code]
    .filter((part) => typeof part === 'string')
    .join(' ')
}

/**
 * Which moderation rule rejected a write, or null for any other failure.
 * Works on raw PostgREST errors, on service errors that re-throw
 * `new Error(error.message)`, and on qaService's `{ code }` results.
 *
 * @returns {'content_blocked'|'account_suspended'|null}
 */
export function ugcErrorKind(err) {
  const text = errorText(err)
  if (text.includes(CONTENT_BLOCKED)) return CONTENT_BLOCKED
  if (text.includes(ACCOUNT_SUSPENDED)) return ACCOUNT_SUSPENDED
  return null
}

/** The inline composer message for a moderation rejection, or null. */
export function ugcErrorMessage(err) {
  const kind = ugcErrorKind(err)
  if (kind === CONTENT_BLOCKED) return CONTENT_BLOCKED_MESSAGE
  if (kind === ACCOUNT_SUSPENDED) return accountSuspendedMessage()
  return null
}

/**
 * Pre-flight for sign-up, where a blocked handle would otherwise fail inside
 * the auth insert with a generic error. Fails open: the trigger still decides.
 *
 * @param {string} text
 * @param {'text'|'username'} [kind]
 */
export async function isTextAllowed(text, kind = 'text') {
  if (!text || !String(text).trim()) return true
  try {
    const { data, error } = await supabase.rpc('text_allowed', { p_text: String(text), p_kind: kind })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}

/* ============================================================
   Terms consent
   ============================================================ */

// Sign-up records consent right after the account exists, but the auth state
// change that mounts the terms check fires before signUp() returns. A hold
// makes that check wait for the sign-up's own accept_terms() call.
let termsHold = null

/** Returns a release function. Always call it, success or failure. */
export function holdTermsCheck() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  const hold = { promise }
  termsHold = hold
  return () => {
    release()
    if (termsHold === hold) termsHold = null
  }
}

/** Stamps users.terms_accepted_at for the signed-in user. Throws on failure. */
export async function acceptTerms() {
  const { data, error } = await supabase.rpc('accept_terms')
  if (error) throw error
  return data
}

/**
 * The signed-in user's consent and suspension state, or null when it could
 * not be read (offline, signed out). Null never shows the terms popup.
 *
 * @returns {Promise<{ terms_accepted_at: string|null, suspended: boolean }|null>}
 */
export async function getAccountStatus() {
  if (termsHold) await termsHold.promise
  try {
    const { data, error } = await supabase.rpc('my_account_status')
    if (error || !data || typeof data !== 'object') return null
    return {
      terms_accepted_at: data.terms_accepted_at || null,
      suspended: data.suspended === true,
    }
  } catch {
    return null
  }
}

/* ============================================================
   Admin queue (flag 'admin'; the RPCs re-check server-side)
   ============================================================ */

/** Open reports, newest first. Throws on failure. */
export async function getOpenReports() {
  const { data, error } = await supabase.rpc('admin_reports', { p_status: 'pending' })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

/** Open report count, or null when it could not be read. */
export async function getOpenReportCount() {
  try {
    const { data, error } = await supabase.rpc('admin_open_report_count')
    if (error) return null
    return typeof data === 'number' ? data : null
  } catch {
    return null
  }
}

/**
 * @param {string} reportId
 * @param {'dismiss'|'remove_content'|'suspend_user'} action
 */
export async function resolveReport(reportId, action) {
  const { data, error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_action: action,
  })
  if (error) throw error
  try {
    window.dispatchEvent(new Event(MODERATION_CHANGED_EVENT))
  } catch {
    // SSR / no-window
  }
  return data
}
