import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './PillTabs.css'

/**
 * Horizontally scrolling pill tab bar — equal padding per pill, fixed gap,
 * optional right-edge fade when content overflows.
 */
export default function PillTabs({
  items,
  value,
  onChange,
  ariaLabel,
  className = '',
}) {
  const scrollRef = useRef(null)
  const tabRefs = useRef(new Map())
  const { reduced } = useMotionPreference()
  const [showEdge, setShowEdge] = useState(false)

  const updateEdge = useCallback(() => {
    const sc = scrollRef.current
    if (!sc) return
    setShowEdge(sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return

    sc.addEventListener('scroll', updateEdge, { passive: true })
    const ro = new ResizeObserver(updateEdge)
    ro.observe(sc)
    updateEdge()

    return () => {
      sc.removeEventListener('scroll', updateEdge)
      ro.disconnect()
    }
  }, [updateEdge, items])

  const centerTab = useCallback(
    (id) => {
      const sc = scrollRef.current
      const el = tabRefs.current.get(id)
      if (!sc || !el) return
      const left = el.offsetLeft - (sc.clientWidth - el.offsetWidth) / 2
      sc.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' })
    },
    [reduced],
  )

  useEffect(() => {
    centerTab(value)
  }, [value, centerTab])

  const handleSelect = (id) => {
    if (id !== value) onChange(id)
    centerTab(id)
  }

  return (
    <div className={['pill-tabs', className].filter(Boolean).join(' ')}>
      <div
        className={
          showEdge ? 'pill-tabs__wrap pill-tabs__wrap--edge' : 'pill-tabs__wrap'
        }
      >
        <div
          ref={scrollRef}
          className="pill-tabs__scroll"
          role="tablist"
          aria-label={ariaLabel}
        >
          {items.map((item) => {
            const selected = value === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className="pill-tabs__tab"
                ref={(node) => {
                  if (node) tabRefs.current.set(item.id, node)
                  else tabRefs.current.delete(item.id)
                }}
                onClick={() => handleSelect(item.id)}
              >
                <span
                  className={
                    selected
                      ? 'pill-tabs__pill pill-tabs__pill--active text-body'
                      : 'pill-tabs__pill text-body'
                  }
                >
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
