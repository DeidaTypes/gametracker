import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import './DiscoverSubHeader.css'

/**
 * Sticky back-chevron + centred title for a Discover see-all screen.
 * Same chrome the /discover/reviews and /discover/collections pages
 * already carry, factored out so the drop and New & Notable grids
 * inherit it instead of restating it.
 */
export default function DiscoverSubHeader({ title }) {
  const navigate = useNavigate()

  return (
    <div className="discover-subheader">
      <button
        type="button"
        className="discover-subheader__btn"
        onClick={() => navigate(-1)}
        aria-label="Go back"
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <h1 className="discover-subheader__title">{title}</h1>
      <div className="discover-subheader__spacer" aria-hidden="true" />
    </div>
  )
}
