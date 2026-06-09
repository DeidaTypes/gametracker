import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'
import { initAppLifecycle } from './services/appLifecycle'

// Service worker must not run inside the Capacitor native app — it caches
// the bundle and only yields to a new worker after a full quit/relaunch,
// causing stale Discover data and the "quit-to-refresh" symptom.
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  // Evict any stale SW already installed on test devices / TestFlight users.
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
  }
}

// Register Service Worker for PWA on web only (iOS 15+ and Android 24+)
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration)
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError)
      })
  })
}

// ── ONE global keyboard-inset source of truth ──────────────────────────────
//
// Capacitor's Keyboard `resize` is set to "none" (see capacitor.config.json),
// so the WebView stays full-height and window.visualViewport reports the real
// keyboard height. We translate that into a single CSS variable —
// `--keyboard-inset` on <html> — that every modal consumes to lift its content
// above the keyboard. This is the SINGLE place the inset is written; no other
// component should compute its own keyboard offset.
//
// `setAccessoryBarVisible(true)` adds a ~44px "Done" bar above the keyboard
// that visualViewport does NOT report, so we pad the inset by that amount when
// the keyboard is up — content then clears BOTH the keyboard and the bar.
const ACCESSORY_BAR_PX = 44
let keyboardVisible = false
// px from @capacitor/keyboard; authoritative on iOS where visualViewport
// doesn't shrink for the keyboard under resize:"none"
let nativeKbHeight = 0

function writeKeyboardInset() {
  if (typeof document === 'undefined') return
  let inset
  if (nativeKbHeight > 0) {
    // On iOS, UIKeyboardFrameEndUserInfoKey (used by @capacitor/keyboard) reports
    // the full keyboard frame height which already includes the input accessory bar.
    // Do NOT add ACCESSORY_BAR_PX here — that would double-count it.
    inset = nativeKbHeight
  } else {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    inset = vv ? Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0)) : 0
    if (inset > 0 || keyboardVisible) inset += ACCESSORY_BAR_PX
    if (!keyboardVisible) inset = 0
  }
  document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`)
}

if (typeof window !== 'undefined') {
  // Seed it so the variable always resolves (e.g. on first paint / web).
  document.documentElement.style.setProperty('--keyboard-inset', '0px')
  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', writeKeyboardInset)
    vv.addEventListener('scroll', writeKeyboardInset)
  }
}

// iOS keyboard fixes — dynamic import so the web build stays a no-op
// when @capacitor/keyboard is unavailable (e.g. running in a browser).
//
// Fix 1 — body.keyboard-open hides the floating pill nav and FAB so
//          they don't shoot up when the WebView is pushed upward.
// Fix 3 — body.keyboard-animating suppresses pointer-events on every
//          fixed overlay while the keyboard slides in/out, preventing
//          the flicker that happens when layout recalculates.
// Fix 4 — setAccessoryBarVisible adds a Done button above the keyboard
//          so users without a physical home button can dismiss it.
;(async () => {
  try {
    const { Keyboard } = await import('@capacitor/keyboard')

    // Fix 4: Done accessory bar above keyboard on all inputs.
    await Keyboard.setAccessoryBarVisible({ isVisible: true })

    // Fix 1 + Fix 3: body class strategy. Each lifecycle event also keeps the
    // global --keyboard-inset in sync (the visualViewport listener above does
    // the heavy lifting; these guarantee correct values at the animation ends).
    await Keyboard.addListener('keyboardWillShow', (info) => {
      keyboardVisible = true
      nativeKbHeight = (info && info.keyboardHeight) || 0
      document.body.classList.add('keyboard-open', 'keyboard-animating')
      writeKeyboardInset()
    })
    await Keyboard.addListener('keyboardDidShow', (info) => {
      keyboardVisible = true
      nativeKbHeight = (info && info.keyboardHeight) || nativeKbHeight
      document.body.classList.remove('keyboard-animating')
      writeKeyboardInset()
    })
    await Keyboard.addListener('keyboardWillHide', () => {
      // Reset the inset NOW (start of hide animation) so the composer slides
      // down in sync with the keyboard rather than snapping after it's gone.
      document.body.classList.add('keyboard-animating')
      document.documentElement.style.setProperty('--keyboard-inset', '0px')
    })
    await Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisible = false
      nativeKbHeight = 0
      document.body.classList.remove('keyboard-open', 'keyboard-animating')
      document.documentElement.style.setProperty('--keyboard-inset', '0px')
    })
  } catch {
    // no-op on web or when the plugin is unavailable
  }
})()

// Start Supabase auth lifecycle management (native-only; no-op on web).
initAppLifecycle()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
