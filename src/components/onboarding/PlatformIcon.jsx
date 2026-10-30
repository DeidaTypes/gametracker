import React from 'react'

/**
 * The six line icons for the "Where do you play?" tiles, copied from the
 * approved onboarding mockup (docs/design/checkpoint_onboarding.html). They
 * draw in currentColor, so a tile recolors them by setting its `color`.
 */
const SHAPES = {
  playstation: (
    <>
      <rect x="2" y="7" width="20" height="11" rx="4" />
      <path d="M7 11v3M5.5 12.5h3" />
      <circle cx="16" cy="11.5" r=".8" fill="currentColor" />
      <circle cx="18" cy="13.5" r=".8" fill="currentColor" />
    </>
  ),
  xbox: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8c2.5 3 2.5 5 0 8M16 8c-2.5 3-2.5 5 0 8" />
    </>
  ),
  nintendo: (
    <>
      <rect x="3" y="4" width="7" height="16" rx="3" />
      <rect x="14" y="4" width="7" height="16" rx="3" />
      <circle cx="6.5" cy="9" r="1.2" fill="currentColor" />
      <circle cx="17.5" cy="15" r="1.2" fill="currentColor" />
    </>
  ),
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  mobile: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  retro: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 5V3h8v2M8 10h8M8 13h5" />
    </>
  ),
}

export default function PlatformIcon({ id, size = 22 }) {
  const shape = SHAPES[id]
  if (!shape) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  )
}
