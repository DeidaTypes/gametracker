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
import { migrateLibraryToSlimShape } from './services/libraryService'
import { pruneSwipeHistory } from './services/swipeService'
import { freeAbandonedLocalStorage } from './utils/storageQuota'
import { initTheme } from './services/themeService'

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
//   Fix 4 — setAccessoryBarVisible(false) suppresses the native iOS
//            input-accessory view (prev/next chevrons + Done) so it can't
//            render on top of composers anchored flush above the keyboard.
//            Single-line Return + tap-outside dismiss replace it.
//
// Started before React mounts so --keyboard-inset resolves on first paint.
initKeyboardInset()

// Start Supabase auth lifecycle management (native-only; no-op on web).
initAppLifecycle()

// index.html already marked the saved theme for the first frame. This
// sets the browser theme-color and, on iPhone, the status bar style.
initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// After the first paint, on idle. These used to run synchronously before
// createRoot and held the boot splash off the screen. On an already-slim
// device both storage passes detect "nothing to do" and skip the write.
// Abandoned caches go first so a slim rewrite has room to replace
// gameLibrary — WebKit will not replace a large key while the old copy
// still occupies the quota.
function runAfterFirstPaint(fn) {
  const start = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn)
    else setTimeout(fn, 1)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start)
  else setTimeout(start, 1)
}

runAfterFirstPaint(() => {
  freeAbandonedLocalStorage()
  migrateLibraryToSlimShape()
  pruneSwipeHistory()

  // Web only. The native shell unregisters any stale worker before paint
  // (above) so a cached bundle cannot own the first load.
  if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration)
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError)
      })
  }
})
