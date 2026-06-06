import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Register Service Worker for PWA (iOS 15+ and Android 24+)
if ('serviceWorker' in navigator) {
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

    // Fix 1 + Fix 3: body class strategy
    await Keyboard.addListener('keyboardWillShow', () => {
      document.body.classList.add('keyboard-open', 'keyboard-animating')
    })
    await Keyboard.addListener('keyboardDidShow', () => {
      document.body.classList.remove('keyboard-animating')
    })
    await Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.add('keyboard-animating')
    })
    await Keyboard.addListener('keyboardDidHide', () => {
      document.body.classList.remove('keyboard-open', 'keyboard-animating')
    })
  } catch {
    // no-op on web or when the plugin is unavailable
  }
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

