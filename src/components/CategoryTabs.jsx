import React from 'react'
import './CategoryTabs.css'

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'popular-this-year', label: 'Popular this year' },
  { id: 'new-noteworthy', label: 'New & noteworthy' },
  { id: 'indie-gems', label: 'Indie gems' },
  { id: 'top-rated', label: 'Top rated' },
]

function CategoryTabs({ activeCategory, onCategoryChange }) {
  return (
    <div className="category-tabs">
      <div className="category-tabs-container">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            className={`category-tab ${activeCategory === category.id ? 'active' : ''}`}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default CategoryTabs
export { CATEGORIES }

