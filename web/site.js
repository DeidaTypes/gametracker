/*
 * Checkpoint web — shared page behavior. No dependencies, no network calls.
 * Values come from site-config.js.
 *
 * Share landing pages (/r, /l, /q, /u) show NO user content. The only text
 * that appears is the optional ?t=<title> that the app put in the link, and
 * it is always written with textContent, never as HTML.
 */
;(function () {
  var config = window.CHECKPOINT_SITE || {}
  var SUPPORT_EMAIL = String(config.SUPPORT_EMAIL || '').trim()
  var APP_STORE_ID = String(config.APP_STORE_ID || '').trim()
  var TESTFLIGHT_URL = String(config.TESTFLIGHT_URL || '').trim()
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL)
  var STORE_ID_OK = /^\d{6,}$/.test(APP_STORE_ID) && !/^0+$/.test(APP_STORE_ID)
  var TESTFLIGHT_OK = /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/.test(
    TESTFLIGHT_URL
  )
  var BETA_ON = TESTFLIGHT_OK && !STORE_ID_OK
  var BETA_NOTE =
    'Checkpoint is in beta on TestFlight. Install it, then tap your link again to open it in the app.'

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn)
  }

  function validInviteRef(raw) {
    return !!(raw && /^[A-Za-z0-9-]{8,64}$/.test(raw))
  }

  /* Contact email: filled from one spot (site-config.js). */
  each('[data-support-email]', function (el) {
    if (EMAIL_OK) {
      el.textContent = SUPPORT_EMAIL
      if (el.tagName === 'A') el.setAttribute('href', 'mailto:' + SUPPORT_EMAIL)
    } else {
      el.textContent = '[support email not set yet - edit site-config.js]'
      if (el.tagName === 'A') el.removeAttribute('href')
    }
  })

  /* "Get the app": only shown once an App Store ID exists. */
  each('[data-app-store]', function (el) {
    if (!STORE_ID_OK) return
    el.setAttribute('href', 'https://apps.apple.com/app/id' + APP_STORE_ID)
    el.hidden = false
  })

  /* "Join the beta": TestFlight until the app is on the App Store. */
  if (BETA_ON) {
    each('[data-beta]', function (el) {
      el.setAttribute('href', TESTFLIGHT_URL)
      el.hidden = false
    })
    each('[data-beta-note]', function (el) {
      el.textContent = BETA_NOTE
      el.hidden = false
    })
    each('[data-open-app], [data-open-home]', function (el) {
      el.classList.remove('btn--primary')
      el.classList.add('btn--secondary')
    })
  }

  /* Home page: an invite link (/?ref=<inviter id>) hands the ref to the app,
     where appLifecycle.js stores it until the invitee signs up. */
  var homePage = document.body.getAttribute('data-page') === 'home'
  var inviteRef = new URLSearchParams(window.location.search).get('ref')

  if (homePage && validInviteRef(inviteRef)) {
    var homeHeading = document.querySelector('[data-home-heading]')
    if (homeHeading) homeHeading.textContent = "You're invited to Checkpoint"
  }

  var homeOpen = document.querySelector('[data-open-home]')
  if (homeOpen && validInviteRef(inviteRef)) {
    homeOpen.setAttribute('href', 'checkpoint://home?ref=' + encodeURIComponent(inviteRef))
    homeOpen.hidden = false
  }

  /* Share landing pages. */
  var kind = document.body.getAttribute('data-kind')
  if (!kind) return

  var LABELS = {
    r: 'A review on Checkpoint',
    l: 'A list on Checkpoint',
    q: 'A question on Checkpoint',
    u: 'A profile on Checkpoint',
  }
  var ID_OK = /^[A-Za-z0-9._~-]{1,128}$/

  function readId() {
    var match = window.location.pathname.match(/\/(?:r|l|q|u)\/([^/]+)\/?$/)
    var raw = match ? match[1] : ''
    // Opened as the file itself (local preview): fall back to ?id=
    if (!raw || raw === 'index.html') raw = new URLSearchParams(window.location.search).get('id')
    if (!raw) return ''
    try {
      raw = decodeURIComponent(raw)
    } catch (e) {
      return ''
    }
    return ID_OK.test(raw) ? raw : ''
  }

  var id = readId()
  var open = document.querySelector('[data-open-app]')
  var heading = document.querySelector('[data-landing-heading]')
  var note = document.querySelector('[data-landing-note]')
  var titleBox = document.querySelector('[data-landing-title]')

  if (heading) heading.textContent = LABELS[kind] || 'Checkpoint'

  var sharedTitle = new URLSearchParams(window.location.search).get('t')
  if (sharedTitle && titleBox) {
    titleBox.textContent = '\u201C' + sharedTitle.slice(0, 100) + '\u201D'
    titleBox.hidden = false
  }

  if (id && open) {
    open.setAttribute('href', 'checkpoint://' + kind + '/' + encodeURIComponent(id))
    open.hidden = false
    if (note) note.textContent = 'Open it in the Checkpoint app on your iPhone.'
  } else if (note) {
    note.textContent = 'This link is incomplete, so there is nothing to open.'
  }
})()
