const DEFAULT_MAX_PX = 1200
const DEFAULT_QUALITY = 0.85

/**
 * Re-encode a photo as JPEG with its long edge at most maxPx (never
 * upscaled). Orientation comes from the file. Throws Error code
 * IMAGE_UNREADABLE when the file cannot be decoded or the canvas cannot
 * produce a JPEG — the original file is never returned.
 */
export default async function compressImage(file, { maxPx = DEFAULT_MAX_PX, quality = DEFAULT_QUALITY } = {}) {
  if (typeof createImageBitmap === 'function') {
    return compressBitmap(file, maxPx, quality)
  }
  return compressElement(file, maxPx, quality)
}

function imageUnreadable() {
  const err = new Error("Couldn't read that photo")
  err.code = 'IMAGE_UNREADABLE'
  return err
}

function fitLongEdge(width, height, maxPx) {
  if (!(width > 0) || !(height > 0) || !(maxPx > 0)) return null
  const longEdge = Math.max(width, height)
  if (longEdge <= maxPx) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxPx / longEdge
  const fitted = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
  if (fitted.width > maxPx) fitted.width = Math.round(maxPx)
  if (fitted.height > maxPx) fitted.height = Math.round(maxPx)
  return fitted
}

function renderJpeg(source, width, height, quality) {
  if (!(width > 0) || !(height > 0)) return Promise.reject(imageUnreadable())
  let canvas
  try {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.reject(imageUnreadable())
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)
  } catch {
    return Promise.reject(imageUnreadable())
  }
  if (typeof canvas.toBlob !== 'function') return Promise.reject(imageUnreadable())
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) reject(imageUnreadable())
        else resolve(blob)
      }, 'image/jpeg', quality)
    } catch {
      reject(imageUnreadable())
    }
  })
}

async function compressBitmap(file, maxPx, quality) {
  let bitmap
  let scaled
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = fitLongEdge(bitmap.width, bitmap.height, maxPx)
    if (!size) throw imageUnreadable()
    // Paint a bitmap that is already at the output size. A 48 MP frame or a
    // panorama is larger than the canvas will draw reliably.
    let source = bitmap
    if (size.width !== bitmap.width || size.height !== bitmap.height) {
      try {
        scaled = await createImageBitmap(bitmap, {
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: 'high',
        })
        source = scaled
      } catch {
        source = bitmap
      }
    }
    return await renderJpeg(source, size.width, size.height, quality)
  } catch (err) {
    if (err?.code === 'IMAGE_UNREADABLE') throw err
    throw imageUnreadable()
  } finally {
    try { scaled?.close?.() } catch { /* bitmap already released */ }
    try { bitmap?.close?.() } catch { /* bitmap already released */ }
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(imageUnreadable())
    }
    img.src = url
  })
}

async function compressElement(file, maxPx, quality) {
  const img = await loadImage(file)
  const size = fitLongEdge(img.naturalWidth || img.width, img.naturalHeight || img.height, maxPx)
  if (!size) throw imageUnreadable()
  try {
    return await renderJpeg(img, size.width, size.height, quality)
  } catch (err) {
    if (err?.code === 'IMAGE_UNREADABLE') throw err
    throw imageUnreadable()
  }
}
