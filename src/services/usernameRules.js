/**
 * Username rules — the single definition of what a valid handle is.
 *
 * These rules are mirrored exactly in SQL by
 * supabase/migrations/20260804000100_username_uniqueness.sql (the
 * `username_format` / `username_not_reserved` CHECK constraints and the
 * `users_username_lower_key` unique index). If you change a rule here, change
 * it there in the same commit — the DB is the backstop that decides who wins a
 * race, so the two drifting apart means the client promises a handle the
 * database will reject.
 *
 * THE RULES
 *   - 3–20 characters
 *   - lowercase letters, digits and underscore only ([a-z0-9_])
 *   - must start and end with a letter or digit (no leading/trailing underscore)
 *   - no consecutive underscores
 *   - not a reserved word (see RESERVED_USERNAMES)
 *   - unique case-insensitively — "Hayakawa" and "hayakawa" are the same handle
 *
 * Case is not a rule so much as a normalisation: input is lowercased before it
 * is ever validated or stored, so uppercase never reaches the database.
 */

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

/**
 * Structural pattern: alphanumeric bookends with an optional [a-z0-9_] middle.
 * The bookends are what enforce "no leading/trailing underscore", and the
 * {1,18} middle is what pins total length to 3–20.
 *
 * Deliberately written without lookbehind — Safari only gained support in
 * 16.4 and this ships inside a WKWebView.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/

/** Consecutive underscores are checked separately so we can explain them. */
const CONSECUTIVE_SEPARATORS = /__/

/** Default hint shown under the field before the user has typed anything. */
export const USERNAME_HINT = `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters: letters, numbers, underscores.`

/**
 * Handles we will not hand out. Two categories:
 *   - impersonation risk (admin, support, official, staff…)
 *   - route collisions, since profiles are addressed as /:username and a user
 *     called "settings" would shadow the settings screen.
 *
 * Mirrored by private.is_username_reserved() in the migration. Sorted so the
 * two lists can be diffed by eye.
 */
export const RESERVED_USERNAMES = Object.freeze([
  'about',
  'account',
  'admin',
  'administrator',
  'api',
  'auth',
  'billing',
  'checkpoint',
  'contact',
  'discover',
  'explore',
  'feed',
  'game',
  'games',
  'help',
  'home',
  'legal',
  'library',
  'list',
  'lists',
  'login',
  'logout',
  'mail',
  'me',
  'messages',
  'mod',
  'moderator',
  'notifications',
  'null',
  'official',
  'onboarding',
  'password',
  'privacy',
  'profile',
  'review',
  'reviews',
  'root',
  'search',
  'security',
  'settings',
  'signin',
  'signup',
  'staff',
  'support',
  'system',
  'team',
  'terms',
  'undefined',
  'user',
  'users',
  'www',
])

const RESERVED_SET = new Set(RESERVED_USERNAMES)

/**
 * Lowercase, strip a leading @, and drop every character the rules disallow.
 *
 * This is intentionally lossy rather than rejecting: it is wired to the input's
 * onChange so the field can only ever contain legal characters, which means the
 * user never types something that silently fails later.
 */
export function normalizeUsername(input) {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
}

export function isUsernameReserved(username) {
  return RESERVED_SET.has(normalizeUsername(username))
}

/**
 * Validate a handle against every structural rule.
 *
 * Returns the reason rather than a bare boolean so the UI can say which rule
 * was broken instead of repeating the generic hint at the user.
 *
 * @param {string} input raw user input; normalised internally
 * @returns {{ valid: boolean, reason: string|null, message: string|null, username: string }}
 */
export function validateUsername(input) {
  const username = normalizeUsername(input)
  const ok = { valid: true, reason: null, message: null, username }
  const fail = (reason, message) => ({ valid: false, reason, message, username })

  if (!username) {
    return fail('empty', 'Please choose a username.')
  }
  if (username.length < USERNAME_MIN_LENGTH) {
    return fail('too_short', `At least ${USERNAME_MIN_LENGTH} characters`)
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return fail('too_long', `At most ${USERNAME_MAX_LENGTH} characters`)
  }
  if (username.startsWith('_') || username.endsWith('_')) {
    return fail(
      'edge_separator',
      'Can’t start or end with an underscore'
    )
  }
  if (CONSECUTIVE_SEPARATORS.test(username)) {
    return fail('repeated_separator', 'No two underscores in a row')
  }
  if (RESERVED_SET.has(username)) {
    return fail('reserved', 'That username is reserved')
  }
  if (!USERNAME_PATTERN.test(username)) {
    return fail('format', USERNAME_HINT)
  }
  return ok
}

/** True when the handle passes every structural rule. */
export function isUsernameValid(input) {
  return validateUsername(input).valid
}
