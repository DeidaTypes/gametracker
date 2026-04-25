import React from 'react'
import './Container.css'

/**
 * Container component for consistent mobile-first layout
 * Provides consistent horizontal padding and max-width
 * 
 * Props:
 * - children: Content to wrap
 * - noPadding: Remove horizontal padding (for full-bleed content)
 * - className: Additional CSS classes
 */
function Container({ children, noPadding = false, className = '' }) {
  const classes = ['container', className]
    .filter(Boolean)
    .join(' ')

  if (noPadding) {
    return <div className={`${classes} container-no-padding`}>{children}</div>
  }

  return <div className={classes}>{children}</div>
}

export default Container
