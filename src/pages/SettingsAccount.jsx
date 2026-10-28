import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import DeleteAccountSheet from '../components/DeleteAccountSheet'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import { deleteAccount } from '../services/deleteAccountService'
import { PRIVACY_URL, TERMS_URL } from '../config/site'
import { exportMyData } from '../services/exportService'
import PlusBadge from '../components/PlusBadge'
import {
  PLUS_ENABLED,
  PLUS_PURCHASES_AVAILABLE,
  MANAGE_SUBSCRIPTION_URL,
  restore as restorePlus,
} from '../services/plusService'
import { hapticImpact } from '../utils/haptics'
import './Settings.css'

// [title, type, second line]
const RESTORE_MESSAGES = {
  active: ['Checkpoint Plus restored', 'success', null],
  pending: ['Purchase found', 'success', 'Plus will show up in a moment'],
  none: ['No Plus purchase found', 'error', 'Nothing found for this Apple ID'],
}

function SettingsAccount() {
  const navigate = useNavigate()
  const { logOut, plusActive, plusFinishing } = useAuth()
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

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
      showToast("Couldn't delete account", 'error', null, null, null, { sub: err?.message || 'Try again' })
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
      const [message, type, sub] = RESTORE_MESSAGES[status] || RESTORE_MESSAGES.none
      showToast(message, type, null, null, null, {
        sub,
        tone: type === 'success' ? 'saved' : undefined,
      })
    } catch (err) {
      console.error('[settings] restore purchases failed:', err)
      showToast("Couldn't restore purchases", 'error', null, null, null, { sub: 'Try again' })
    } finally {
      setIsRestoring(false)
    }
  }

  const handleExport = async () => {
    if (isExporting) return
    hapticImpact('Light')
    setIsExporting(true)
    try {
      const { status } = await exportMyData()
      if (status === 'shared') showToast('Your data is ready', 'success', null, null, 'download')
      else if (status === 'downloaded') showToast('Your data was downloaded', 'success', null, null, 'download')
    } catch (err) {
      console.error('[settings] export failed:', err)
      showToast("Couldn't export your data", 'error', null, null, null, { sub: err?.message || 'Try again' })
    } finally {
      setIsExporting(false)
    }
  }

  // Plus stays hidden until RevenueCat and the Terms / Privacy links exist.
  const plusVisible = PLUS_ENABLED && Boolean(TERMS_URL && PRIVACY_URL)
  const purchasesVisible = plusVisible && PLUS_PURCHASES_AVAILABLE
  const exportVisible = plusVisible && (plusActive || PLUS_PURCHASES_AVAILABLE)

  const plusStatus = plusFinishing ? 'Finishing up\u2026' : plusActive ? 'Plus' : 'Not Plus'

  return (
    <div className="settings-page">
      <SettingsHeader title="Account" />

      <div className="settings-page__body">
        <SettingsGroup>
          <SettingsRow settingId="email" label="Email" onClick={() => navigate('/settings/email')} />
          <SettingsRow settingId="password" label="Password" onClick={() => navigate('/settings/password')} />
        </SettingsGroup>

        {purchasesVisible && (
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

        {exportVisible && (
          <SettingsGroup>
            <SettingsRow
              settingId="export-data"
              label={isExporting ? 'Exporting\u2026' : 'Export my data'}
              value={plusActive ? undefined : <PlusBadge active />}
              onClick={plusActive ? handleExport : () => navigate('/plus')}
              disabled={isExporting}
            />
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
