import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import DeleteAccountSheet from '../components/DeleteAccountSheet'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import { deleteAccount } from '../services/deleteAccountService'
import { hapticImpact } from '../utils/haptics'
import './Settings.css'

function SettingsAccount() {
  const navigate = useNavigate()
  const { logOut } = useAuth()
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteAccount = async (reason) => {
    if (isDeleting) return
    hapticImpact('Medium')
    setIsDeleting(true)
    try {
      await deleteAccount(reason)
      await logOut().catch(() => {})
      setDeleteSheetOpen(false)
      navigate('/login', { replace: true, state: { accountDeleted: true } })
    } catch (err) {
      console.error('[settings] delete-account failed:', err)
      showToast(err?.message || 'Could not delete account. Try again.', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Account" />

      <div className="settings-page__body">
        <SettingsGroup>
          <SettingsRow settingId="email" label="Email" onClick={() => navigate('/settings/email')} />
          <SettingsRow settingId="password" label="Password" onClick={() => navigate('/settings/password')} />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            settingId="delete-account"
            label="Delete account"
            onClick={() => setDeleteSheetOpen(true)}
            destructive
          />
        </SettingsGroup>
      </div>

      <DeleteAccountSheet
        isOpen={deleteSheetOpen}
        onClose={() => !isDeleting && setDeleteSheetOpen(false)}
        onConfirm={handleDeleteAccount}
        isDeleting={isDeleting}
      />
    </div>
  )
}

export default SettingsAccount
