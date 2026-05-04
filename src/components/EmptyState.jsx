import React from 'react'
import './EmptyState.css'

/* ---------------------------------------------------------------
   Inline SVG illustrations
   All use currentColor so the parent's color (--color-brand-primary)
   flows through automatically. Fill values use inline rgba so the
   subtle tints still read correctly without a CSS variable.
--------------------------------------------------------------- */
const illustrations = {
  'want-to-play': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Three fanned game cases — a stack of things to play */}
      <rect x="9" y="16" width="33" height="46" rx="4"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.05)"
        transform="rotate(-9 25.5 39)" />
      <rect x="15" y="13" width="33" height="46" rx="4"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.07)"
        transform="rotate(3 31.5 36)" />
      <rect x="22" y="11" width="34" height="48" rx="4"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.12)" />
      {/* Spine */}
      <line x1="27" y1="11" x2="27" y2="59"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      {/* Label lines on front case */}
      <line x1="32" y1="22" x2="52" y2="22"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
      <line x1="32" y1="28" x2="52" y2="28"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
    </svg>
  ),

  'currently-playing': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Controller body */}
      <path
        d="M16 40 C16 30 22 23 32 23 L48 23 C58 23 64 30 64 40 C64 52 56 58 48 58 L32 58 C24 58 16 52 16 40Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.09)" />
      {/* Left grip */}
      <path d="M16 40 C14 44 12 52 16 58 L26 58"
        stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Right grip */}
      <path d="M64 40 C66 44 68 52 64 58 L54 58"
        stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* D-pad vertical */}
      <rect x="25" y="35" width="6" height="14" rx="1.5"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      {/* D-pad horizontal */}
      <rect x="21" y="39" width="14" height="6" rx="1.5"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      {/* Face buttons */}
      <circle cx="53" cy="37" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="53" cy="45" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="49" cy="41" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="57" cy="41" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      {/* Bumpers */}
      <path d="M26 23 C23 17 17 15 14 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M54 23 C57 17 63 15 66 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  'played': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Trophy cup body */}
      <path d="M26 17 L54 17 L54 42 C54 53 26 53 26 42 Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.10)" />
      {/* Left handle */}
      <path d="M26 21 C16 21 14 32 23 37"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Right handle */}
      <path d="M54 21 C64 21 66 32 57 37"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Stem */}
      <line x1="40" y1="53" x2="40" y2="62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Base */}
      <line x1="30" y1="62" x2="50" y2="62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Check mark */}
      <path d="M32 35 L38 42 L50 26"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  'lists': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Three stacked pages */}
      <rect x="17" y="24" width="36" height="44" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.05)"
        transform="rotate(-5 35 46)" />
      <rect x="17" y="22" width="36" height="44" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.07)"
        transform="rotate(2.5 35 44)" />
      <rect x="15" y="13" width="38" height="46" rx="3"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.11)" />
      {/* Text lines on front page */}
      <line x1="22" y1="23" x2="46" y2="23"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="22" y1="30" x2="46" y2="30"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
      <line x1="22" y1="37" x2="38" y2="37"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
      {/* Plus badge — create hint */}
      <circle cx="57" cy="57" r="10" fill="rgba(200,150,90,0.14)" stroke="currentColor" strokeWidth="1.5" />
      <line x1="57" y1="52" x2="57" y2="62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="52" y1="57" x2="62" y2="57" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  'reviews': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Quill feather body */}
      <path d="M57 11 C66 11 70 22 61 35 L42 62 L37 57 L51 35 C44 31 40 22 45 13 C49 7 57 11 57 11Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.10)" />
      {/* Barbs on the vane */}
      <path d="M53 15 L45 28" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <path d="M57 20 L50 32" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <path d="M59 27 L53 38" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      {/* Nib triangle */}
      <path d="M37 57 L32 68 L45 60 Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(200,150,90,0.15)" />
      {/* Ink trail */}
      <line x1="35" y1="64" x2="20" y2="68"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  ),

  'activity': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Clock face */}
      <circle cx="40" cy="38" r="22" stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.07)" />
      {/* Tick marks at 12, 3, 6, 9 */}
      <line x1="40" y1="17" x2="40" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="40" y1="55" x2="40" y2="59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="19" y1="38" x2="23" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="57" y1="38" x2="61" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      {/* Hour hand (pointing up-left, ~10 o'clock) */}
      <line x1="40" y1="38" x2="32" y2="24"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Minute hand (pointing right, ~3 o'clock) */}
      <line x1="40" y1="38" x2="54" y2="38"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx="40" cy="38" r="2.5" fill="currentColor" />
      {/* Zzz hint */}
      <text x="32" y="72" fontSize="10" fill="currentColor" opacity="0.28" fontFamily="sans-serif">zzz</text>
    </svg>
  ),

  'search': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* Magnifying glass circle */}
      <circle cx="34" cy="34" r="19" stroke="currentColor" strokeWidth="2.5" fill="rgba(200,150,90,0.08)" />
      {/* Handle */}
      <line x1="48" y1="48" x2="66" y2="66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Question mark stem */}
      <path d="M29 27 C29 22 35 20 39 23 C43 26 42 31 38 34 C37 35 34 36 34 39"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      {/* Question mark dot */}
      <circle cx="34" cy="43" r="2" fill="currentColor" />
    </svg>
  ),

  'developer': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      {/* 2×2 grid of game covers, bottom-right is empty/dashed */}
      <rect x="10" y="10" width="26" height="34" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.10)" />
      <line x1="14" y1="10" x2="14" y2="44"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
      <rect x="44" y="10" width="26" height="34" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.10)" />
      <line x1="48" y1="10" x2="48" y2="44"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
      <rect x="10" y="52" width="26" height="18" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.06)" />
      {/* Empty dashed slot */}
      <rect x="44" y="52" width="26" height="18" rx="3"
        stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2.5" fill="none" opacity="0.35" />
      {/* Small question mark in the empty slot */}
      <text x="54" y="65" fontSize="12" fill="currentColor" opacity="0.3" fontFamily="sans-serif">?</text>
    </svg>
  ),
}

/**
 * EmptyState
 *
 * Props:
 *   variant   – one of the illustration keys above
 *   copy      – single-line copy string
 *   cta       – label for the CTA button (omit to hide button)
 *   onCta     – click handler for the CTA button
 *   compact   – boolean; reduces padding for inline / card contexts
 */
function EmptyState({ variant, copy, cta, onCta, compact = false }) {
  const illustration = illustrations[variant]
  return (
    <div className={`es-root${compact ? ' es-root--compact' : ''}`}>
      {illustration && (
        <div className="es-illustration">
          {illustration}
        </div>
      )}
      {copy && <p className="es-copy">{copy}</p>}
      {cta && onCta && (
        <button className="es-cta" onClick={onCta} type="button">
          {cta}
        </button>
      )}
    </div>
  )
}

export default EmptyState
