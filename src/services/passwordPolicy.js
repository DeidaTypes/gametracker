import { fetchWithTimeout } from '../utils/fetchWithTimeout'

/**
 * Password policy — composition rules, strength scoring, and leaked-password
 * screening for the sign-up flow.
 *
 * Composition rules mirror the server-side config pushed to this project's
 * Supabase Auth settings (min length 8 + lower/upper/digit/symbol required —
 * see Management API `config/auth`: password_min_length, 
 * password_required_characters), so a password accepted here will also be
 * accepted by supabase.auth.signUp().
 *
 * Leaked-password screening: Supabase's own HaveIBeenPwned integration
 * (`password_hibp_enabled`) requires a Pro-plan project — this project is on
 * the Free plan, so that server-side check is unavailable (confirmed via the
 * Management API, which returns "available on Pro Plans and up"). As a
 * best-effort substitute we run the same HaveIBeenPwned Pwned Passwords
 * check client-side using k-anonymity (only a 5-char SHA-1 prefix ever
 * leaves the device — the full password and full hash never do). This
 * should be swapped for the native `password_hibp_enabled` server flag the
 * moment the project upgrades to Pro; see BACKEND_SCHEMA.md / deferred work.
 */

export const PASSWORD_MIN_LENGTH = 8

// Matches the symbol set Supabase's own `password_required_characters`
// config accepts, so "special character" here always agrees with the
// server-side check.
const SPECIAL_CHAR_PATTERN = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/

/**
 * @param {string} password
 * @returns {{ minLength: boolean, hasUppercase: boolean, hasNumber: boolean, hasSpecial: boolean }}
 */
export function getPasswordRequirements(password = '') {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: SPECIAL_CHAR_PATTERN.test(password),
  }
}

/** True once every composition rule (length, uppercase, number, special) passes. */
export function isPasswordComposedCorrectly(password = '') {
  const req = getPasswordRequirements(password)
  return req.minLength && req.hasUppercase && req.hasNumber && req.hasSpecial
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']

/**
 * 0–4 score = number of satisfied composition rules. Drives the 4-segment
 * strength bar (one segment per rule) and its "Strength: {label}" caption.
 */
export function getPasswordStrengthScore(password = '') {
  const req = getPasswordRequirements(password)
  return Object.values(req).filter(Boolean).length
}

export function getPasswordStrengthLabel(score) {
  return STRENGTH_LABELS[Math.max(0, Math.min(score, STRENGTH_LABELS.length - 1))]
}

/**
 * Ordered chip data for the 2-column requirements grid. `breachStatus` is
 * one of 'idle' | 'checking' | 'clear' | 'breached' (see
 * checkPasswordNotBreached below) — the chip only fills in on 'clear'.
 */
export function getPasswordRequirementChips(password, breachStatus) {
  const req = getPasswordRequirements(password)
  return [
    { id: 'length', label: '8+ characters', satisfied: req.minLength },
    { id: 'upper', label: 'Uppercase', satisfied: req.hasUppercase },
    { id: 'number', label: 'Number', satisfied: req.hasNumber },
    { id: 'special', label: 'Special character', satisfied: req.hasSpecial },
    {
      id: 'breach',
      label: 'Not a common or previously breached password',
      satisfied: breachStatus === 'clear',
    },
  ]
}

/**
 * Single next-unmet-requirement message, evaluated in priority order:
 * length → uppercase → number → special char → breach check. Returns null
 * once every check (including the async breach screen) has passed, so the
 * caller can swap in a "Looks good" success state instead.
 *
 * Drives a single dynamic hint line rather than a checklist grid — only
 * ever the next thing the user needs to fix is shown.
 *
 * @param {string} password
 * @param {'idle'|'checking'|'clear'|'breached'} [breachStatus]
 * @returns {string|null}
 */
export function getNextPasswordRequirement(password = '', breachStatus = 'idle') {
  const req = getPasswordRequirements(password)
  if (!req.minLength) return `At least ${PASSWORD_MIN_LENGTH} characters`
  if (!req.hasUppercase) return 'Add an uppercase letter'
  if (!req.hasNumber) return 'Add a number'
  if (!req.hasSpecial) return 'Add a special character'
  if (breachStatus === 'checking') return 'Checking against known breaches…'
  if (breachStatus === 'breached') {
    return 'This password has appeared in a known data breach'
  }
  return null
}

async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * k-anonymity HaveIBeenPwned lookup: hash the password locally, send only
 * the first 5 hex chars, and check the returned suffix list ourselves. The
 * full password/hash never leaves the device.
 *
 * Soft-fails open (resolves `false` = "not known breached") on any network
 * or crypto error — matching this codebase's existing convention (see
 * `isUsernameAvailableRemote` in services/auth.js) of never blocking a
 * legitimate signup because an auxiliary check couldn't complete.
 *
 * @param {string} password
 * @returns {Promise<boolean>} true only when the password IS found in a known breach
 */
export async function isPasswordBreached(password) {
  if (!password || typeof crypto?.subtle?.digest !== 'function') return false
  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const res = await fetchWithTimeout(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {},
      6000
    )
    if (!res.ok) return false
    const body = await res.text()
    return body
      .split('\n')
      .some((line) => line.split(':')[0].trim() === suffix)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[passwordPolicy] breach check failed (soft-fail open):', err?.message)
    return false
  }
}
