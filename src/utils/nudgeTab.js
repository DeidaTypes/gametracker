const NUDGE_CLASS = 'is-tab-nudge'
/** Matches --motion-slide; class removal fallback if animationend does not fire. */
const NUDGE_MS = 340

function shouldReduceMotion() {
  if (typeof window === 'undefined') return true
  if (document.body?.getAttribute('data-reduce-motion') === 'true') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

/**
 * Soft scale nudge on a bottom-nav tab icon (`home` | `discover` | `library` |
 * `profile`). No-op under OS or in-app Reduce Motion.
 */
export function nudgeTab(tabName) {
  if (shouldReduceMotion()) return
  if (typeof document === 'undefined') return

  const tabEl = document.querySelector(`.bottom-nav-item[data-tab="${tabName}"]`)
  if (!tabEl) return

  const icon = tabEl.querySelector('.bottom-nav-icon-wrap') || tabEl
  icon.classList.add(NUDGE_CLASS)

  const cleanup = () => icon.classList.remove(NUDGE_CLASS)
  icon.addEventListener('animationend', cleanup, { once: true })
  window.setTimeout(cleanup, NUDGE_MS + 40)
}
