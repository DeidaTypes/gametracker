import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { TextField, SubmitButton } from '../../components/forms'
import { showToast } from '../../components/Toast'
import { AUTH_ERRORS } from '../../services/auth'
import './Auth.css'

const DISPLAY_NAME_MAX = 50
const MIN_PASSWORD_LENGTH = 6

function SignUp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signUp } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setFormError('Please enter a display name.')
      return
    }
    if (!email.trim()) {
      setFormError('Please enter your email.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      )
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      await signUp({
        email: email.trim(),
        password,
        displayName: trimmedName,
      })
      navigate(redirectTo, { replace: true })
    } catch (err) {
      const code = err?.code
      if (code === AUTH_ERRORS.EMAIL_TAKEN) {
        setFormError(
          'An account with this email already exists. Try logging in.'
        )
      } else if (code === AUTH_ERRORS.WEAK_PASSWORD) {
        setFormError(
          err?.message || 'Please choose a stronger password.'
        )
      } else if (code === AUTH_ERRORS.NETWORK) {
        showToast(
          "Couldn't reach the server. Check your connection.",
          'error'
        )
      } else if (code === AUTH_ERRORS.PROFILE_BOOTSTRAP_FAILED) {
        // The auth user exists but the profile row insert failed. Tell
        // the user clearly so they can retry / contact support rather
        // than silently leaving them in a broken state.
        setFormError(
          err.message ||
            'Account created but profile setup failed. Please log in to retry.'
        )
      } else {
        setFormError(err?.message || 'Something went wrong. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">
            Start tracking the games you&rsquo;ve played, want to play, and love.
          </p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="auth-error" role="alert">
              <span>{formError}</span>
            </div>
          )}

          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="name"
            required
            autoFocus
          />

          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            required
          />

          <div className="auth-form__actions">
            <SubmitButton type="submit" loading={submitting}>
              Create account
            </SubmitButton>
          </div>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link
            to={`/login${location.search || ''}`}
            className="auth-link"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default SignUp
