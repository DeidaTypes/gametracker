import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { toPng } from 'html-to-image'

/**
 * Share Service — branded deep-linked card engine.
 *
 * Two public surfaces:
 *   shareCard({ variant, data, title })
 *     Renders a BrandedShareCard offscreen, captures it to PNG, then
 *     shares via Web Share API (with file) → Capacitor Share (URL only)
 *     → browser download fallback.
 *
 *   shareImageDataUrl(dataUrl, { title, url, filename })
 *     Lower-level helper: takes an already-captured data URL and runs
 *     the same share cascade. Used by CompletionCelebration and anywhere
 *     that already has a PNG.
 *
 * Deep-link scheme:
 *   All deep links are web-origin paths (BrowserRouter). No native URL
 *   scheme is configured in capacitor.config.json yet, so we use
 *   window.location.origin as the base. The URLs embedded in cards are:
 *     game      →  /game/:gameId
 *     review    →  /review/:reviewId
 *     profile   →  /user/:username
 *     list      →  /list/:listId
 *
 * QR codes are generated via the `qrcode` package before card render so
 * html-to-image can rasterise the img tag from a base64 data URL.
 */

// Card dimensions (portrait 4:5, Instagram-safe)
export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

/**
 * Build the canonical deep link URL for a given target.
 */
export function buildDeepLinkUrl(target) {
  const base =
    typeof window !== 'undefined' ? window.location.origin : 'https://checkpoint.app'
  switch (target.type) {
    case 'game':
      return `${base}/game/${encodeURIComponent(target.id)}`
    case 'review':
      return `${base}/review/${encodeURIComponent(target.id)}`
    case 'profile':
      return `${base}/user/${encodeURIComponent(target.username)}`
    case 'list':
      return `${base}/list/${encodeURIComponent(target.id)}`
    default:
      return base
  }
}

/**
 * Generate a QR code data URL for `text`.
 * Returns null on failure so callers can render without a QR.
 */
export async function buildQrDataUrl(text) {
  try {
    const QRCode = (await import('qrcode')).default
    return await QRCode.toDataURL(text, {
      width: 160,
      margin: 1,
      color: {
        dark: '#f0f3fa',
        light: '#00000000',
      },
    })
  } catch (err) {
    console.warn('[share] QR generation failed:', err)
    return null
  }
}

/**
 * Render a BrandedShareCard variant offscreen and capture it as a PNG.
 *
 * @param {object} opts
 * @param {'game-score'|'profile-dna'|'favorites-shelf'|'quotable-review'} opts.variant
 * @param {object}  opts.data      Real data for the variant (no fabricated values)
 * @param {object}  opts.target    { type, id|username } for deep-link + QR
 * @returns {Promise<string>}      PNG data URL
 */
export async function captureCard({ variant, data, target }) {
  // Lazy-import the card component (keeps the service a plain .js file)
  const BrandedShareCard = (await import('../components/BrandedShareCard')).default

  const deepLinkUrl = buildDeepLinkUrl(target)
  const qrDataUrl = await buildQrDataUrl(deepLinkUrl)

  // Mount an offscreen host
  const host = document.createElement('div')
  host.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    `width:${CARD_WIDTH}px`,
    `height:${CARD_HEIGHT}px`,
    'pointer-events:none',
    'z-index:-1',
    'overflow:hidden',
  ].join(';')
  document.body.appendChild(host)

  // Render and wait for the card's onReady callback
  const root = createRoot(host)
  await new Promise((resolve) => {
    root.render(
      createElement(BrandedShareCard, {
        variant,
        data,
        deepLinkUrl,
        qrDataUrl,
        onReady: resolve,
      })
    )
  })

  // Allow one rAF for images to paint
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  let dataUrl = null
  try {
    dataUrl = await toPng(host.firstElementChild, {
      cacheBust: true,
      pixelRatio: 1,
      backgroundColor: '#0a0f1f',
    })
  } finally {
    root.unmount()
    document.body.removeChild(host)
  }

  return dataUrl
}

/**
 * Share a PNG data URL via:
 *   1. Web Share API with file (iOS Safari / Android Chrome)
 *   2. Capacitor Share with URL only (native app fallback)
 *   3. Browser download (<a download>)
 *
 * @param {string}  dataUrl
 * @param {object}  opts
 * @param {string}  opts.title
 * @param {string}  opts.url       Deep link URL to include
 * @param {string}  [opts.filename]
 * @returns {Promise<{ method: string }>}
 */
export async function shareImageDataUrl(dataUrl, { title = 'Checkpoint', url = '', filename = 'gametracker-card.png' } = {}) {
  // Convert data URL to File for the Web Share API
  let file = null
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    file = new File([blob], filename, { type: 'image/png' })
  } catch {
    // If conversion fails, skip file sharing paths
  }

  // 1. Web Share API with file — works on iOS Safari + Android Chrome
  if (
    file &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title, url })
      return { method: 'web-share-file' }
    } catch (e) {
      if (e.name === 'AbortError') return { method: 'aborted' }
    }
  }

  // 2. Capacitor Share (URL only — no filesystem write needed)
  try {
    const { Share } = await import('@capacitor/share')
    const canShare = await Share.canShare()
    if (canShare?.value) {
      await Share.share({ title, url, dialogTitle: 'Share' })
      return { method: 'capacitor' }
    }
  } catch {
    // Plugin unavailable
  }

  // 3. Download the PNG
  if (typeof document !== 'undefined') {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
  return { method: 'download' }
}

/**
 * Full pipeline: capture a branded card then share it.
 *
 * @param {object} opts
 * @param {'game-score'|'profile-dna'|'favorites-shelf'|'quotable-review'} opts.variant
 * @param {object}  opts.data    Real data for the variant
 * @param {object}  opts.target  { type, id|username }
 * @param {string}  [opts.title] Share sheet title
 * @returns {Promise<{ method: string, dataUrl: string }>}
 */
export async function shareCard({ variant, data, target, title }) {
  const deepLinkUrl = buildDeepLinkUrl(target)
  const dataUrl = await captureCard({ variant, data, target })
  const result = await shareImageDataUrl(dataUrl, {
    title: title || 'Checkpoint',
    url: deepLinkUrl,
    filename: `gametracker-${variant}.png`,
  })
  return { ...result, dataUrl }
}
