import React from 'react'
import './EmptyState.css'

/* ---------------------------------------------------------------
   Inline SVG illustrations — kept for backward compat with pages
   that still reference variant="search" / variant="developer" etc.
   New callers should pass `icon` (a lucide-react component) instead.
--------------------------------------------------------------- */
const illustrations = {
  'want-to-play': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <rect x="9" y="16" width="33" height="46" rx="4"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.05)"
        transform="rotate(-9 25.5 39)" />
      <rect x="15" y="13" width="33" height="46" rx="4"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.07)"
        transform="rotate(3 31.5 36)" />
      <rect x="22" y="11" width="34" height="48" rx="4"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.12)" />
      <line x1="27" y1="11" x2="27" y2="59"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <line x1="32" y1="22" x2="52" y2="22"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
      <line x1="32" y1="28" x2="52" y2="28"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
    </svg>
  ),

  'currently-playing': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <path
        d="M16 40 C16 30 22 23 32 23 L48 23 C58 23 64 30 64 40 C64 52 56 58 48 58 L32 58 C24 58 16 52 16 40Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.09)" />
      <path d="M16 40 C14 44 12 52 16 58 L26 58"
        stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M64 40 C66 44 68 52 64 58 L54 58"
        stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="25" y="35" width="6" height="14" rx="1.5"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <rect x="21" y="39" width="14" height="6" rx="1.5"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="53" cy="37" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="53" cy="45" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="49" cy="41" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <circle cx="57" cy="41" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.15)" />
      <path d="M26 23 C23 17 17 15 14 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M54 23 C57 17 63 15 66 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  'played': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <path d="M26 17 L54 17 L54 42 C54 53 26 53 26 42 Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.10)" />
      <path d="M26 21 C16 21 14 32 23 37"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M54 21 C64 21 66 32 57 37"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <line x1="40" y1="53" x2="40" y2="62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="62" x2="50" y2="62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 35 L38 42 L50 26"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  'lists': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <rect x="17" y="24" width="36" height="44" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.05)"
        transform="rotate(-5 35 46)" />
      <rect x="17" y="22" width="36" height="44" rx="3"
        stroke="currentColor" strokeWidth="1.5" fill="rgba(200,150,90,0.07)"
        transform="rotate(2.5 35 44)" />
      <rect x="15" y="13" width="38" height="46" rx="3"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.11)" />
      <line x1="22" y1="23" x2="46" y2="23"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="22" y1="30" x2="46" y2="30"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
      <line x1="22" y1="37" x2="38" y2="37"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
      <circle cx="57" cy="57" r="10" fill="rgba(200,150,90,0.14)" stroke="currentColor" strokeWidth="1.5" />
      <line x1="57" y1="52" x2="57" y2="62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="52" y1="57" x2="62" y2="57" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  'reviews': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <path d="M57 11 C66 11 70 22 61 35 L42 62 L37 57 L51 35 C44 31 40 22 45 13 C49 7 57 11 57 11Z"
        stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.10)" />
      <path d="M53 15 L45 28" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <path d="M57 20 L50 32" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <path d="M59 27 L53 38" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <path d="M37 57 L32 68 L45 60 Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(200,150,90,0.15)" />
      <line x1="35" y1="64" x2="20" y2="68"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  ),

  'activity': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <circle cx="40" cy="38" r="22" stroke="currentColor" strokeWidth="2" fill="rgba(200,150,90,0.07)" />
      <line x1="40" y1="17" x2="40" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="40" y1="55" x2="40" y2="59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="19" y1="38" x2="23" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="57" y1="38" x2="61" y2="38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="40" y1="38" x2="32" y2="24"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="40" y1="38" x2="54" y2="38"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="40" cy="38" r="2.5" fill="currentColor" />
      <text x="32" y="72" fontSize="10" fill="currentColor" opacity="0.28" fontFamily="sans-serif">zzz</text>
    </svg>
  ),

  'search': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
      <circle cx="34" cy="34" r="19" stroke="currentColor" strokeWidth="2.5" fill="rgba(200,150,90,0.08)" />
      <line x1="48" y1="48" x2="66" y2="66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M29 27 C29 22 35 20 39 23 C43 26 42 31 38 34 C37 35 34 36 34 39"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="34" cy="43" r="2" fill="currentColor" />
    </svg>
  ),

  'developer': (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="es-svg">
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
      <rect x="44" y="52" width="26" height="18" rx="3"
        stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2.5" fill="none" opacity="0.35" />
      <text x="54" y="65" fontSize="12" fill="currentColor" opacity="0.3" fontFamily="sans-serif">?</text>
    </svg>
  ),
}

/**
 * EmptyState — intentional empty state with icon, title, body, and optional CTA.
 *
 * NEW API (preferred):
 *   icon      – lucide-react component (32 px, var(--color-text-tertiary))
 *   title     – headline string (16px / 600 / var(--color-text-primary))
 *   body      – supporting copy (13px / 400 / var(--color-text-secondary))
 *   cta       – CTA button label
 *   onCta     – CTA click handler
 *
 * LEGACY API (backward compat with ActivityFeed, DeveloperDetail, Search):
 *   variant   – one of the SVG illustration keys above
 *   copy      – single-line copy string
 *   cta       – CTA button label
 *   onCta     – CTA click handler
 *
 * Shared:
 *   compact   – reduce padding (for inline / card contexts)
 */
function EmptyState({ icon: Icon, title, body, variant, copy, cta, onCta, compact = false }) {
  const illustration = variant ? illustrations[variant] : null

  return (
    <div className={`es-root${compact ? ' es-root--compact' : ''}`}>

      {/* Lucide icon (new API) */}
      {Icon && !illustration && (
        <div className="es-icon" aria-hidden="true">
          <Icon size={32} strokeWidth={1.5} />
        </div>
      )}

      {/* SVG illustration (legacy API) */}
      {illustration && (
        <div className="es-illustration">
          {illustration}
        </div>
      )}

      {/* Title (new API) */}
      {title && <h2 className="es-title">{title}</h2>}

      {/* Body (new API) */}
      {body && <p className="es-body">{body}</p>}

      {/* Legacy single-line copy */}
      {!title && !body && copy && <p className="es-copy">{copy}</p>}

      {cta && onCta && (
        <button className="es-cta" onClick={onCta} type="button">
          {cta}
        </button>
      )}
    </div>
  )
}

export default EmptyState
