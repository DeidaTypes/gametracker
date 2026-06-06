import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { supabase } from '../services/supabase'
import { showToast } from '../components/Toast'
import './Settings.css'
import './SettingsAuthForm.css'

function SettingsPassword() {
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords don\u2019t match.')
      return
    }

    setSubmitting(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) {
        setError(err.message || 'Could not update password.')
        setSubmitting(false)
        return
      }
      showToast('Password updated.', 'success', 2400)
      navigate(-1)
    } catch (err) {
      console.error('[settings/password] update failed:', err)
      setError(err?.message || 'Could not update password.')
      setSubmitting(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          className="settings-header__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="settings-header__title">Password</h1>
        <span className="settings-header__spacer" aria-hidden="true" />
      </header>

      <div className="settings-page__body">
        <form className="settings-form" onSubmit={handleSubmit}>
          <p className="settings-form__caption">
            Choose a new password for your account.
          </p>

          <label className="settings-form__field">
            <span className="settings-form__label">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="settings-form__input"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="settings-form__field">
            <span className="settings-form__label">Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="settings-form__input"
            />
          </label>

          {error && <p className="settings-form__error">{error}</p>}

          <button
            type="submit"
            className="settings-form__submit"
            disabled={submitting}
          >
            {submitting ? 'Updating\u2026' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default SettingsPassword
