import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateProfile, generateDefaultAvatar } from '../services/profileService'
import { uploadBanner, removeBanner } from '../services/storageService'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from './Toast'
import { AUTH_ERRORS } from '../services/auth'
import {
  TextField,
  TextArea,
  SubmitButton,
  SecondaryButton,
  DestructiveButton,
} from './forms'
import FavoriteGamesPicker from './FavoriteGamesPicker'
import './CreateListModal.css'
import './EditProfileModal.css'

const DISPLAY_NAME_MAX = 50
const USERNAME_MAX = 20
const BIO_MAX = 160
const HANDLE_MAX = 30

// Strip a leading '@' and any whitespace so what we persist is always the
// raw handle. The '@' is added at display time only.
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
  // Banner: bannerUrl is the persisted public URL; bannerPreview is the
  // ephemeral FileReader data-URL shown immediately after the user picks a
  // file (before the upload finishes).
  const [bannerUrl, setBannerUrl] = useState(profile?.bannerUrl || null)
  const [bannerPreview, setBannerPreview] = useState(null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [instagramHandle, setInstagramHandle] = useState(profile?.instagramHandle || '')
  const [xHandle, setXHandle] = useState(profile?.xHandle || '')
  const [youtubeHandle, setYoutubeHandle] = useState(profile?.youtubeHandle || '')
  const [tiktokHandle, setTiktokHandle] = useState(profile?.tiktokHandle || '')
  const [favoriteGames, setFavoriteGames] = useState(profile?.favoriteGames || [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [errors, setErrors] = useState({})
  const [loggingOut, setLoggingOut] = useState(false)
  const fileInputRef = useRef(null)
  const bannerFileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar)
      setAvatarPreview(
        profile.avatar?.type === 'data' ? profile.avatar.data : null
      )
      setBannerUrl(profile.bannerUrl || null)
      setBannerPreview(null)
      setInstagramHandle(profile.instagramHandle || '')
      setXHandle(profile.xHandle || '')
      setYoutubeHandle(profile.youtubeHandle || '')
      setTiktokHandle(profile.tiktokHandle || '')
      setFavoriteGames(profile.favoriteGames || [])
    }
  }, [profile])

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrors({ ...errors, avatar: 'Please select an image file' })
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrors({ ...errors, avatar: 'Image must be less than 2MB' })
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result
      setAvatar({ type: 'data', data: base64String })
      setAvatarPreview(base64String)
      setErrors({ ...errors, avatar: null })
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveAvatar = () => {
    setAvatar(null)
    setAvatarPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  /* ── Banner upload / remove ─────────────────────────────────── */

  const handleBannerClick = () => {
    if (!bannerUploading) bannerFileInputRef.current?.click()
  }

  const handleBannerChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so selecting the same file again fires a change event
    if (bannerFileInputRef.current) bannerFileInputRef.current.value = ''

    // Show immediate preview via FileReader
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

  const handleSubmit = (e) => {
    e.preventDefault()
    const newErrors = {}

    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required'
    } else if (displayName.length > DISPLAY_NAME_MAX) {
      newErrors.displayName = `Display name must be ${DISPLAY_NAME_MAX} characters or less`
    }

    if (username.trim()) {
      const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/
      if (!usernamePattern.test(username)) {
        newErrors.username =
          'Username must be 3–20 characters and contain only letters, numbers, and underscores'
      }
    }

    if (bio.length > BIO_MAX) {
      newErrors.bio = `Bio must be ${BIO_MAX} characters or less`
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const updated = updateProfile({
      displayName: displayName.trim(),
      username: username.trim() || null,
      bio: bio.trim(),
      avatar: avatar,
      bannerUrl: bannerUrl,
      instagramHandle: normalizeHandle(instagramHandle),
      xHandle: normalizeHandle(xHandle),
      youtubeHandle: normalizeHandle(youtubeHandle),
      tiktokHandle: normalizeHandle(tiktokHandle),
      favoriteGames,
    })

    onUpdate(updated)
    onClose()
  }

  const handleCancel = () => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar)
      setAvatarPreview(
        profile.avatar?.type === 'data' ? profile.avatar.data : null
      )
      setBannerUrl(profile.bannerUrl || null)
      setBannerPreview(null)
      setInstagramHandle(profile.instagramHandle || '')
      setXHandle(profile.xHandle || '')
      setYoutubeHandle(profile.youtubeHandle || '')
      setTiktokHandle(profile.tiktokHandle || '')
      setFavoriteGames(profile.favoriteGames || [])
    }
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
        showToast(
          "Couldn't reach the server. Check your connection.",
          'error'
        )
      } else {
        showToast(err?.message || 'Failed to log out. Try again.', 'error')
      }
    } finally {
      setLoggingOut(false)
    }
  }

  const getAvatarDisplay = () => {
    if (avatarPreview) return avatarPreview
    return null
  }

  const defaultAvatar = generateDefaultAvatar(displayName || 'User')

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div
        className="modal-content edit-profile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Edit Profile</h2>
        <form onSubmit={handleSubmit} className="edit-profile-form">
          {/* ── Banner upload (Sprint 7) — positioned above avatar ──── */}
          <div className="banner-group">
            <span className="banner-group__label">Profile Banner</span>
            <div className="banner-upload-area">
              <div
                className="banner-preview-container"
                onClick={handleBannerClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleBannerClick()}
                aria-label="Upload banner image"
              >
                {bannerPreview || bannerUrl ? (
                  <img
                    src={bannerPreview || bannerUrl}
                    alt="Banner preview"
                    className="banner-preview-image"
                  />
                ) : (
                  <div className="banner-placeholder">
                    <span className="banner-placeholder__icon" aria-hidden="true">＋</span>
                    <span className="banner-placeholder__text">Upload banner</span>
                  </div>
                )}
                {bannerUploading && (
                  <div className="banner-spinner-overlay" aria-hidden="true">
                    <div className="banner-spinner" />
                  </div>
                )}
                {!bannerUploading && (bannerPreview || bannerUrl) && (
                  <div className="banner-change-overlay">
                    <span className="banner-change-text">Change</span>
                  </div>
                )}
              </div>
              <div className="banner-actions">
                <button
                  type="button"
                  className="banner-upload-btn"
                  onClick={handleBannerClick}
                  disabled={bannerUploading}
                >
                  {bannerUploading ? 'Uploading…' : 'Upload banner'}
                </button>
                {bannerUrl && !bannerUploading && (
                  <button
                    type="button"
                    className="banner-remove-btn"
                    onClick={handleRemoveBanner}
                  >
                    Remove banner
                  </button>
                )}
              </div>
              <input
                ref={bannerFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleBannerChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="avatar-group">
            <span className="avatar-group__label">Avatar</span>
            <div className="avatar-upload-container">
              <div
                className="avatar-preview-container"
                onClick={handleAvatarClick}
              >
                {getAvatarDisplay() ? (
                  <img
                    src={getAvatarDisplay()}
                    alt="Avatar preview"
                    className="avatar-preview-image"
                  />
                ) : (
                  <div
                    className="avatar-generated"
                    style={{ backgroundColor: defaultAvatar.color }}
                  >
                    {defaultAvatar.initials}
                  </div>
                )}
                <div className="avatar-overlay">
                  <span className="avatar-change-text">Change</span>
                </div>
              </div>
              {avatarPreview && (
                <button
                  type="button"
                  className="remove-avatar-button"
                  onClick={handleRemoveAvatar}
                >
                  Remove
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
              />
            </div>
            {errors.avatar && (
              <div className="error-message">{errors.avatar}</div>
            )}
          </div>

          <TextField
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your display name"
            maxLength={DISPLAY_NAME_MAX}
            required
          />
          {errors.displayName && (
            <div className="error-message">{errors.displayName}</div>
          )}

          <TextField
            label="Username"
            value={username}
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
            }
            placeholder="username"
            maxLength={USERNAME_MAX}
            hint="3–20 characters, letters, numbers, and underscores only"
          />
          {errors.username && (
            <div className="error-message">{errors.username}</div>
          )}

          <TextArea
            label="Bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself..."
            maxLength={BIO_MAX}
          />
          {errors.bio && <div className="error-message">{errors.bio}</div>}

          {/* ── Social handles (Sprint 5)
              Stored raw without leading '@'. The '@' is added at display
              time only. We strip it here too in case the user types it. */}
          <fieldset className="edit-profile-socials">
            <legend className="edit-profile-socials__legend">Social</legend>

            <TextField
              label="Instagram"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value.replace(/^@+/, ''))}
              placeholder="handle"
              maxLength={HANDLE_MAX}
              hint="Your Instagram handle (no @)"
            />

            <TextField
              label="X"
              value={xHandle}
              onChange={(e) => setXHandle(e.target.value.replace(/^@+/, ''))}
              placeholder="handle"
              maxLength={HANDLE_MAX}
              hint="Your X handle (no @)"
            />

            <TextField
              label="YouTube"
              value={youtubeHandle}
              onChange={(e) => setYoutubeHandle(e.target.value.replace(/^@+/, ''))}
              placeholder="handle"
              maxLength={HANDLE_MAX}
              hint="Your YouTube channel handle (no @)"
            />

            <TextField
              label="TikTok"
              value={tiktokHandle}
              onChange={(e) => setTiktokHandle(e.target.value.replace(/^@+/, ''))}
              placeholder="handle"
              maxLength={HANDLE_MAX}
              hint="Your TikTok handle (no @)"
            />
          </fieldset>

          {/* ── Favorite Games picker (Sprint 5)
              Up to 4 games from the user's library, surfaced on the
              Profile Home tab. We render a tiny preview strip so the
              user can see what they've got selected without re-opening
              the picker. */}
          <div className="edit-profile-favs">
            <div className="edit-profile-favs__header">
              <span className="edit-profile-favs__label">Favorite Games</span>
              <SecondaryButton
                onClick={() => setPickerOpen(true)}
                className="edit-profile-favs__btn"
              >
                {favoriteGames.length > 0 ? 'Change' : 'Pick games'}
              </SecondaryButton>
            </div>
            {favoriteGames.length === 0 ? (
              <p className="edit-profile-favs__empty">
                Pick up to 4 games from your library to feature on your
                Profile.
              </p>
            ) : (
              <div className="edit-profile-favs__strip">
                {favoriteGames.map((g) => (
                  <div key={g.id} className="edit-profile-favs__cover">
                    {g.image ? (
                      <img src={g.image} alt="" loading="lazy" />
                    ) : (
                      <span>{g.title?.charAt(0) || '?'}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-actions">
            <SecondaryButton onClick={handleCancel}>Cancel</SecondaryButton>
            <SubmitButton type="submit">Save Changes</SubmitButton>
          </div>

          <div className="edit-profile-logout">
            <DestructiveButton
              type="button"
              onClick={handleLogOut}
              disabled={loggingOut}
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </DestructiveButton>
          </div>
        </form>
      </div>

      <FavoriteGamesPicker
        isOpen={pickerOpen}
        initialSelected={favoriteGames}
        onSave={(games) => setFavoriteGames(games)}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}

export default EditProfileModal
