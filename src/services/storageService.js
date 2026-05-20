import { supabase } from './supabase'
import { updateProfile } from './profileService'

const BUCKET = 'profile-banners'
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

const EXT_MAP = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function getExt(file) {
  return EXT_MAP[file.type] || 'jpg'
}

/**
 * Extract the Supabase Storage object path from a public URL.
 * Public URLs look like:
 *   https://<project>.supabase.co/storage/v1/object/public/profile-banners/<path>
 */
function extractStoragePath(publicUrl) {
  if (!publicUrl) return null
  const marker = `/${BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return publicUrl.slice(idx + marker.length)
}

/**
 * Silently delete a storage object. Failure is non-fatal (orphaned files
 * cost ~nothing on the free tier) so we swallow errors here.
 */
async function deleteStorageObject(path) {
  if (!path) return
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch {
    // intentionally swallowed
  }
}

/**
 * Upload a new profile banner for `currentUser`.
 *
 * - Validates MIME type (jpeg / png / webp) and size (< 5 MB).
 * - Uploads to the `profile-banners` bucket with a user-scoped, timestamped
 *   path so re-uploads always bust CDN caches.
 * - Updates `users.banner_url` in Supabase.
 * - Syncs `bannerUrl` into the localStorage profile blob.
 * - Deletes the previously-stored object when `oldBannerUrl` is supplied.
 *
 * @param {File}   file           The image file chosen by the user.
 * @param {object} currentUser    The Supabase auth user (must have `.id`).
 * @param {string} [oldBannerUrl] Public URL of the previous banner to delete.
 * @returns {Promise<string>} The public URL of the newly-uploaded banner.
 */
export async function uploadBanner(file, currentUser, oldBannerUrl) {
  if (!ALLOWED_MIME.includes(file.type)) {
    throw new Error('Banner must be a JPEG, PNG, or WebP image.')
  }
  if (file.size > MAX_SIZE) {
    throw new Error('Banner image must be less than 5 MB.')
  }

  const ext = getExt(file)
  const path = `${currentUser.id}/banner-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  const { error: updateError } = await supabase
    .from('users')
    .update({ banner_url: publicUrl })
    .eq('id', currentUser.id)

  if (updateError) throw updateError

  // Keep the local profile blob in sync so the Profile screen re-renders
  // immediately after the `profileUpdated` event is dispatched by the caller.
  updateProfile({ bannerUrl: publicUrl })

  // Clean up the old object after the new one is safely persisted.
  if (oldBannerUrl) {
    await deleteStorageObject(extractStoragePath(oldBannerUrl))
  }

  return publicUrl
}

/**
 * Remove a user's banner: clears `users.banner_url`, wipes the localStorage
 * profile field, and deletes the storage object.
 *
 * @param {object} currentUser   The Supabase auth user.
 * @param {string} oldBannerUrl  Current public URL (used to derive path for deletion).
 */
export async function removeBanner(currentUser, oldBannerUrl) {
  const { error } = await supabase
    .from('users')
    .update({ banner_url: null })
    .eq('id', currentUser.id)

  if (error) throw error

  updateProfile({ bannerUrl: null })

  await deleteStorageObject(extractStoragePath(oldBannerUrl))
}

/**
 * Fetch another user's banner URL directly from Supabase (used when viewing
 * a profile that isn't the signed-in user, since their data isn't in our
 * local profile blob).
 *
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function fetchUserBannerUrl(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('banner_url')
    .eq('id', userId)
    .single()

  if (error) return null
  return data?.banner_url || null
}
