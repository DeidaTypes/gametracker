import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateProfile, generateDefaultAvatar } from '../services/profileService'
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
import './CreateListModal.css'
import './EditProfileModal.css'

const DISPLAY_NAME_MAX = 50
const USERNAME_MAX = 20
const BIO_MAX = 160

function EditProfileModal({ isOpen, onClose, profile, onUpdate }) {
  const navigate = useNavigate()
  const { logOut } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.displayName || '')
  const [username, setUsername] = useState(profile?.username || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [avatar, setAvatar] = useState(profile?.avatar || null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [errors, setErrors] = useState({})
  const [loggingOut, setLoggingOut] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar)
      setAvatarPreview(
        profile.avatar?.type === 'data' ? profile.avatar.data : null
      )
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
    </div>
  )
}

export default EditProfileModal
