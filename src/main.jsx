import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'
import './styles/keyboard.css'
import { initKeyboardInset } from './services/keyboardInset'
import { initAppLifecycle } from './services/appLifecycle'
import { captureWebReferral } from './services/inviteService'

// Capture ?ref= invite param from the URL before React mounts so it
// survives the /login → /signup redirect chain.
captureWebReferral()

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
// The implementation moved to services/keyboardInset.js so that the hook, the
// KeyboardAwareView wrapper and this bootstrap all read the same state. The
// intent is unchanged and documented there:
//
//   Fix 1 — body.keyboard-open hides the floating pill nav and FAB so they
//            don't shoot up when the keyboard opens.
//   Fix 3 — body.keyboard-animating suppresses pointer-events on fixed
//            overlays while the keyboard slides, preventing flicker.
//   Fix 4 — setAccessoryBarVisible adds a Done button above the keyboard so
//            users without a physical home button can dismiss it.
//
// Started before React mounts so --keyboard-inset resolves on first paint.
initKeyboardInset()

// Start Supabase auth lifecycle management (native-only; no-op on web).
initAppLifecycle()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
