import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { TextField, SubmitButton } from '../../components/forms'
import { showToast } from '../../components/Toast'
import { AUTH_ERRORS } from '../../services/auth'
import './Auth.css'

function LogIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    if (!email.trim() || !password) {
      setFormError('Enter your email and password.')
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      await logIn({ email: email.trim(), password })
      navigate(redirectTo, { replace: true })
    } catch (err) {
      const code = err?.code
      if (code === AUTH_ERRORS.INVALID_CREDENTIALS) {
        setFormError('Wrong email or password.')
      } else if (code === AUTH_ERRORS.NETWORK) {
        showToast(
          "Couldn't reach the server. Check your connection.",
          'error'
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
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Log in to keep tracking your games.</p>
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

          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <div className="auth-form__actions">
            <SubmitButton type="submit" loading={submitting}>
              Log in
            </SubmitButton>
          </div>
        </form>

        <p className="auth-footer">
          Don&rsquo;t have an account?{' '}
          <Link
            to={`/signup${location.search || ''}`}
            className="auth-link"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LogIn
