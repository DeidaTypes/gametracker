import React from 'react'
import './Section.css'

/**
 * Section component for consistent vertical spacing
 * 
 * Props:
 * - children: Content to wrap
 * - spacing: 'sm' | 'md' | 'lg' | 'xl' (default: 'lg')
 * - borderTop: Add top border
 * - borderBottom: Add bottom border
 * - className: Additional CSS classes
 */
function Section({ 
  children, 
  spacing = 'lg', 
  borderTop = false, 
  borderBottom = false,
  className = '' 
}) {
  const classes = [
    'section',
    `section-spacing-${spacing}`,
    borderTop && 'section-border-top',
    borderBottom && 'section-border-bottom',
    className
  ].filter(Boolean).join(' ')

  return <div className={classes}>{children}</div>
}

export default Section
