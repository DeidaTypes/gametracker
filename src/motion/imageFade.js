/**
 * Images fade in once decoded. Never pop.
 *
 * One global mechanism, no per-component work. A MutationObserver arms every
 * <img> that is still loading (`data-img-fade="pending"`, held at opacity 0 by
 * theme.css). A capture-phase load listener on the document waits for the
 * decode, then flips it to "ready", which plays the 240 fade-in. When the
 * animation ends the attribute is removed, so the element is a plain <img>
 * again and a re-parent never replays the fade.
 *
 *  - Already complete when inserted (cache hit, moved node, clone): never armed.
 *  - Broken: "error" (hidden, so no browser broken-image glyph). An image that
 *    no component handled falls back to the existing COVER_FALLBACK artwork.
 *    Components that swap `src` in their own onError simply re-arm and fade.
 *  - Excluded: share-card export surfaces (an invisible cover would be
 *    rasterised), back-swipe snapshot clones, and the boot splash.
 *
 * Durations and curves live in theme.css (--motion-image, --ease-fade). Reduce
 * Motion collapses to a 150 ms fade there.
 */
import { COVER_FALLBACK } from '../utils/coverFallback'

const ATTR = 'data-img-fade'
const EXCLUDED = '.bsc, .share-card, .back-reveal, [data-share-capture]'
// Brand art and avatars/banners are never swapped for a game-cover placeholder.
const NO_COVER_FALLBACK = '[class*="avatar"], [class*="banner"]'

function eligible(img) {
  if (img.closest(EXCLUDED)) return false
  const src = img.getAttribute('src') || ''
  return !src.startsWith('/brand/')
}

function disarm(img) {
  if (img.hasAttribute(ATTR)) img.removeAttribute(ATTR)
}

function arm(img) {
  if (!eligible(img)) {
    disarm(img)
    return
  }
  if (img.complete) {
    // Loaded, or no src at all: nothing to wait for. (Failures arrive as
    // error events; naturalWidth is not a reliable broken test for SVG.)
    disarm(img)
    return
  }
  if (img.getAttribute(ATTR) !== 'pending') img.setAttribute(ATTR, 'pending')
}

function reveal(img) {
  if (img.getAttribute(ATTR) !== 'pending') return
  const go = () => {
    if (img.getAttribute(ATTR) !== 'pending') return
    // A src change mid-decode leaves a newer load in flight: keep waiting.
    if (img.complete) img.setAttribute(ATTR, 'ready')
  }
  if (typeof img.decode === 'function') img.decode().then(go, go)
  else go()
}

function fail(img) {
  if (!eligible(img)) return
  img.setAttribute(ATTR, 'error')
  // Let the component's own onError run first (it may swap src or unmount).
  setTimeout(() => {
    if (!img.isConnected || img.getAttribute(ATTR) !== 'error') return
    const src = img.getAttribute('src') || ''
    if (!src || src.startsWith('data:') || img.style.display === 'none') return
    if (img.closest(NO_COVER_FALLBACK)) return
    img.setAttribute('src', COVER_FALLBACK)
  }, 0)
}

function armTree(node) {
  if (node.nodeType !== 1) return
  if (node.tagName === 'IMG') {
    arm(node)
    return
  }
  node.querySelectorAll?.('img').forEach(arm)
}

let started = false

export function initImageFade() {
  if (started || typeof document === 'undefined') return
  started = true

  document.addEventListener(
    'load',
    (e) => {
      if (e.target instanceof HTMLImageElement) reveal(e.target)
    },
    true,
  )

  document.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLImageElement) fail(e.target)
    },
    true,
  )

  document.addEventListener('animationend', (e) => {
    if (e.animationName !== 'img-fade-in') return
    const img = e.target
    if (img instanceof HTMLImageElement && img.getAttribute(ATTR) === 'ready') disarm(img)
  })

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof HTMLImageElement) arm(r.target)
      } else {
        r.addedNodes.forEach(armTree)
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  })
}

initImageFade()
