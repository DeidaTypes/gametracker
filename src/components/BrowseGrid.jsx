import React, { useState, useEffect, useCallback, useRef } from 'react'
import BrowseCard from './BrowseCard'
import { fetchBrowseCategories, getCategoryDefinitions } from '../services/browseService'
import './BrowseGrid.css'

function BrowseGrid() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useRef(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchBrowseCategories()
      if (!isMounted.current) return
      const allFailed = data.every((c) => c.failed)
      if (allFailed) {
        setError('Could not load categories. Please try again.')
        setCategories([])
      } else {
        setCategories(data)
      }
    } catch (err) {
      if (!isMounted.current) return
      console.error('Failed to load browse categories:', err)
      setError('Could not load categories. Please try again.')
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    isMounted.current = true
    load()
    return () => { isMounted.current = false }
  }, [load])

  const defs = getCategoryDefinitions()

  const skeletonCards = defs.map((def, i) => {
    const baseColor = def.color
    const r = parseInt(baseColor.slice(1, 3), 16)
    const g = parseInt(baseColor.slice(3, 5), 16)
    const b = parseInt(baseColor.slice(5, 7), 16)
    return (
      <div
        key={`skel-${i}`}
        className="browse-card-skeleton"
        style={{
          background: `linear-gradient(90deg, rgba(${r},${g},${b},0.4) 25%, rgba(${r},${g},${b},0.55) 50%, rgba(${r},${g},${b},0.4) 75%)`,
          backgroundSize: '200% 100%',
          animationDelay: `${i * 60}ms`,
        }}
      />
    )
  })

  return (
    <div className="browse-grid-section">
      <div className="browse-grid-header">
        <h2 className="browse-grid-title">Browse All</h2>
      </div>

      {error && !loading && (
        <div className="browse-grid-error">
          <p>{error}</p>
          <button className="browse-grid-retry" type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      <div className="browse-grid browse-grid--animate">
        {loading && categories.length === 0
          ? skeletonCards
          : categories.map((cat, i) => (
              <BrowseCard key={cat.key} category={cat} index={i} />
            ))}
      </div>
    </div>
  )
}

export default BrowseGrid
