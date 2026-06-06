import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import { showToast } from '../components/Toast'
import './Settings.css'
import './SettingsAuthForm.css'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function SettingsEmail() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const currentEmail = user?.email || ''

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    const next = email.trim()
    if (!next) {
      setError('Enter a new email address.')
      return
    }
    if (!EMAIL_REGEX.test(next)) {
      setError('That doesn\u2019t look like a valid email.')
      return
    }
    if (next.toLowerCase() === currentEmail.toLowerCase()) {
      setError('That\u2019s already your email.')
      return
    }

    setSubmitting(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ email: next })
      if (err) {
        setError(err.message || 'Could not update email.')
        setSubmitting(false)
        return
      }
      showToast(
        'Check your inbox to confirm the new address.',
        'success',
        4000
      )
      navigate(-1)
    } catch (err) {
      console.error('[settings/email] update failed:', err)
      setError(err?.message || 'Could not update email.')
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
        <h1 className="settings-header__title">Email</h1>
        <span className="settings-header__spacer" aria-hidden="true" />
      </header>

      <div className="settings-page__body">
        <form className="settings-form" onSubmit={handleSubmit}>
          <p className="settings-form__caption">
            We&rsquo;ll send a confirmation link to your new address. The
            change takes effect once you click it.
          </p>

          <label className="settings-form__field">
            <span className="settings-form__label">Current email</span>
            <input
              type="email"
              value={currentEmail}
              readOnly
              className="settings-form__input settings-form__input--readonly"
              tabIndex={-1}
            />
          </label>

          <label className="settings-form__field">
            <span className="settings-form__label">New email</span>
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="settings-form__input"
              placeholder="you@example.com"
            />
          </label>

          {error && <p className="settings-form__error">{error}</p>}

          <button
            type="submit"
            className="settings-form__submit"
            disabled={submitting}
          >
            {submitting ? 'Updating\u2026' : 'Update email'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default SettingsEmail
