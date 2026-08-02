import React from 'react'
import './ReviewCardShell.css'

/**
 * ReviewCardShell — the single shared card surface for every place a
 * review renders app-wide (Home feed, Explore "From people you follow",
 * Game Details, Profile Reviews tab, review detail/thread).
 *
 * Owns ONLY the bounded card chrome: --color-bg-tertiary surface,
 * hairline --color-border, --radius-lg, --review-card-padding,
 * and --section-gap between this card's direct children. It renders no
 * header/body/footer markup of its own — everything else is `children`,
 * so wildly different content (HomeReviewCard's activity rows,
 * RecentActivityCard's taste-match strip, ReviewCard's cover header)
 * can share one identical box.
 *
 * `as` lets callers render a different root tag/component (e.g.
 * `motion.article` for ReviewCard's existing fade-in) without
 * duplicating the surface styles at each call site. Every other prop is
 * forwarded to that root element.
 */
export function ReviewCardShell({
  as: Component = 'article',
  className = '',
  children,
  ...rest
}) {
  return (
    <Component
      className={`review-card-shell${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </Component>
  )
}

/**
 * ReviewCardShellHeader — the one-line actor + action + timestamp row
 * shared by every card that leads with an identity header (Home's full
 * review card, Explore's RecentActivityCard, Game Detail's gamedetail
 * variant). NOT used by ReviewCard's default/compact/detail variants,
 * which intentionally keep their existing cover-header-first layout
 * (see ReviewCardShell.md-style note in ReviewCard.jsx) — that ordering
 * is a documented, locked Sprint 5 pattern reused across Profile, the
 * review thread, and both "all reviews" screens, not something this
 * refactor reorders.
 *
 * `avatar` renders fixed-width on the left. `children` is the flexible
 * middle — actor name + action verb + any screen-specific wording — and
 * by default is forced onto a single line (no wrap, clipped rather than
 * pushing the row taller). `end` renders fixed-width, right-aligned
 * content that never truncates (a timestamp, or timestamp + rating).
 *
 * `lineClassName` is an opt-in escape hatch from that single-line
 * default — pass a modifier class to let the line wrap onto a second
 * row instead of ellipsis-clipping mid-word, for a screen whose header
 * content can't be kept short/fixed-vocabulary. Left unset, every
 * current consumer (RecentActivityCard, ReviewCard's gamedetail
 * variant, HomeReviewCard) keeps today's exact single-line truncation
 * behavior — HomeReviewCard in particular no longer needs the escape
 * hatch since its header verb is always short and never carries a
 * game/list title (see HomeReviewCard.jsx's headerVerb).
 */
export function ReviewCardShellHeader({ avatar, end, className = '', lineClassName = '', children }) {
  return (
    <div className={`review-card-shell__header${className ? ` ${className}` : ''}`}>
      {avatar && <div className="review-card-shell__header-avatar">{avatar}</div>}
      <div className={`review-card-shell__header-line${lineClassName ? ` ${lineClassName}` : ''}`}>
        {children}
      </div>
      {end != null && <div className="review-card-shell__header-end">{end}</div>}
    </div>
  )
}

export default ReviewCardShell
