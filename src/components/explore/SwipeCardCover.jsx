import React, { useEffect, useState, useRef } from 'react'
import { coverUrl, imageIdFromCoverUrl } from '../../services/igdbImage'
import { getSizedImageUrl } from '../../services/imageUtils'

const SWIPE_COVER_DISPLAY_PX = 360

/** True when the browser already has `url` in its image cache. */
function isImageCached(url) {
  const probe = new Image()
  probe.src = url
  return probe.complete && probe.naturalWidth > 0
}

/** Load + decode an image URL; onload is the fallback if decode() throws. */
async function loadAndDecode(url) {
  const img = new Image()
  img.decoding = 'async'
  img.src = url

  await new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('cover load failed'))
  })

  try {
    await img.decode()
  } catch {
    /* onload already delivered pixels */
  }

  return img
}

/**
 * SwipeCardCover — cover art for a swipe deck card.
 *
 * With a cover image_id: loads t_cover_big_2x in the background for every
 * card in the stack (prefetch in SwipeDeck warms the next two). Shows
 * t_cover_big until retina cover is decoded, then swaps — 120ms crossfade
 * on the top card only (instant under reduced motion). When a stack card
 * promotes to top, an already-decoded cover_big_2x stays visible — no
 * flash back to cover_big.
 */
export function SwipeCardCover({ game, isTop, reduced, coverRef }) {
  const rawCover = game.image || game.coverUrl || null
  const imageId = game.coverImageId ?? imageIdFromCoverUrl(rawCover)

  const previewUrl = imageId
    ? coverUrl(imageId, 'cover_big')
    : rawCover
      ? getSizedImageUrl(rawCover, SWIPE_COVER_DISPLAY_PX)
      : null

  const hdUrl = imageId ? coverUrl(imageId, 'cover_big_2x') : previewUrl

  const useProgressive = Boolean(imageId && previewUrl && hdUrl && previewUrl !== hdUrl)

  const [hdReady, setHdReady] = useState(
    () => useProgressive && isImageCached(hdUrl)
  )
  const loadGenRef = useRef(0)

  useEffect(() => {
    if (!useProgressive) {
      setHdReady(false)
      return undefined
    }

    if (isImageCached(hdUrl)) {
      let cancelled = false
      loadAndDecode(hdUrl)
        .then(() => {
          if (!cancelled) setHdReady(true)
        })
        .catch(() => {
          if (!cancelled) setHdReady(true)
        })
      return () => {
        cancelled = true
      }
    }

    setHdReady(false)
    const gen = ++loadGenRef.current
    let cancelled = false

    loadAndDecode(hdUrl)
      .then(() => {
        if (!cancelled && gen === loadGenRef.current) setHdReady(true)
      })
      .catch(() => {
        /* t_cover_big_2x failed — preview stays visible */
      })

    return () => {
      cancelled = true
    }
  }, [useProgressive, hdUrl])

  if (!previewUrl) {
    return (
      <div className="swipe-card__placeholder" aria-hidden="true">
        {game.title?.charAt(0) ?? '?'}
      </div>
    )
  }

  if (!useProgressive) {
    return (
      <img
        src={previewUrl}
        alt=""
        ref={isTop ? coverRef : undefined}
        className="swipe-card__img"
        width={360}
        height={480}
        draggable="false"
        loading={isTop ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={isTop ? 'high' : 'auto'}
      />
    )
  }

  const hdClass = [
    'swipe-card__img',
    'swipe-card__img--hd',
    hdReady ? 'swipe-card__img--hd-ready' : '',
    isTop && !reduced ? 'swipe-card__img--hd-crossfade' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {!hdReady && (
        <img
          src={previewUrl}
          alt=""
          ref={isTop ? coverRef : undefined}
          className="swipe-card__img swipe-card__img--preview"
          width={360}
          height={480}
          draggable="false"
          loading={isTop ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={isTop ? 'high' : 'auto'}
        />
      )}
      <img
        src={hdUrl}
        alt=""
        aria-hidden={!hdReady ? 'true' : undefined}
        ref={hdReady && isTop ? coverRef : undefined}
        className={hdClass}
        width={360}
        height={480}
        draggable="false"
        decoding="async"
        loading={isTop ? 'eager' : 'lazy'}
        fetchPriority={isTop ? 'high' : 'auto'}
      />
    </>
  )
}
