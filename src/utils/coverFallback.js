/**
 * Local fallback artwork for a genuinely-missing game cover.
 *
 * Replaces the previous reliance on the external `via.placeholder.com`
 * service, which (a) is a third-party "placeholder" dependency rendered to
 * users and (b) can be slow/unreachable on mobile. This is a tiny inline SVG
 * data URI — no network request, no fabricated text — that degrades to a
 * neutral cover-shaped tile matching the app's dark surface.
 *
 * Use it only as an <img> onError / missing-src fallback for real covers we
 * couldn't load — never to stand in for content that doesn't exist.
 */

// 3:4 cover-ratio neutral tile. Colours mirror the dark surface tones already
// used across the app's cover placeholders.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">' +
  '<rect width="300" height="400" fill="#152035"/>' +
  '<rect x="0" y="0" width="300" height="400" fill="url(#g)"/>' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#1c2a44"/><stop offset="1" stop-color="#101827"/>' +
  '</linearGradient></defs>' +
  '<path d="M150 168a26 26 0 1 0 0 52 26 26 0 0 0 0-52zm-70 96c0-23 31-35 70-35s70 12 70 35v8H80z" fill="#2c3a55" opacity="0.6"/>' +
  '</svg>'

export const COVER_FALLBACK = `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`

export default COVER_FALLBACK
