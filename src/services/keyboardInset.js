import { Capacitor } from '@capacitor/core'

/**
 * keyboardInset — the ONE source of truth for how much of the viewport the
 * software keyboard occupies.
 *
 * Why this exists in JS at all:
 * Capacitor's Keyboard `resize` is deliberately set to "none" (see
 * capacitor.config.json), so the native layer never resizes the WebView or
 * <body>. That is intentional: the plugin schedules its native resize with
 * `delay = keyboardAnimationDuration + 0.2s`, so any of the native resize
 * modes lands *after* the keyboard has finished sliding up. Driving the lift
 * from the `keyboardWillShow` event — which fires synchronously at the start
 * of the native animation — is the only way to move in sync with the keyboard.
 *
 * What it publishes:
 *   --keyboard-inset  raw keyboard height in px (0 when closed)
 *   body.keyboard-open       keyboard is up
 *   body.keyboard-animating   keyboard is mid show/hide transition
 *
 * Everything else (the lift math, the timing curve) lives in
 * src/styles/keyboard.css so that CSS and JS can never disagree.
 *
 * Consumers should NOT read window.visualViewport or add their own Keyboard
 * listeners. Use the `--keyboard-inset` variable, the `.kb-*` classes, the
 * <KeyboardAwareView> component, or the useKeyboardInset() hook.
 */

// Historically setAccessoryBarVisible(true) added a ~44px native "Done" bar
// above the keyboard (iOS folds its height into
// UIKeyboardFrameEndUserInfoKey, so nativeKbHeight already includes it when
// it's on). We now keep the accessory bar OFF (see initKeyboardInset below)
// because it renders as a floating pill (prev/next chevrons + a checkmark)
// that sits on top of whatever is anchored flush above the keyboard — which,
// once the comment composers were anchored there, meant it visually
// overlapped the composer on every comment screen. The app's own composer
// already provides its own dismiss affordance, so the native bar is
// redundant on top of being a visual bug.
//
// ACCESSORY_BAR_PX stays only for the web/PWA path below: outside Capacitor
// (setAccessoryBarVisible is a native-only no-op there), mobile Safari can
// still show its own OS-level input accessory view that visualViewport
// doesn't report, so that measurement still needs the pad regardless of the
// native setting above.
const ACCESSORY_BAR_PX = 44

let keyboardVisible = false
// px from @capacitor/keyboard. Authoritative on iOS, where visualViewport
// does not shrink for the keyboard under resize:"none".
let nativeKbHeight = 0
let currentInset = 0
let started = false

const subscribers = new Set()
// One-shot callbacks waiting for the keyboard to finish animating.
const settledCallbacks = new Set()

function emit(inset) {
  for (const fn of subscribers) {
    try {
      fn(inset)
    } catch {
      // a broken subscriber must not stall the others
    }
  }
}

function flushSettled() {
  if (settledCallbacks.size === 0) return
  const pending = [...settledCallbacks]
  settledCallbacks.clear()
  for (const fn of pending) {
    try {
      fn(currentInset)
    } catch {
      // ignore
    }
  }
}

function applyInset(inset) {
  const next = Math.max(0, Math.round(inset))
  if (next === currentInset) return
  currentInset = next
  document.documentElement.style.setProperty('--keyboard-inset', `${next}px`)
  emit(next)
}

function measureFromViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return 0
  return Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))
}

function recompute() {
  if (typeof document === 'undefined') return

  // Native iOS: trust the plugin's reported frame height.
  if (nativeKbHeight > 0) {
    applyInset(nativeKbHeight)
    return
  }

  // Web / PWA: visualViewport genuinely shrinks, so derive visibility from it
  // rather than from the Capacitor listeners (which never fire off-native).
  // Without this the whole system was inert in the browser build.
  const measured = measureFromViewport()
  if (!Capacitor.isNativePlatform()) {
    const open = measured > 0
    setKeyboardOpen(open)
    applyInset(open ? measured + ACCESSORY_BAR_PX : 0)
    return
  }

  applyInset(keyboardVisible ? measured : 0)
}

function setKeyboardOpen(open) {
  if (keyboardVisible === open) return
  keyboardVisible = open
  document.body.classList.toggle('keyboard-open', open)
}

let animatingTimer = 0
function setAnimating(active) {
  window.clearTimeout(animatingTimer)
  if (active) {
    document.body.classList.add('keyboard-animating')
    // Safety net: keyboardDidShow/DidHide normally clears this, but a
    // cancelled keyboard transition can swallow those events.
    animatingTimer = window.setTimeout(() => {
      document.body.classList.remove('keyboard-animating')
      flushSettled()
    }, 600)
  } else {
    document.body.classList.remove('keyboard-animating')
    flushSettled()
  }
}

/**
 * Run `fn` once the keyboard has finished animating.
 *
 * Replaces the `setTimeout(..., 320)` guesses that were scattered across the
 * comment composers. Those raced both the real keyboard animation and
 * WKWebView's own scroll-to-reveal walk; this fires on the actual
 * keyboardDidShow event instead. Returns a cancel function.
 */
export function whenKeyboardSettled(fn) {
  const isAnimating =
    typeof document !== 'undefined' &&
    document.body.classList.contains('keyboard-animating')

  if (!isAnimating) {
    const raf = requestAnimationFrame(() => fn(currentInset))
    return () => cancelAnimationFrame(raf)
  }

  settledCallbacks.add(fn)
  return () => settledCallbacks.delete(fn)
}

/**
 * Subscribe to keyboard inset changes. Returns an unsubscribe function.
 * Fires immediately with the current value.
 */
export function subscribeKeyboardInset(fn) {
  subscribers.add(fn)
  fn(currentInset)
  return () => subscribers.delete(fn)
}

export function getKeyboardInset() {
  return currentInset
}

export function isKeyboardOpen() {
  return keyboardVisible
}

/**
 * Start the single global listener set. Idempotent — safe to call more than
 * once. Called from main.jsx before React mounts so the variable always
 * resolves on first paint.
 */
export function initKeyboardInset() {
  if (started || typeof window === 'undefined') return
  started = true

  // Seed so var(--keyboard-inset) always resolves, even on first paint.
  document.documentElement.style.setProperty('--keyboard-inset', '0px')

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', recompute)
    vv.addEventListener('scroll', recompute)
  }

  // Dynamic import so the web build stays a clean no-op when
  // @capacitor/keyboard is unavailable.
  ;(async () => {
    try {
      const { Keyboard } = await import('@capacitor/keyboard')

      // OFF: this is the native input-accessory view (prev/next chevrons +
      // a Done checkmark) iOS shows above the keyboard for stepping between
      // form fields. With the comment composers anchored flush above the
      // keyboard, that native bar rendered on top of them, obscuring the
      // app's own "Add a comment" field. The composer already has its own
      // way to dismiss the keyboard, so there is no affordance lost by
      // turning this off.
      await Keyboard.setAccessoryBarVisible({ isVisible: false })

      await Keyboard.addListener('keyboardWillShow', (info) => {
        nativeKbHeight = (info && info.keyboardHeight) || 0
        setKeyboardOpen(true)
        setAnimating(true)
        recompute()
      })

      await Keyboard.addListener('keyboardDidShow', (info) => {
        nativeKbHeight = (info && info.keyboardHeight) || nativeKbHeight
        setKeyboardOpen(true)
        setAnimating(false)
        recompute()
      })

      await Keyboard.addListener('keyboardWillHide', () => {
        // Clear nativeKbHeight HERE, not in didHide. Leaving it set meant any
        // visualViewport event fired during the dismiss animation would hit
        // the `nativeKbHeight > 0` branch in recompute() and slam the inset
        // back to full height — the composer would bounce up, then drop.
        nativeKbHeight = 0
        setAnimating(true)
        applyInset(0)
      })

      await Keyboard.addListener('keyboardDidHide', () => {
        nativeKbHeight = 0
        setKeyboardOpen(false)
        setAnimating(false)
        applyInset(0)
      })
    } catch {
      // no-op on web or when the plugin is unavailable
    }
  })()
}
