import React from 'react'
import './SectionHeader.css'

/**
 * SectionHeader — editorial section title with optional eyebrow label and action link.
 * Props:
 *   eyebrow  — small uppercase label above title
 *   title    — main section title
 *   action   — text of the action button (e.g. "See all")
 *   onAction — callback for action button
 */
function SectionHeader({ eyebrow, title, action, onAction }) {
  return (
    <div className="section-hdr">
      <div className="section-hdr-left">
        {eyebrow && <span className="section-hdr-eyebrow">{eyebrow}</span>}
        <h2 className="section-hdr-title">{title}</h2>
      </div>
      {action && (
        <button className="section-hdr-action" onClick={onAction} type="button">
          {action} <span className="section-hdr-arrow">→</span>
        </button>
      )}
    </div>
  )
}

export default SectionHeader
