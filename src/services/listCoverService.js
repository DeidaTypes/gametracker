import { supabase } from './supabase'

const BUCKET = 'list-covers'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_PX = 1200

/**
 * Resize an image file to at most MAX_PX × MAX_PX using the Canvas API.
 * Drawing through a 2D canvas context also strips EXIF metadata, which
 * satisfies the privacy requirement without a third-party library.
 *
 * Always outputs JPEG (quality 0.88) to keep file sizes predictable.
 */
async function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      let { width, height } = img

      if (width > MAX_PX || height > MAX_PX) {
        if (width >= height) {
          height = Math.round((height * MAX_PX) / width)
          width = MAX_PX
        } else {
          width = Math.round((width * MAX_PX) / height)
          height = MAX_PX
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      URL.revokeObjectURL(objectUrl)

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Image processing failed.'))
          resolve(new File([blob], 'cover.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.88
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read image file.'))
    }

    img.src = objectUrl
  })
}

/**
 * Upload a custom cover image for a list.
 *
 * Flow:
 *   1. Validate file size client-side (≤ 5 MB)
 *   2. Resize to max 1200 × 1200 (strips EXIF as a side-effect)
 *   3. Upload to list-covers/{userId}/{listId}.jpg (upsert)
 *   4. PATCH lists.cover_image_url with the public URL
 *
 * @param {string} listId - UUID of the list
 * @param {File}   file   - Image file selected by the user
 * @returns {string} Cache-busted public URL for immediate display
 */
export async function uploadListCover(listId, file) {
  if (!file) throw new Error('No file selected.')

  if (file.size > MAX_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    throw new Error(
      `Image is too large (${sizeMB} MB). Maximum size is 5 MB.`
    )
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('You must be signed in to upload a cover.')

  const resized = await resizeImage(file)
  const path = `${user.id}/${listId}.jpg`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, resized, { upsert: true, contentType: 'image/jpeg' })

  if (uploadErr) {
    if (uploadErr.message?.toLowerCase().includes('bucket not found')) {
      throw new Error(
        'Storage bucket not configured. Run the list_cover_image.sql migration in the Supabase dashboard.'
      )
    }
    throw new Error(`Upload failed: ${uploadErr.message}`)
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = urlData?.publicUrl

  const { error: patchErr } = await supabase
    .from('lists')
    .update({ cover_image_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', listId)

  if (patchErr) {
    throw new Error(`Failed to save cover URL: ${patchErr.message}`)
  }

  // Append a cache-buster so the browser shows the new image immediately
  // without waiting for CDN cache expiry. Only used for local state — the
  // stable URL (without ?t=) is what's stored in the database.
  return `${publicUrl}?t=${Date.now()}`
}

/**
 * Remove the custom cover for a list.
 *
 * Deletes the object from storage (missing-file errors are swallowed — the
 * file may have been deleted manually) then NULLs out cover_image_url.
 *
 * @param {string} listId - UUID of the list
 * @param {string} userId - UUID of the current user (used for the storage path)
 */
export async function removeListCover(listId, userId) {
  let uid = userId
  if (!uid) {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) throw new Error('You must be signed in.')
    uid = user.id
  }

  const path = `${uid}/${listId}.jpg`
  await supabase.storage.from(BUCKET).remove([path])

  const { error: patchErr } = await supabase
    .from('lists')
    .update({ cover_image_url: null, updated_at: new Date().toISOString() })
    .eq('id', listId)

  if (patchErr) {
    throw new Error(`Failed to remove cover: ${patchErr.message}`)
  }
}
