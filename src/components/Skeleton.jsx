import React from 'react'
import './Skeleton.css'

/**
 * Primitive skeleton placeholder. Shape variants for composing
 * content-shaped loading states across the app.
 *
 * The shimmer animation is provided by the `.skeleton` utility
 * class defined in src/styles/theme.css. This component adds the
 * shape variants on top.
 *
 * Props:
 *   variant   – 'rect' (default) | 'circle' | 'text'
 *   width     – CSS value (string) or pixel number
 *   height    – CSS value (string) or pixel number
 *   className – extra class names
 *   style     – extra inline styles
 */
export default function Skeleton({
  variant = 'rect',
  width,
  height,
  className = '',
  style,
}) {
  const inlineStyle = {
    ...(width  !== undefined ? { width:  typeof width  === 'number' ? `${width}px`  : width  } : {}),
    ...(height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
    ...style,
  }

  return (
    <div
      className={`sk sk--${variant} skeleton${className ? ` ${className}` : ''}`}
      style={inlineStyle}
      aria-hidden="true"
    />
  )
}
