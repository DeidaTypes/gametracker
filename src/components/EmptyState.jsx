import React from 'react'
import './EmptyState.css'

/**
 * EmptyState — the single shared "nothing here yet" surface for the whole
 * app. Every empty collection, empty search result, and empty section
 * renders through this component so icon language, copy rhythm, and CTA
 * styling are consistent everywhere (see DESIGN_SYSTEM.md).
 *
 * Props:
 *   icon       – lucide-react component. One icon language app-wide — no
 *                emoji, no inline SVG illustrations. Optional (many inline
 *                / search-result empties render text only).
 *   title      – headline string (compact/default sizes only).
 *   body       – supporting copy. Works alone (no title) for single-line
 *                empties like search-result misses.
 *   cta        – CTA button label.
 *   onCta      – CTA click handler. cta + onCta must both be set to render
 *                the button.
 *   ctaVariant – 'primary' (default) | 'secondary'.
 *                'primary' is the app's gradient CTA fill (--grad-cta) —
 *                use for the main "go create/find content" action.
 *                'secondary' is an outlined ghost button — use for
 *                lower-emphasis, non-content-creating actions embedded in a
 *                compact/inline empty state (e.g. "Clear filter", "Retry").
 *                Never render a solid-cobalt-fill CTA.
 *   size       – 'default' (full page / full section, e.g. an empty
 *                Library or empty Followers list) | 'compact' (in-page
 *                section or bottom-sheet empty, e.g. a card's empty
 *                sub-list) | 'inline' (single-line, e.g. "No results for
 *                \u2018x\u2019" inside a search dropdown or modal list).
 *   compact    – boolean back-compat alias for size="compact".
 */
function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
  onCta,
  ctaVariant = 'primary',
  size = 'default',
  compact = false,
}) {
  const resolvedSize = size !== 'default' ? size : compact ? 'compact' : 'default'
  const iconSize = resolvedSize === 'inline' ? 20 : resolvedSize === 'compact' ? 28 : 32

  return (
    <div className={`es-root${resolvedSize !== 'default' ? ` es-root--${resolvedSize}` : ''}`}>
      {Icon && (
        <div className="es-icon" aria-hidden="true">
          <Icon size={iconSize} strokeWidth={1.5} />
        </div>
      )}

      {title && <h2 className="es-title">{title}</h2>}

      {body && <p className="es-body">{body}</p>}

      {cta && onCta && (
        <button
          type="button"
          className={`es-cta${ctaVariant === 'secondary' ? ' es-cta--secondary' : ''}`}
          onClick={onCta}
        >
          {cta}
        </button>
      )}
    </div>
  )
}

export default EmptyState
