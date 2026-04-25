import React from 'react'
import './CoverPlaceholder.css'

function CoverPlaceholder({ title, className = '', style = {} }) {
  const hash = (title || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hues = [220, 240, 200, 260, 180]
  const hue = hues[hash % hues.length]

  return (
    <div
      className={`cover-placeholder ${className}`}
      style={{
        background: `hsl(${hue}, 20%, 18%)`,
        ...style,
      }}
    >
      <span className="cover-placeholder__title">{title || 'Untitled'}</span>
    </div>
  )
}

export default CoverPlaceholder
