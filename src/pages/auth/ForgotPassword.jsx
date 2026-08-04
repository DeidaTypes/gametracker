import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Flag, MailCheck } from 'lucide-react'
import { TextField, SubmitButton } from '../../components/forms'
import {
  requestPasswordReset,
  RESET_REQUEST_MESSAGE,
} from '../../services/passwordReset'
import './Auth.css'
import './ForgotPassword.css'

// Format-only. Whether the address actually exists is never checked here and
// never revealed — see services/passwordReset.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ForgotPassword() {
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    const address = email.trim()
    if (!address) {
      setFormError('Please enter your email.')
      return
    }
    if (!EMAIL_PATTERN.test(address)) {
      setFormError('That doesn’t look like a valid email address.')
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      // Resolves identically for a registered and an unregistered address, so
      // there is nothing to branch on here — which is the point.
      await requestPasswordReset(address)
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="auth-page fp-page auth-page--signature">
        <div className="auth-mesh" aria-hidden="true">
          <span className="auth-mesh__blob auth-mesh__blob--a" />
          <span className="auth-mesh__blob auth-mesh__blob--b" />
          <span className="auth-mesh__blob auth-mesh__blob--c" />
        </div>
        <div className="auth-card">
          <div className="auth-brand-mark" aria-hidden="true">
            <MailCheck strokeWidth={2.25} />
          </div>

          <header className="auth-header">
            <h1 className="auth-title">
              Check your <span className="auth-gradient-text">inbox</span>
            </h1>
            <p className="auth-subtitle">{RESET_REQUEST_MESSAGE}</p>
          </header>

          <p className="fp-note">
            The link expires in an hour. If it doesn’t arrive, check your spam
            folder before requesting another.
          </p>

          <p className="auth-footer">
            <Link to={`/login${location.search || ''}`} className="auth-link">
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page fp-page auth-page--signature">
      <div className="auth-mesh" aria-hidden="true">
        <span className="auth-mesh__blob auth-mesh__blob--a" />
        <span className="auth-mesh__blob auth-mesh__blob--b" />
        <span className="auth-mesh__blob auth-mesh__blob--c" />
      </div>
      <div className="auth-card">
        <div className="auth-brand-mark" aria-hidden="true">
          <Flag strokeWidth={2.25} />
        </div>

        <header className="auth-header">
          <h1 className="auth-title">
            Reset your <span className="auth-gradient-text">password</span>
          </h1>
          <p className="auth-subtitle">
            Enter the email you signed up with and we’ll send you a link to set
            a new password.
          </p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="auth-error" role="alert">
              <span>{formError}</span>
            </div>
          )}

          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />

          <div className="auth-form__actions">
            <SubmitButton type="submit" loading={submitting}>
              Send reset link
            </SubmitButton>
          </div>
        </form>

        <p className="auth-footer">
          Remembered it?{' '}
          <Link to={`/login${location.search || ''}`} className="auth-link">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ForgotPassword
