import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LuUserPen,
  LuShare2,
  LuSparkles,
  LuStar,
  LuSettings,
} from 'react-icons/lu'
import MenuSheet from './MenuSheet'

/**
 * SettingsSheet — the signed-in user's own profile "⋯" sheet.
 * Four rows (five when `onGetPlus` is passed), and the only door into Settings:
 *   Edit profile  — opens EditProfileModal in place
 *   Share profile — existing share handler
 *   Your Wrapped  — existing wrapped handler
 *   Get Plus      — only for a non-Plus user when Plus is available
 *   Settings      — navigate('/settings'), the hub at the top
 * Settings is the only row with a chevron. The visitor overflow sheet
 * is a separate ActionSheet and is not this component.
 *
 * A thin wrapper: the look and motion live in MenuSheet, which the list
 * page's "⋯" menu shares.
 */
function SettingsSheet({
  isOpen,
  onClose,
  onEditProfile,
  onShareProfile,
  onWrapped,
  onGetPlus,
  wrappedLabel = 'Your Wrapped',
  wrappedDisabled = false,
}) {
  const navigate = useNavigate()

  const items = [
    { icon: <LuUserPen size={18} />, label: 'Edit profile', onClick: onEditProfile },
    { icon: <LuShare2 size={18} />, label: 'Share profile', onClick: onShareProfile },
    {
      icon: <LuSparkles size={18} />,
      label: wrappedLabel,
      onClick: onWrapped,
      disabled: wrappedDisabled,
    },
    ...(onGetPlus
      ? [{ icon: <LuStar size={18} />, label: 'Get Plus', onClick: onGetPlus }]
      : []),
    {
      icon: <LuSettings size={18} />,
      label: 'Settings',
      chevron: true,
      onClick: () => navigate('/settings'),
    },
  ]

  return (
    <MenuSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Profile actions"
      items={items}
    />
  )
}

export default SettingsSheet
