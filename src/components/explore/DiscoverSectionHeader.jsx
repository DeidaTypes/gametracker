import React from 'react'
import { ChevronRight } from 'lucide-react'
import Pressable from '../Pressable'
import './DiscoverSectionHeader.css'

/**
 * DiscoverSectionHeader — tappable Explore section header (option A).
 *
 * The entire title row is one tap target when more items exist behind the
 * section. Left: existing title (+ optional subtitle). Right: total count
 * and chevron in muted secondary text, baseline-aligned to the title.
 *
 * Props:
 *   title            — section title (string or node; unchanged styling)
 *   subtitle         — optional caption beneath the title
 *   visibleCount     — items currently shown in the rail
 *   totalCount       — total available in the section; null/undefined when
 *                      genuinely unknown without an extra query
 *   destinationLabel — short name for aria-label (e.g. "New releases")
 *   onNavigate       — called when the header is activated
 */
export default function DiscoverSectionHeader({
  title,
  subtitle,
  visibleCount = 0,
  totalCount = null,
  destinationLabel,
  onNavigate,
}) {
  const totalKnown = totalCount != null
  const hasMore = totalKnown ? totalCount > visibleCount : Boolean(onNavigate)
  const showCount = totalKnown && totalCount > visibleCount
  const isTappable = Boolean(onNavigate) && hasMore

  const meta = isTappable ? (
    <span className="discover-section-entry__meta" aria-hidden="true">
      {showCount && (
        <span className="discover-section-entry__count">{totalCount}</span>
      )}
      <ChevronRight size={16} className="discover-section-entry__chevron" />
    </span>
  ) : null

  const ariaLabel = isTappable
    ? showCount
      ? `${destinationLabel}, ${totalCount} items, view all`
      : `${destinationLabel}, view all`
    : undefined

  const left = (
    <div className="discover-section-entry__left">
      <h2 className="discover-section-title">{title}</h2>
      {subtitle && (
        <p className="discover-section-entry__subtitle">{subtitle}</p>
      )}
    </div>
  )

  if (!isTappable) {
    return (
      <div className="discover-section-entry discover-section-entry--static">
        {left}
      </div>
    )
  }

  return (
    <Pressable
      className="discover-section-entry discover-section-entry--tappable"
      onClick={onNavigate}
      aria-label={ariaLabel}
    >
      {left}
      {meta}
    </Pressable>
  )
}
