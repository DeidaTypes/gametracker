import React, { useState, useEffect, useRef } from 'react'
import { updateProfile, generateDefaultAvatar } from '../services/profileService'
import './EditProfileModal.css'

function EditProfileModal({ isOpen, onClose, profile, onUpdate }) {
  const [displayName, setDisplayName] = useState(profile?.displayName || '')
  const [username, setUsername] = useState(profile?.username || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [avatar, setAvatar] = useState(profile?.avatar || null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [errors, setErrors] = useState({})
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar)
      setAvatarPreview(profile.avatar?.type === 'data' ? profile.avatar.data : null)
    }
  }, [profile])

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setErrors({ ...errors, avatar: 'Please select an image file' })
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setErrors({ ...errors, avatar: 'Image must be less than 2MB' })
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result
      setAvatar({
        type: 'data',
        data: base64String,
      })
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

    // Validate display name
    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required'
    } else if (displayName.length > 50) {
      newErrors.displayName = 'Display name must be 50 characters or less'
    }

    // Validate username (if provided)
    if (username.trim()) {
      const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/
      if (!usernamePattern.test(username)) {
        newErrors.username = 'Username must be 3-20 characters and contain only letters, numbers, and underscores'
      }
    }

    // Validate bio length
    if (bio.length > 160) {
      newErrors.bio = 'Bio must be 160 characters or less'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Update profile
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
    // Reset form
    if (profile) {
      setDisplayName(profile.displayName || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setAvatar(profile.avatar)
      setAvatarPreview(profile.avatar?.type === 'data' ? profile.avatar.data : null)
    }
    setErrors({})
    onClose()
  }

  // Generate avatar preview
  const getAvatarDisplay = () => {
    if (avatarPreview) {
      return avatarPreview
    }
    if (avatar?.type === 'generated') {
      return null // Will render generated avatar
    }
    return null
  }

  const defaultAvatar = generateDefaultAvatar(displayName || 'User')

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content edit-profile-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Profile</h2>
        <form onSubmit={handleSubmit}>
          {/* Avatar Section */}
          <div className="form-group avatar-group">
            <label>Avatar</label>
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

          {/* Display Name */}
          <div className="form-group">
            <label htmlFor="display-name">Display Name *</label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              maxLength={50}
              required
            />
            {errors.displayName && (
              <div className="error-message">{errors.displayName}</div>
            )}
          </div>

          {/* Username */}
          <div className="form-group">
            <label htmlFor="username">Username (Optional)</label>
            <div className="username-input-container">
              <span className="username-prefix">@</span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="username"
                maxLength={20}
                pattern="[a-zA-Z0-9_]{3,20}"
              />
            </div>
            <p className="form-hint">3-20 characters, letters, numbers, and underscores only</p>
            {errors.username && (
              <div className="error-message">{errors.username}</div>
            )}
          </div>

          {/* Bio */}
          <div className="form-group">
            <label htmlFor="bio">Bio</label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself..."
              rows="4"
              maxLength={160}
            />
            <div className="char-count">{bio.length}/160</div>
            {errors.bio && (
              <div className="error-message">{errors.bio}</div>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
            <button type="submit" className="save-button">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditProfileModal

