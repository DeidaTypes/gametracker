import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Scroll-linked profile header.
 *
 * One passive listener on `.main-content`, one rAF per frame. The bar's
 * height is cached on mount and when it resizes — the frame only writes
 * frost opacity.
 *
 * Frost opacity tracks scroll 0 → 24. The name observer reports when the
 * display name has passed under the bar.
 */

const FROST_START = 0
const FROST_RANGE = 24

function borderBlock(entry, el) {
  const box = entry.borderBoxSize
  const size = Array.isArray(box) ? box[0] : box
  if (size && typeof size.blockSize === 'number') return size.blockSize
  return el.offsetHeight
}

function isLive(el) {
  const layer = el.closest('.route-layer')
  if (!layer) return true
  return (
    !layer.classList.contains('route-layer--kept') &&
    !layer.classList.contains('route-layer--exiting') &&
    !layer.classList.contains('route-layer--held')
  )
}

export function useProfileHeaderScroll({
  barRef,
  frostRef,
  nameRef,
}) {
  const [solid, setSolid] = useState(false)
  const [named, setNamed] = useState(false)
  const solidRef = useRef(false)
  const namedRef = useRef(false)

  useLayoutEffect(() => {
    const bar = barRef.current
    const frost = frostRef.current
    const name = nameRef.current
    if (!bar || !frost) return undefined

    const scrollEl = bar.closest('.main-content')
    if (!scrollEl) return undefined

    const scrollTop = { current: scrollEl.scrollTop }
    const last = { frost: '' }
    let frame = 0
    let nameObserver = null
    let barHeight = bar.offsetHeight

    const write = () => {
      const y = scrollTop.current
      const frostT = Math.min(1, Math.max(0, (y - FROST_START) / FROST_RANGE))
      const frostStr = String(frostT)
      if (last.frost !== frostStr) {
        frost.style.opacity = frostStr
        last.frost = frostStr
      }
      const nextSolid = frostT > 0.5
      if (nextSolid !== solidRef.current) {
        solidRef.current = nextSolid
        setSolid(nextSolid)
      }
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        write()
      })
    }

    const onScroll = () => {
      if (!isLive(bar)) return
      scrollTop.current = scrollEl.scrollTop
      schedule()
    }

    const connectName = (inset) => {
      nameObserver?.disconnect()
      barHeight = inset
      if (!name || inset <= 0) return
      nameObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (!entry || !isLive(bar)) return
          const rootTop = entry.rootBounds?.top ?? 0
          const passed = entry.boundingClientRect.bottom <= rootTop + 0.5
          if (passed === namedRef.current) return
          namedRef.current = passed
          setNamed(passed)
        },
        {
          root: scrollEl,
          // The bar's border box is the safe area plus the 44px row.
          rootMargin: `-${inset}px 0px 0px 0px`,
          threshold: 0,
        }
      )
      nameObserver.observe(name)
    }

    connectName(barHeight)

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === bar) {
          const next = borderBlock(entry, bar)
          if (Math.abs(next - barHeight) >= 0.5) connectName(next)
        }
      }
      if (isLive(bar)) schedule()
    })
    ro.observe(bar)

    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    scrollTop.current = scrollEl.scrollTop
    // Before paint, so a restored scroll doesn't flash the wrong frost.
    // Later updates stay on the rAF path.
    write()

    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      nameObserver?.disconnect()
      ro.disconnect()
      frost.style.opacity = ''
    }
    // barRef/frostRef/nameRef are stable ref objects.
  }, [barRef, frostRef, nameRef])

  return { solid, named }
}
