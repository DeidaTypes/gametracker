const FLY_MS = 380
const FLY_EASING = 'cubic-bezier(.2,.8,.2,1)'
const PULSE_MS = 200
const PULSE_CLASS = 'is-fly-pulse'

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

function resolveCoverEl(fromEl) {
  if (!fromEl) return null
  if (fromEl.tagName === 'IMG') return fromEl
  return fromEl.querySelector?.('img') || null
}

function pulseTab(tabEl) {
  const icon = tabEl.querySelector('.bottom-nav-icon-wrap') || tabEl
  icon.classList.add(PULSE_CLASS)
  window.setTimeout(() => icon.classList.remove(PULSE_CLASS), PULSE_MS)

  const badge = tabEl.querySelector('[data-tab-count], .bottom-nav-count')
  if (!badge) return
  const n = parseInt(badge.textContent, 10)
  if (Number.isFinite(n)) badge.textContent = String(n + 1)
}

/**
 * Clone `fromEl`'s cover image and fly it to the bottom-nav tab named
 * `tabName` (`home` | `discover` | `library` | `profile`). Under
 * prefers-reduced-motion this returns immediately — callers still fire
 * their own haptic.
 */
export function flyToTab(fromEl, tabName) {
  if (prefersReducedMotion()) return
  if (typeof document === 'undefined') return

  const cover = resolveCoverEl(fromEl)
  const tabEl = document.querySelector(`.bottom-nav-item[data-tab="${tabName}"]`)
  const src = cover?.currentSrc || cover?.src
  if (!cover || !tabEl || !src) return

  const from = cover.getBoundingClientRect()
  const to = tabEl.getBoundingClientRect()
  if (from.width <= 0 || from.height <= 0) return

  const clone = cover.cloneNode(true)
  clone.removeAttribute('id')
  clone.alt = ''
  clone.setAttribute('aria-hidden', 'true')
  clone.style.cssText = [
    'position:fixed',
    `left:${from.left}px`,
    `top:${from.top}px`,
    `width:${from.width}px`,
    `height:${from.height}px`,
    'margin:0',
    'padding:0',
    `border-radius:${getComputedStyle(cover).borderRadius || '0px'}`,
    'object-fit:cover',
    'z-index:2000',
    'pointer-events:none',
    'transform-origin:center center',
    'will-change:transform,opacity',
    'opacity:1',
    'transform:translate(0,0) scale(1)',
  ].join(';')
  document.body.appendChild(clone)

  const dx = (to.left + to.width / 2) - (from.left + from.width / 2)
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2)

  const cleanup = () => {
    if (!clone.parentNode) return
    clone.remove()
    pulseTab(tabEl)
  }

  clone.addEventListener('transitionend', cleanup, { once: true })
  window.setTimeout(cleanup, FLY_MS + 40)

  // Force a layout so the transition actually runs from the start rect.
  clone.getBoundingClientRect()
  clone.style.transition = `transform ${FLY_MS}ms ${FLY_EASING}, opacity ${FLY_MS}ms ${FLY_EASING}`
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.15)`
  clone.style.opacity = '0.4'
}
