import React, { useEffect, useRef } from 'react'
import { LuCamera, LuImage, LuTrash2 } from 'react-icons/lu'
import ActionSheet from './ActionSheet'
import { showToast } from './Toast'
import {
  uploadAvatar,
  removeAvatar,
  uploadBanner,
  removeBanner,
} from '../services/storageService'
import compressImage from '../utils/compressImage'

const AVATAR_MAX_FILE_MB = 10
const PRELOAD_MS = 1600

export const EMPTY_PROFILE_HEADER_PREVIEW = {
  avatarOverride: false,
  avatarUrl: null,
  avatarDimmed: false,
  bannerOverride: false,
  bannerUrl: null,
  bannerDimmed: false,
}

// The public URL is usually cached by the time the header swaps to it.
// Give up waiting so a slow image host can't leave the preview dimmed.
function preloadImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const img = new Image()
    img.onload = done
    img.onerror = done
    img.src = url
    if (img.complete) done()
    setTimeout(done, PRELOAD_MS)
  })
}

// capture is applied inside the row's tap, then click() runs synchronously.
// iOS only opens the camera or library from that gesture.
function openPicker(input, capture) {
  if (!input) return
  if (capture) input.setAttribute('capture', capture)
  else input.removeAttribute('capture')
  input.click()
}

function ProfilePhotoMenus({
  user,
  avatarUrl,
  bannerUrl,
  photoOpen,
  bannerOpen,
  onPhotoClose,
  onBannerClose,
  onPreviewChange,
}) {
  const avatarInputRef = useRef(null)
  const bannerInputRef = useRef(null)
  const avatarGen = useRef(0)
  const bannerGen = useRef(0)
  const mounted = useRef(true)
  const previewRef = useRef(EMPTY_PROFILE_HEADER_PREVIEW)
  const onPreviewChangeRef = useRef(onPreviewChange)
  onPreviewChangeRef.current = onPreviewChange

  const commitPreview = (patch) => {
    const next = { ...previewRef.current, ...patch }
    previewRef.current = next
    onPreviewChangeRef.current(next)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      previewRef.current = EMPTY_PROFILE_HEADER_PREVIEW
      onPreviewChangeRef.current(EMPTY_PROFILE_HEADER_PREVIEW)
    }
  }, [])

  const handleAvatarFile = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file', 'error')
      return
    }
    if (file.size > AVATAR_MAX_FILE_MB * 1024 * 1024) {
      showToast('That image is too large', 'error', null, null, null, {
        sub: `Choose one under ${AVATAR_MAX_FILE_MB}MB`,
      })
      return
    }
    if (!user?.id) {
      showToast("Couldn't upload your photo", 'error', null, null, null, { sub: 'Try again' })
      return
    }

    const gen = ++avatarGen.current
    const objectUrl = URL.createObjectURL(file)
    const previousUrl = avatarUrl
    commitPreview({ avatarOverride: true, avatarUrl: objectUrl, avatarDimmed: true })

    let compressed
    try {
      compressed = await compressImage(file)
    } catch {
      if (!mounted.current || gen !== avatarGen.current) return
      commitPreview({ avatarOverride: false, avatarUrl: null, avatarDimmed: false })
      showToast("Couldn't process that image", 'error', null, null, null, { sub: 'Try another file' })
      return
    }
    if (!mounted.current || gen !== avatarGen.current) return

    try {
      const newUrl = await uploadAvatar(compressed, user, previousUrl)
      if (!mounted.current || gen !== avatarGen.current) return
      showToast('Photo updated', 'success', null, null, null, { tone: 'saved' })
      window.dispatchEvent(new Event('profileUpdated'))
      await preloadImage(newUrl)
      if (!mounted.current || gen !== avatarGen.current) return
      commitPreview({ avatarOverride: false, avatarUrl: null, avatarDimmed: false })
    } catch (err) {
      if (!mounted.current || gen !== avatarGen.current) return
      commitPreview({ avatarOverride: false, avatarUrl: null, avatarDimmed: false })
      showToast("Couldn't upload your photo", 'error', null, null, null, {
        sub: err?.message || 'Try again',
      })
    }
  }

  const handleRemoveAvatar = async () => {
    if (!avatarUrl || !user?.id) return
    const gen = ++avatarGen.current
    const previousUrl = avatarUrl
    commitPreview({ avatarOverride: true, avatarUrl: null, avatarDimmed: false })
    try {
      await removeAvatar(user, previousUrl)
      if (!mounted.current || gen !== avatarGen.current) return
      window.dispatchEvent(new Event('profileUpdated'))
      commitPreview({ avatarOverride: false, avatarUrl: null, avatarDimmed: false })
      showToast('Photo removed', 'success', null, null, null, { tone: 'neutral' })
    } catch {
      if (!mounted.current || gen !== avatarGen.current) return
      commitPreview({ avatarOverride: false, avatarUrl: null, avatarDimmed: false })
      showToast("Couldn't remove your photo", 'error', null, null, null, { sub: 'Try again' })
    }
  }

  const handleBannerFile = async (file) => {
    if (!file) return
    if (!user?.id) {
      showToast("Couldn't upload your banner", 'error', null, null, null, { sub: 'Try again' })
      return
    }

    const gen = ++bannerGen.current
    const objectUrl = URL.createObjectURL(file)
    const previousUrl = bannerUrl
    commitPreview({ bannerOverride: true, bannerUrl: objectUrl, bannerDimmed: true })

    try {
      const newUrl = await uploadBanner(file, user, previousUrl)
      if (!mounted.current || gen !== bannerGen.current) return
      showToast('Banner updated', 'success', null, null, null, { tone: 'saved' })
      window.dispatchEvent(new Event('profileUpdated'))
      await preloadImage(newUrl)
      if (!mounted.current || gen !== bannerGen.current) return
      commitPreview({ bannerOverride: false, bannerUrl: null, bannerDimmed: false })
    } catch (err) {
      if (!mounted.current || gen !== bannerGen.current) return
      commitPreview({ bannerOverride: false, bannerUrl: null, bannerDimmed: false })
      showToast("Couldn't upload your banner", 'error', null, null, null, {
        sub: err?.message || 'Try again',
      })
    }
  }

  const handleRemoveBanner = async () => {
    if (!bannerUrl || !user?.id) return
    const gen = ++bannerGen.current
    const previousUrl = bannerUrl
    commitPreview({ bannerOverride: true, bannerUrl: null, bannerDimmed: false })
    try {
      await removeBanner(user, previousUrl)
      if (!mounted.current || gen !== bannerGen.current) return
      window.dispatchEvent(new Event('profileUpdated'))
      commitPreview({ bannerOverride: false, bannerUrl: null, bannerDimmed: false })
      showToast('Banner removed', 'success', null, null, null, { tone: 'neutral' })
    } catch {
      if (!mounted.current || gen !== bannerGen.current) return
      commitPreview({ bannerOverride: false, bannerUrl: null, bannerDimmed: false })
      showToast("Couldn't remove your banner", 'error', null, null, null, { sub: 'Try again' })
    }
  }

  const hasPhoto = Boolean(avatarUrl)

  return (
    <>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleAvatarFile(file)
        }}
        style={{ display: 'none' }}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleBannerFile(file)
        }}
        style={{ display: 'none' }}
      />

      <ActionSheet
        isOpen={photoOpen}
        onClose={onPhotoClose}
        title="Profile photo"
        items={[
          {
            label: 'Take Photo',
            icon: <LuCamera size={18} aria-hidden="true" />,
            onClick: () => openPicker(avatarInputRef.current, 'user'),
          },
          {
            label: 'Photo Library',
            icon: <LuImage size={18} aria-hidden="true" />,
            onClick: () => openPicker(avatarInputRef.current, null),
          },
          ...(hasPhoto
            ? [{
                label: 'Remove Photo',
                icon: <LuTrash2 size={18} aria-hidden="true" />,
                destructive: true,
                onClick: () => { void handleRemoveAvatar() },
              }]
            : []),
        ]}
      />

      <ActionSheet
        isOpen={bannerOpen}
        onClose={onBannerClose}
        title="Banner"
        items={[
          {
            label: 'Take Photo',
            icon: <LuCamera size={18} aria-hidden="true" />,
            onClick: () => openPicker(bannerInputRef.current, 'environment'),
          },
          {
            label: 'Photo Library',
            icon: <LuImage size={18} aria-hidden="true" />,
            onClick: () => openPicker(bannerInputRef.current, null),
          },
          ...(bannerUrl
            ? [{
                label: 'Remove Banner',
                icon: <LuTrash2 size={18} aria-hidden="true" />,
                destructive: true,
                onClick: () => { void handleRemoveBanner() },
              }]
            : []),
        ]}
      />
    </>
  )
}

export default ProfilePhotoMenus
