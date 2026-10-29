/**
 * Opening the app. From the moment iOS shows the launch screen until the app
 * appears, nothing on screen changes. index.html paints #boot-splash on the
 * first web frame: a transparent shell holding .boot-cover (the launch navy)
 * and the mascot at 157x260, exactly where the storyboard put them, for every
 * theme. The app underneath is already in the saved theme; the theme arrives
 * only when the splash leaves. This module takes the splash away once the app
 * has something to show, and only on a cold start (a module flag; signing out,
 * signing in, resuming and deep links never come back here).
 *
 *   Signed out  The navy cover dissolves while the splash mascot glides into
 *               the sign-in screen's mascot and the page enters around it.
 *               (handOffBootSplash({ target }))
 *   Signed in   The whole splash zooms toward you (scale + opacity, one
 *               compositor animation, the mascot growing a little more) while
 *               the app enters. (handOffBootSplash())
 *   Reduce Motion  Nothing moves: the splash fades out while the page or app
 *               fades in.
 *
 * Nothing starts before MOTION.bootReadyBeat after index.html reported the
 * splash painted (window.__cpSplashReadyAt), so the native launch cover is
 * already gone. Durations and curves come from xMotion.js. CSS reads the
 * durations from custom properties set here (--boot-*); see the enter classes
 * in App.css and Auth.css.
 */

import { MOTION, EASE_CSS, BOOT_GROW, BOOT_ZOOM } from './xMotion'

const SPLASH_ID = 'boot-splash'
// The splash mascot is 260 pt tall (LaunchLogo); the glide scales it to the
// target's height.
const LAUNCH_HEIGHT = 260

const HOLD_CLASS = 'auth-page--hold'
const PAGE_ENTER = 'auth-page--boot-in'
const PAGE_ENTER_REDUCED = 'auth-page--boot-in-reduced'
const APP_ENTER = 'app--boot-enter'
const APP_ENTER_REDUCED = 'app--boot-enter-reduced'

let scheduled = false // a hand-off is waiting for the splash to be ready, or running
let running = false // it has started: taps pass through
let done = false // the splash is gone
let pendingTarget = null // the sign-in mascot, if a page offered one
let timers = []

function splashEl() {
  return typeof document === 'undefined' ? null : document.getElementById(SPLASH_ID)
}

function later(fn, ms) {
  const id = window.setTimeout(fn, ms)
  timers.push(id)
  return id
}

function isReduced() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  } catch {
    // no matchMedia: fall through to the in-app setting
  }
  return document.body?.getAttribute('data-reduce-motion') === 'true'
}

/**
 * True while the splash is still covering the app and the hand-off has not
 * started. A sign-in page uses it to render its content held back.
 */
export function isBootSplashActive() {
  return !done && !running && !!splashEl()
}

function setVars() {
  const style = document.documentElement.style
  style.setProperty('--boot-fade', `${MOTION.bootFade}ms`)
  style.setProperty('--boot-reduced', `${MOTION.bootReduced}ms`)
  style.setProperty('--boot-nav-delay', `${MOTION.bootNavDelay}ms`)
  style.setProperty('--boot-delay-title', `${MOTION.bootStaggerTitle}ms`)
  style.setProperty('--boot-delay-group', `${MOTION.bootStaggerGroup}ms`)
  style.setProperty('--boot-delay-action', `${MOTION.bootStaggerAction}ms`)
  style.setProperty('--boot-delay-footer', `${MOTION.bootStaggerFooter}ms`)
}

function clearVars() {
  const style = document.documentElement.style
  ;[
    '--boot-fade',
    '--boot-reduced',
    '--boot-nav-delay',
    '--boot-delay-title',
    '--boot-delay-group',
    '--boot-delay-action',
    '--boot-delay-footer',
  ].forEach((name) => style.removeProperty(name))
}

/** Splash gone: show the page mascot, drop every hold and enter class. */
function finish() {
  if (done) return
  done = true
  running = true
  timers.forEach((id) => window.clearTimeout(id))
  timers = []
  // Clearing data-boot reveals the page mascot in the same task that removes
  // the splash, so there is no frame without a mascot.
  document.documentElement.removeAttribute('data-boot')
  splashEl()?.remove()
  document.querySelectorAll(`.${HOLD_CLASS}`).forEach((el) => el.classList.remove(HOLD_CLASS))
  document.querySelectorAll(`.${PAGE_ENTER}, .${PAGE_ENTER_REDUCED}`).forEach((el) => {
    el.classList.remove(PAGE_ENTER, PAGE_ENTER_REDUCED)
  })
  document.querySelectorAll(`.${APP_ENTER}, .${APP_ENTER_REDUCED}`).forEach((el) => {
    el.classList.remove(APP_ENTER, APP_ENTER_REDUCED)
  })
  clearVars()
}

/** Signed in: the whole splash zooms and dissolves; the app enters under it. */
function leaveToApp(splash, mascot, reduced) {
  const app = document.querySelector('.app')

  if (reduced) {
    splash.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: MOTION.bootReduced, easing: EASE_CSS.fade, fill: 'forwards' },
    )
    app?.classList.add(APP_ENTER_REDUCED)
    later(finish, MOTION.bootReduced + 60)
    return
  }

  // One compositor animation on the whole splash: its navy goes with it, so
  // nothing animates a background color.
  const timing = { duration: MOTION.bootZoom, easing: EASE_CSS.leave, fill: 'forwards' }
  splash.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: `scale(${BOOT_ZOOM})` },
    ],
    timing,
  )
  mascot?.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${BOOT_GROW})` }],
    timing,
  )
  app?.classList.add(APP_ENTER)

  // The last enter animation is a nav bar: bootNavDelay + bootFade.
  const total = Math.max(MOTION.bootZoom, MOTION.bootNavDelay + MOTION.bootFade)
  later(finish, total + 60)
}

/** Signed out: the splash mascot glides into the sign-in mascot. */
function glideToPage(splash, mascot, reduced) {
  const target = pendingTarget
  const page = target.closest('.auth-page')

  if (reduced) {
    // No glide: the splash fades out, the page and its mascot fade in.
    document.documentElement.removeAttribute('data-boot')
    page?.classList.remove(HOLD_CLASS)
    page?.classList.add(PAGE_ENTER_REDUCED)
    splash.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: MOTION.bootReduced, easing: EASE_CSS.fade, fill: 'forwards' },
    )
    later(finish, MOTION.bootReduced + 60)
    return
  }

  const from = mascot.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  const scale = to.height / LAUNCH_HEIGHT
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)

  // The navy cover dissolves into the page while the mascot travels.
  splash.querySelector('.boot-cover')?.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: MOTION.bootCoverFade, easing: EASE_CSS.fade, fill: 'forwards' },
  )
  page?.classList.remove(HOLD_CLASS)
  page?.classList.add(PAGE_ENTER)

  const glide = mascot.animate(
    [
      { transform: 'translate(0px, 0px) scale(1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    ],
    { duration: MOTION.bootGlide, easing: EASE_CSS.move, fill: 'forwards' },
  )
  glide.onfinish = finish
  later(finish, MOTION.bootGlide + 120)
}

function run() {
  if (done) return
  running = true
  const splash = splashEl()
  if (!splash) {
    finish()
    return
  }
  // From here the app can be tapped.
  splash.style.pointerEvents = 'none'
  setVars()

  const mascot = splash.querySelector('img')
  const reduced = isReduced()
  const hasTarget = !!pendingTarget && pendingTarget.isConnected

  if (hasTarget && mascot) glideToPage(splash, mascot, reduced)
  else leaveToApp(splash, mascot, reduced)
}

/**
 * Start as soon as the app is ready, but not before the splash has painted
 * (index.html sets window.__cpSplashReadyAt) plus a beat, so the native launch
 * cover is gone. If the splash is not ready yet, look again next frame; the
 * 8 s failsafe in index.html covers a splash that never reports.
 */
function runWhenReady() {
  if (done || running) return
  if (!splashEl()) {
    run()
    return
  }
  const readyAt = window.__cpSplashReadyAt
  if (typeof readyAt !== 'number') {
    later(runWhenReady, 16)
    return
  }
  const wait = readyAt + MOTION.bootReadyBeat - performance.now()
  if (wait > 0) later(run, wait)
  else run()
}

/**
 * Take the splash away. Runs once per cold start; later calls do nothing, apart
 * from one case: a sign-in page that mounts before the hand-off starts becomes
 * the target.
 *
 * `target` is a sign-in screen's mascot <img>. Without one, the app fades in.
 */
export function handOffBootSplash({ target } = {}) {
  if (done) return
  if (target) pendingTarget = target
  if (scheduled) return

  const splash = splashEl()
  if (!splash) {
    scheduled = true
    done = true
    return
  }
  scheduled = true

  later(runWhenReady, 0)
}
