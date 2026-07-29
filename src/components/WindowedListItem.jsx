import React, { useEffect, useRef, useState } from 'react'

/**
 * DOM-recycling wrapper for long, infinitely-scrolling lists (Home's
 * Pulse feed, Followers/Following lists). Renders `children` normally
 * while the item is anywhere near the viewport; once it scrolls well
 * outside `rootMargin`, its subtree is unmounted and swapped for a
 * plain, height-matched placeholder — so a feed that's accumulated
 * hundreds of loaded items never keeps hundreds of live component
 * instances (avatars, like-state hooks, etc.) mounted at once.
 *
 * Deliberately not fixed-height virtualization: each item measures
 * its own last-rendered height before collapsing, so this works with
 * the naturally variable heights these cards already have (review
 * text length, list mosaics vs. single covers, etc.) without a
 * separate item-height model.
 *
 * Items remount (not just repaint) when they scroll back into range —
 * any transient in-card UI state (an expanded "Read more", an open
 * kebab menu) resets, which is an accepted trade-off of recycling.
 */
function WindowedListItem({ children, rootMargin = '1200px 0px', className }) {
  const containerRef = useRef(null)
  const [inView, setInView] = useState(true)
  const lastHeightRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
        } else {
          const height = el.getBoundingClientRect().height
          if (height > 0) lastHeightRef.current = height
          setInView(false)
        }
      },
      { rootMargin, threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return (
    <div
      ref={containerRef}
      className={className}
      style={!inView && lastHeightRef.current ? { height: lastHeightRef.current } : undefined}
      aria-hidden={!inView || undefined}
    >
      {inView ? children : null}
    </div>
  )
}

export default WindowedListItem
