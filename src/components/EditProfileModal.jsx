import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, ChevronRight } from 'lucide-react'
import { FaInstagram, FaXTwitter, FaYoutube, FaTiktok } from 'react-icons/fa6'
import { updateProfile, generateDefaultAvatar } from '../services/profileService'
import { updateUserProfile } from '../services/userService'
import { uploadBanner, removeBanner, uploadAvatar, removeAvatar } from '../services/storageService'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from './Toast'
import { AUTH_ERRORS } from '../services/auth'
import ActionSheet from './ActionSheet'
import FavoritesPickerSheet from './FavoritesPickerSheet'
import BioEditModal from './BioEditModal'
import './EditProfileModal.css'

const AVATAR_MAX_FILE_MB = 10
const AVATAR_MAX_PX = 1200
const AVATAR_QUALITY = 0.85

/**
 * Compress an image File/Blob to at most AVATAR_MAX_PX × AVATAR_MAX_PX at
 * AVATAR_QUALITY. Returns a Promise<Blob> (image/jpeg). Falls back to the
 * original file if the Canvas API is unavailable (SSR / very old browser).
 */
async function compressImage(file) {
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

const DISPLAY_NAME_MAX = 50
const USERNAME_MAX = 20
const BIO_MAX = 160
const HANDLE_MAX = 30

function normalizeHandle(input) {
  return (input || '').trim().replace(/^@+/, '')
}

function EditProfileModal({ isOpen, onClose, profile, onUpdate }) {
  const navigate = useNavigate()
  const { logOut, user } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.displayName || '')
  const [username, setUsername] = useState(profile?.username || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [avatar, setAvatar] = useState(profile?.avatar || null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [bannerUrl, setBannerUrl] = useState(profile?.bannerUrl || null)
  const [bannerPreview, setBannerPreview] = useState(null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [instagramHandle, setInstagramHandle] = useState(profile?.instagramHandle || '')
  const [xHandle, setXHandle] = useState(profile?.xHandle || '')
  const [youtubeHandle, setYoutubeHandle] = useState(profile?.youtubeHandle || '')
  const [tiktokHandle, setTiktokHandle] = useState(profile?.tiktokHandle || '')
  const [favoriteGames, setFavoriteGames] = useState(profile?.favoriteGames || [])

  // Sheet / overlay states
  const [pickerOpen, setPickerOpen] = useState(false)
  const [bannerSheetOpen, setBannerSheetOpen] = useState(false)
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
  const [signOutSheetOpen, setSignOutSheetOpen] = useState(false)
  const [bioSheetOpen, setBioSheetOpen] = useState(false)

  // Inline focus tracking for character counters
  const [focusedField, setFocusedField] = useState(null)

  const [errors, setErrors] = useState({})
  const [loggingOut, setLoggingOut] = useState(false)
  const [saving, setSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Track the pending avatar file and its preview URL. The actual upload to
  // Supabase Storage happens at save time (not immediately on file pick) so
  // the user can cancel without orphaning a storage object.
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null)

  const fileInputRef = useRef(null)
  const bannerFileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar || null)
      setAvatarPreview(
        profile.avatar?.type === 'url'
          ? profile.avatar.data
          : profile.avatar?.type === 'data'
          ? profile.avatar.data
          : null
      )
      setBannerUrl(profile.bannerUrl || null)
      setBannerPreview(null)
      setInstagramHandle(profile.instagramHandle || '')
      setXHandle(profile.xHandle || '')
      setYoutubeHandle(profile.youtubeHandle || '')
      setTiktokHandle(profile.tiktokHandle || '')
      setFavoriteGames(profile.favoriteGames || [])
      setPendingAvatarFile(null)
      setErrors({})
    }
  }, [profile])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  // isDirty: Save button is enabled only when at least one field has changed
  const isDirty = useMemo(() => {
    const p = profile || {}
    if (displayName !== (p.displayName || '')) return true
    if (username !== (p.username || '')) return true
    if (bio !== (p.bio || '')) return true
    if (pendingAvatarFile != null) return true
    if (avatar === null && p.avatar != null) return true
    if (instagramHandle !== (p.instagramHandle || '')) return true
    if (xHandle !== (p.xHandle || '')) return true
    if (youtubeHandle !== (p.youtubeHandle || '')) return true
    if (tiktokHandle !== (p.tiktokHandle || '')) return true
    const curIds = favoriteGames.map((g) => String(g.id)).join(',')
    const origIds = (p.favoriteGames || []).map((g) => String(g.id)).join(',')
    if (curIds !== origIds) return true
    return false
  }, [profile, displayName, username, bio, avatar, pendingAvatarFile, instagramHandle, xHandle, youtubeHandle, tiktokHandle, favoriteGames])

  /* ── Avatar ──────────────────────────────────────────────────── */

  const handleAvatarPhotoLibrary = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  const handleAvatarTakePhoto = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'user')
      fileInputRef.current.click()
    }
  }

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error')
      return
    }
    if (file.size > AVATAR_MAX_FILE_MB * 1024 * 1024) {
      showToast(`Image must be less than ${AVATAR_MAX_FILE_MB}MB`, 'error')
      return
    }
    setAvatarUploading(true)
    try {
      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)
      setPendingAvatarFile(compressed)
      // Revoke any previous preview URL to avoid memory leaks.
      setAvatarPreview((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return previewUrl
      })
      setAvatar({ type: 'pending' })
    } catch {
      showToast('Could not process image. Try another file.', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleRemoveAvatar = () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    setAvatar(null)
    setAvatarPreview(null)
    setPendingAvatarFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const avatarSrc = avatarPreview || null

  /* ── Banner ──────────────────────────────────────────────────── */

  const handleBannerPhotoLibrary = () => {
    if (bannerFileInputRef.current) {
      bannerFileInputRef.current.removeAttribute('capture')
      bannerFileInputRef.current.click()
    }
  }

  const handleBannerTakePhoto = () => {
    if (bannerFileInputRef.current) {
      bannerFileInputRef.current.setAttribute('capture', 'environment')
      bannerFileInputRef.current.click()
    }
  }

  const handleBannerChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (bannerFileInputRef.current) bannerFileInputRef.current.value = ''

    const reader = new FileReader()
    reader.onloadend = () => setBannerPreview(reader.result)
    reader.readAsDataURL(file)

    const previousUrl = bannerUrl
    setBannerUploading(true)
    try {
      const newUrl = await uploadBanner(file, user, previousUrl)
      setBannerUrl(newUrl)
      setBannerPreview(null)
      window.dispatchEvent(new Event('profileUpdated'))
    } catch (err) {
      showToast(err?.message || 'Failed to upload banner. Try again.', 'error')
      setBannerPreview(null)
    } finally {
      setBannerUploading(false)
    }
  }

  const handleRemoveBanner = async () => {
    const previousUrl = bannerUrl
    setBannerUrl(null)
    setBannerPreview(null)
    try {
      await removeBanner(user, previousUrl)
      window.dispatchEvent(new Event('profileUpdated'))
    } catch {
      showToast('Failed to remove banner. Try again.', 'error')
      setBannerUrl(previousUrl)
    }
  }

  /* ── Submit ──────────────────────────────────────────────────── */

  const handleSubmit = async () => {
    if (saving || avatarUploading) return
    const newErrors = {}

    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required'
    } else if (displayName.length > DISPLAY_NAME_MAX) {
      newErrors.displayName = `Display name must be ${DISPLAY_NAME_MAX} characters or less`
    }

    if (username.trim()) {
      const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/
      if (!usernamePattern.test(username)) {
        newErrors.username = 'Username must be 3–20 characters (letters, numbers, underscores)'
      }
    }

    if (bio.length > BIO_MAX) {
      newErrors.bio = `Bio must be ${BIO_MAX} characters or less`
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const trimmedName = displayName.trim()
    const trimmedUsername = username.trim() || null

    setSaving(true)

    // Upload a pending avatar to Supabase Storage first so we have the URL
    // before we write the Supabase row.
    let resolvedAvatarUrl = profile?.avatarUrl || null
    let resolvedAvatar = avatar
    if (pendingAvatarFile && user?.id) {
      try {
        const newUrl = await uploadAvatar(
          pendingAvatarFile,
          user,
          profile?.avatarUrl || null
        )
        resolvedAvatarUrl = newUrl
        resolvedAvatar = { type: 'url', data: newUrl }
        setPendingAvatarFile(null)
        if (avatarPreview && avatarPreview.startsWith('blob:')) {
          URL.revokeObjectURL(avatarPreview)
          setAvatarPreview(newUrl)
        }
      } catch (uploadErr) {
        setSaving(false)
        showToast(uploadErr?.message || 'Failed to upload photo. Try again.', 'error')
        return
      }
    } else if (avatar === null && profile?.avatarUrl) {
      // User explicitly removed avatar.
      try {
        await removeAvatar(user, profile.avatarUrl)
        resolvedAvatarUrl = null
        resolvedAvatar = null
      } catch {
        // Non-fatal — local state will clear regardless.
      }
    }

    // Persist all editable fields to Supabase in a single update so bio,
    // avatar_url, display_name, and username are all authoritative server-side.
    try {
      if (user?.id) {
        await updateUserProfile(user.id, {
          displayName: trimmedName,
          username: trimmedUsername,
          bio: bio.trim(),
          avatarUrl: resolvedAvatarUrl,
          favoriteGames,
        })
      }
    } catch (err) {
      setSaving(false)
      if (err?.code === AUTH_ERRORS.USERNAME_TAKEN) {
        setErrors({ username: 'That username is already taken' })
        return
      }
      if (err?.code === AUTH_ERRORS.USERNAME_INVALID) {
        setErrors({ username: err.message })
        return
      }
      // Network / unknown — still write locally so the user's own device
      // reflects the change.
      showToast("Saved locally. Couldn't sync to the server — try again later.", 'error')
    }

    const updated = updateProfile({
      displayName: trimmedName,
      username: trimmedUsername,
      bio: bio.trim(),
      avatar: resolvedAvatar,
      avatarUrl: resolvedAvatarUrl,
      bannerUrl,
      instagramHandle: normalizeHandle(instagramHandle),
      xHandle: normalizeHandle(xHandle),
      youtubeHandle: normalizeHandle(youtubeHandle),
      tiktokHandle: normalizeHandle(tiktokHandle),
      favoriteGames,
    })

    setSaving(false)
    showToast('Profile saved', 'success')
    onUpdate(updated)
    onClose()
  }

  const handleCancel = () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar || null)
      setAvatarPreview(
        profile.avatar?.type === 'url'
          ? profile.avatar.data
          : profile.avatar?.type === 'data'
          ? profile.avatar.data
          : null
      )
      setBannerUrl(profile.bannerUrl || null)
      setBannerPreview(null)
      setInstagramHandle(profile.instagramHandle || '')
      setXHandle(profile.xHandle || '')
      setYoutubeHandle(profile.youtubeHandle || '')
      setTiktokHandle(profile.tiktokHandle || '')
      setFavoriteGames(profile.favoriteGames || [])
    }
    setPendingAvatarFile(null)
    setErrors({})
    onClose()
  }

  const handleLogOut = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logOut()
      onClose()
      navigate('/login', { replace: true })
    } catch (err) {
      const code = err?.code
      if (code === AUTH_ERRORS.NETWORK) {
        showToast("Couldn't reach the server. Check your connection.", 'error')
      } else {
        showToast(err?.message || 'Failed to log out. Try again.', 'error')
      }
    } finally {
      setLoggingOut(false)
    }
  }

  const defaultAvatar = generateDefaultAvatar(displayName || 'User')
  const bannerSrc = bannerPreview || bannerUrl

  if (!isOpen) return null

  return (
    <>
      <div className="ep-overlay" onClick={handleCancel}>
        <div className="ep-sheet" onClick={(e) => e.stopPropagation()}>

          {/* ── Top bar ─────────────────────────────────────────── */}
          <div className="ep-topbar">
            <button
              type="button"
              className="ep-topbar__btn ep-topbar__btn--cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <h1 className="ep-topbar__title">Edit Profile</h1>
            <button
              type="button"
              className="ep-topbar__btn ep-topbar__btn--save"
              onClick={handleSubmit}
              disabled={!isDirty || saving || avatarUploading}
            >
              {avatarUploading ? 'Optimizing…' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {/* ── Scrollable body ─────────────────────────────────── */}
          <div className="ep-scroll-body">

            {/* ── Banner + avatar hero ──────────────────────────── */}
            <div className="ep-hero">
              <div
                className="ep-banner"
                style={bannerSrc ? { backgroundImage: `url(${bannerSrc})` } : undefined}
              >
                {bannerUploading && (
                  <div className="ep-banner__spinner-overlay" aria-hidden="true">
                    <div className="ep-banner__spinner" />
                  </div>
                )}
                <button
                  type="button"
                  className="ep-change-btn ep-change-btn--banner"
                  onClick={() => setBannerSheetOpen(true)}
                  aria-label="Change banner"
                >
                  <Pencil size={14} strokeWidth={2} />
                </button>
              </div>

              <div className="ep-avatar-wrap">
                <div className="ep-avatar">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="" className="ep-avatar__img" />
                  ) : (
                    <div
                      className="ep-avatar__fallback"
                      style={{ backgroundColor: defaultAvatar.color }}
                    >
                      {defaultAvatar.initials}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="ep-change-btn ep-change-btn--avatar"
                  onClick={() => setAvatarSheetOpen(true)}
                  aria-label="Change avatar"
                >
                  <Pencil size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* ── Form groups ──────────────────────────────────── */}
            <div className="ep-groups">

              {/* PROFILE section */}
              <div className="ep-group">
                <p className="ep-group__label">Profile</p>
                <div className="ep-section">

                  {/* Name */}
                  <div className={`ep-row${errors.displayName ? ' ep-row--error' : ''}`}>
                    <label htmlFor="ep-name" className="ep-row__field-label">Name</label>
                    <div className="ep-row__right">
                      <input
                        id="ep-name"
                        className="ep-row__input"
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value)
                          if (errors.displayName) setErrors({ ...errors, displayName: null })
                        }}
                        onFocus={() => setFocusedField('displayName')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Your name"
                        maxLength={DISPLAY_NAME_MAX}
                      />
                      {focusedField === 'displayName' && (
                        <span className="ep-counter">{displayName.length}/{DISPLAY_NAME_MAX}</span>
                      )}
                    </div>
                  </div>

                  <div className="ep-row-divider" />

                  {/* Username */}
                  <div className={`ep-row${errors.username ? ' ep-row--error' : ''}`}>
                    <label htmlFor="ep-username" className="ep-row__field-label">Username</label>
                    <div className="ep-row__right ep-row__right--prefix">
                      <span className="ep-row__prefix">@</span>
                      <input
                        id="ep-username"
                        className="ep-row__input"
                        value={username}
                        onChange={(e) => {
                          setUsername(
                            e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                          )
                          if (errors.username) setErrors({ ...errors, username: null })
                        }}
                        onFocus={() => setFocusedField('username')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="username"
                        maxLength={USERNAME_MAX}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {focusedField === 'username' && (
                        <span className="ep-counter">{username.length}/{USERNAME_MAX}</span>
                      )}
                    </div>
                  </div>

                  <div className="ep-row-divider" />

                  {/* Bio — tappable preview */}
                  <button
                    type="button"
                    className="ep-row ep-row--tappable"
                    onClick={() => setBioSheetOpen(true)}
                  >
                    <span className="ep-row__field-label">Bio</span>
                    <span className={`ep-row__bio-preview${!bio ? ' ep-row__bio-preview--empty' : ''}`}>
                      {bio || 'Add a bio…'}
                    </span>
                  </button>

                </div>
              </div>

              {/* SOCIAL section */}
              <div className="ep-group">
                <p className="ep-group__label">Social</p>
                <div className="ep-section">

                  <div className="ep-row">
                    <FaInstagram className="ep-row__icon" aria-hidden="true" />
                    <div className="ep-row__right">
                      <input
                        className="ep-row__input"
                        value={instagramHandle}
                        onChange={(e) => setInstagramHandle(e.target.value.replace(/^@+/, ''))}
                        onFocus={() => setFocusedField('instagram')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="handle"
                        maxLength={HANDLE_MAX}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {focusedField === 'instagram' && (
                        <span className="ep-counter">{instagramHandle.length}/{HANDLE_MAX}</span>
                      )}
                    </div>
                  </div>

                  <div className="ep-row-divider" />

                  <div className="ep-row">
                    <FaXTwitter className="ep-row__icon" aria-hidden="true" />
                    <div className="ep-row__right">
                      <input
                        className="ep-row__input"
                        value={xHandle}
                        onChange={(e) => setXHandle(e.target.value.replace(/^@+/, ''))}
                        onFocus={() => setFocusedField('x')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="handle"
                        maxLength={HANDLE_MAX}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {focusedField === 'x' && (
                        <span className="ep-counter">{xHandle.length}/{HANDLE_MAX}</span>
                      )}
                    </div>
                  </div>

                  <div className="ep-row-divider" />

                  <div className="ep-row">
                    <FaYoutube className="ep-row__icon" aria-hidden="true" />
                    <div className="ep-row__right">
                      <input
                        className="ep-row__input"
                        value={youtubeHandle}
                        onChange={(e) => setYoutubeHandle(e.target.value.replace(/^@+/, ''))}
                        onFocus={() => setFocusedField('youtube')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="handle"
                        maxLength={HANDLE_MAX}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {focusedField === 'youtube' && (
                        <span className="ep-counter">{youtubeHandle.length}/{HANDLE_MAX}</span>
                      )}
                    </div>
                  </div>

                  <div className="ep-row-divider" />

                  <div className="ep-row">
                    <FaTiktok className="ep-row__icon" aria-hidden="true" />
                    <div className="ep-row__right">
                      <input
                        className="ep-row__input"
                        value={tiktokHandle}
                        onChange={(e) => setTiktokHandle(e.target.value.replace(/^@+/, ''))}
                        onFocus={() => setFocusedField('tiktok')}
                        onBlur={() => setFocusedField(null)}
                        placeholder="handle"
                        maxLength={HANDLE_MAX}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      {focusedField === 'tiktok' && (
                        <span className="ep-counter">{tiktokHandle.length}/{HANDLE_MAX}</span>
                      )}
                    </div>
                  </div>

                </div>
                <p className="ep-group__footnote">Just handles — no @.</p>
              </div>

              {/* FAVORITES section */}
              <div className="ep-group">
                <p className="ep-group__label">Favorites</p>
                <div className="ep-section">
                  <button
                    type="button"
                    className="ep-row ep-row--tappable ep-row--nav"
                    onClick={() => setPickerOpen(true)}
                  >
                    <span className="ep-row__field-label">Favorite games</span>
                    <span className="ep-row__meta">{favoriteGames.length}/4</span>
                    <ChevronRight size={16} className="ep-row__chevron" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* ACCOUNT section */}
              <div className="ep-group">
                <p className="ep-group__label">Account</p>
                <div className="ep-section">
                  <button
                    type="button"
                    className="ep-row ep-row--destructive"
                    onClick={() => setSignOutSheetOpen(true)}
                    disabled={loggingOut}
                  >
                    <span className="ep-row__destructive-label">
                      {loggingOut ? 'Signing out…' : 'Sign out'}
                    </span>
                  </button>
                </div>
              </div>

            </div>{/* /ep-groups */}
          </div>{/* /ep-scroll-body */}

        </div>{/* /ep-sheet */}
      </div>{/* /ep-overlay */}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarChange}
        style={{ display: 'none' }}
      />
      <input
        ref={bannerFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleBannerChange}
        style={{ display: 'none' }}
      />

      {/* ── Bio modal ──────────────────────────────────────────── */}
      <BioEditModal
        isOpen={bioSheetOpen}
        onClose={() => setBioSheetOpen(false)}
        currentBio={bio}
        onSave={(updatedProfile) => setBio(updatedProfile.bio || '')}
      />

      {/* ── Banner action sheet ────────────────────────────────── */}
      <ActionSheet
        isOpen={bannerSheetOpen}
        onClose={() => setBannerSheetOpen(false)}
        title="Change Banner"
        items={[
          { label: 'Photo Library', onClick: handleBannerPhotoLibrary },
          { label: 'Take Photo', onClick: handleBannerTakePhoto },
          ...(bannerUrl
            ? [{ label: 'Remove Banner', onClick: handleRemoveBanner, destructive: true }]
            : []),
        ]}
      />

      {/* ── Avatar action sheet ────────────────────────────────── */}
      <ActionSheet
        isOpen={avatarSheetOpen}
        onClose={() => setAvatarSheetOpen(false)}
        title="Change Photo"
        items={[
          { label: 'Photo Library', onClick: handleAvatarPhotoLibrary },
          { label: 'Take Photo', onClick: handleAvatarTakePhoto },
          ...(avatarPreview
            ? [{ label: 'Remove Photo', onClick: handleRemoveAvatar, destructive: true }]
            : []),
        ]}
      />

      {/* ── Sign-out confirm action sheet ─────────────────────── */}
      <ActionSheet
        isOpen={signOutSheetOpen}
        onClose={() => setSignOutSheetOpen(false)}
        title="Sign out of GameTracker?"
        items={[
          { label: 'Sign out', onClick: handleLogOut, destructive: true },
        ]}
      />

      {/* ── Favorites picker sheet ────────────────────────────── */}
      <FavoritesPickerSheet
        isOpen={pickerOpen}
        initialFavorites={favoriteGames}
        onSave={(games) => setFavoriteGames(games)}
        onClose={() => setPickerOpen(false)}
      />
    </>
  )
}

export default EditProfileModal
