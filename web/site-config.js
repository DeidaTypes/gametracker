/*
 * Checkpoint web — the one place to fill in values.
 *
 * Every page reads from here. Leave a value empty and whatever needs it is
 * hidden (App Store button) or shows a "not set yet" note on the Draft pages
 * (contact email), so nothing here is ever faked.
 *
 * SUPPORT_EMAIL  Contact address shown on /privacy, /terms and /support.
 *                Use the same address as VITE_SUPPORT_EMAIL in the app's .env.
 * APP_STORE_ID   Digits only, e.g. 1234567890. Turns on "Get the app".
 * TESTFLIGHT_URL Public TestFlight join link. Turns on "Join the beta" until
 *                APP_STORE_ID is set (must match testflight.apple.com/join/…).
 */
window.CHECKPOINT_SITE = {
  SUPPORT_EMAIL: 'support@getcheckpoint.app',
  APP_STORE_ID: '',
  TESTFLIGHT_URL: '',
}
