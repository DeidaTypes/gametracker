const AVATAR_MAX_PX = 1200
const AVATAR_QUALITY = 0.85

/**
 * Compress an image File/Blob to at most AVATAR_MAX_PX × AVATAR_MAX_PX at
 * AVATAR_QUALITY. Returns a Promise<Blob> (image/jpeg). Falls back to the
 * original file if the Canvas API is unavailable (SSR / very old browser).
 */
export default async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width <= AVATAR_MAX_PX && height <= AVATAR_MAX_PX) {
        // Already small — still re-encode at quality 0.85 to strip EXIF.
      } else {
        const ratio = Math.min(AVATAR_MAX_PX / width, AVATAR_MAX_PX / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => resolve(blob || file),
          'image/jpeg',
          AVATAR_QUALITY
        )
      } catch {
        resolve(file)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}
