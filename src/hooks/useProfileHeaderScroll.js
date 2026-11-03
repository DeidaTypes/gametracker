import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Scroll-linked profile header.
 *
 * One passive listener on `.main-content`, one rAF per frame. Sizes are
 * cached on mount and when the bar or art resizes — the frame only writes.
 *
 * Art or banner: translateY(scrollTop * 0.5) and opacity 1 − scrollTop / 220.
 * Wash: left alone. Frost opacity tracks scroll 90 → 140. Pull distance
 * scales the art from its bottom edge so a pull at scrollTop 0 stretches it
 * instead of opening a gap. Reduce Motion skips parallax and stretch.
 */

const FROST_START = 90
const FROST_RANGE = 50
const FADE_DISTANCE = 220
const PARALLAX = 0.5

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
  mediaRef,
  nameRef,
  pullRef,
  hasMedia,
  reduced,
}) {
  const [solid, setSolid] = useState(false)
  const [named, setNamed] = useState(false)
  const solidRef = useRef(false)
  const namedRef = useRef(false)
  const hasMediaRef = useRef(hasMedia)
  const reducedRef = useRef(reduced)
  hasMediaRef.current = hasMedia
  reducedRef.current = reduced

  useLayoutEffect(() => {
    const bar = barRef.current
    const frost = frostRef.current
    const name = nameRef.current
    if (!bar || !frost) return undefined

    const scrollEl = bar.closest('.main-content')
    if (!scrollEl) return undefined

    const media = hasMedia ? mediaRef.current : null
    const indicator = bar
      .closest('.pull-to-refresh')
      ?.querySelector('.pull-to-refresh__indicator')

    // The stretched art paints in the pull gap, above the in-flow spinner.
    // Lift the indicator (z-index 1) over the backdrop (0) and under the
    // bar (30) so the spinner stays visible. Cleared on unmount.
    if (indicator) {
      indicator.style.position = 'relative'
      indicator.style.zIndex = '1'
    }

    const scrollTop = { current: scrollEl.scrollTop }
    const visualPull = { current: 0 }
    const mediaHeight = { current: media ? media.offsetHeight : 0 }
    const last = { frost: '', transform: '', opacity: '' }
    let frame = 0
    let nameObserver = null
    let barHeight = bar.offsetHeight

    const writeMedia = (el, transform, opacity) => {
      if (last.transform !== transform) {
        el.style.transform = transform
        last.transform = transform
      }
      if (last.opacity !== opacity) {
        el.style.opacity = opacity
        last.opacity = opacity
      }
    }

    const clearMedia = () => {
      if (!media) return
      writeMedia(media, '', '')
    }

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

      if (!media || !hasMediaRef.current || reducedRef.current) {
        clearMedia()
        return
      }

      const pull = y > 0 ? 0 : visualPull.current
      const h = mediaHeight.current
      const scale = h > 0 && pull > 0 ? 1 + pull / h : 1
      const ty = y * PARALLAX
      const opacity = String(Math.min(1, Math.max(0, 1 - y / FADE_DISTANCE)))
      writeMedia(media, `translateY(${ty}px) scale(${scale})`, opacity)
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

    const onPull = (px) => {
      if (!isLive(bar)) return
      // A settle animates the indicator's height. Follow that used height
      // (ResizeObserver) so the art doesn't jump ahead of the gap. A live
      // finger writes the height with no transition — use px directly.
      const settling = !!(indicator && (indicator.style.transition || '').includes('height'))
      if (!settling) visualPull.current = px
      schedule()
    }

    if (pullRef) pullRef.current = onPull

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
      let pulled = false
      for (const entry of entries) {
        if (media && entry.target === media) {
          mediaHeight.current = borderBlock(entry, media)
        } else if (entry.target === bar) {
          const next = borderBlock(entry, bar)
          if (Math.abs(next - barHeight) >= 0.5) connectName(next)
        } else if (indicator && entry.target === indicator) {
          visualPull.current = borderBlock(entry, indicator)
          pulled = true
        }
      }
      // Indicator height (the pull gap) is already the post-layout value.
      // Write the scale before paint so it matches this frame.
      if (pulled) write()
      else if (isLive(bar)) schedule()
    })
    ro.observe(bar)
    if (media) ro.observe(media)
    if (indicator) ro.observe(indicator)

    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    scrollTop.current = scrollEl.scrollTop
    // Before paint, so a restored scroll or a mode swap doesn't flash the
    // wrong frost. Later updates stay on the rAF path.
    write()

    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      nameObserver?.disconnect()
      ro.disconnect()
      if (pullRef && pullRef.current === onPull) pullRef.current = null
      clearMedia()
      frost.style.opacity = ''
      if (indicator) {
        indicator.style.position = ''
        indicator.style.zIndex = ''
      }
    }
    // mediaRef/barRef/frostRef/nameRef/pullRef are stable ref objects.
    // hasMedia rebinds when the backdrop node swaps (banner ↔ art ↔ wash).
  }, [barRef, frostRef, mediaRef, nameRef, pullRef, hasMedia, reduced])

  return { solid, named }
}
