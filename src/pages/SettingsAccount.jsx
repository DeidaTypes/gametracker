import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import DeleteAccountSheet from '../components/DeleteAccountSheet'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import { deleteAccount } from '../services/deleteAccountService'
import {
  PLUS_PURCHASES_AVAILABLE,
  MANAGE_SUBSCRIPTION_URL,
  restore as restorePlus,
} from '../services/plusService'
import { hapticImpact } from '../utils/haptics'
import './Settings.css'

const RESTORE_MESSAGES = {
  active: ['Checkpoint Plus restored.', 'success'],
  pending: ['Purchase found. Plus will show up in a moment.', 'success'],
  none: ['No Checkpoint Plus purchase found for this Apple ID.', 'error'],
}

function SettingsAccount() {
  const navigate = useNavigate()
  const { logOut, plusActive, plusFinishing } = useAuth()
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

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

  const handleRestore = async () => {
    if (isRestoring || plusFinishing) return
    hapticImpact('Light')
    setIsRestoring(true)
    try {
      const { status } = await restorePlus()
      const [message, tone] = RESTORE_MESSAGES[status] || RESTORE_MESSAGES.none
      showToast(message, tone)
    } catch (err) {
      console.error('[settings] restore purchases failed:', err)
      showToast('Could not restore purchases. Try again.', 'error')
    } finally {
      setIsRestoring(false)
    }
  }

  const plusStatus = plusFinishing ? 'Finishing up\u2026' : plusActive ? 'Plus' : 'Not Plus'

  return (
    <div className="settings-page">
      <SettingsHeader title="Account" />

      <div className="settings-page__body">
        <SettingsGroup>
          <SettingsRow settingId="email" label="Email" onClick={() => navigate('/settings/email')} />
          <SettingsRow settingId="password" label="Password" onClick={() => navigate('/settings/password')} />
        </SettingsGroup>

        {PLUS_PURCHASES_AVAILABLE && (
          <SettingsGroup>
            <SettingsRow settingId="plus-status" label="Checkpoint Plus" value={plusStatus} />
            <SettingsRow
              settingId="plus-restore"
              label={isRestoring ? 'Restoring\u2026' : 'Restore purchases'}
              onClick={handleRestore}
              disabled={isRestoring || plusFinishing}
            />
            {MANAGE_SUBSCRIPTION_URL && (
              <SettingsRow
                settingId="plus-manage"
                label="Manage subscription"
                onClick={() => {
                  window.location.href = MANAGE_SUBSCRIPTION_URL
                }}
              />
            )}
          </SettingsGroup>
        )}

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
