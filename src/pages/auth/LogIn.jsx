import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Flag, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { TextField, SubmitButton } from '../../components/forms'
import { showToast } from '../../components/Toast'
import { AUTH_ERRORS } from '../../services/auth'
import AccountRecoverySheet from '../../components/AccountRecoverySheet'
import {
  getPendingDeletion,
  restoreAccount,
  daysUntilHardDelete,
} from '../../services/deleteAccountService'
import './Auth.css'
import './LogIn.css'

function LogIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logIn, logOut } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  // Recovery sheet state
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [daysRemaining, setDaysRemaining] = useState(30)
  const [isRestoring, setIsRestoring] = useState(false)

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  // Show "Account deleted" toast if we were redirected here after deletion.
  useEffect(() => {
    if (location.state?.accountDeleted) {
      showToast("Account deleted. We're sorry to see you go.", 'success', 4000)
      // Clear the state so a refresh doesn't re-show it.
      window.history.replaceState({}, '', location.pathname + location.search)
    }
  }, [location.state, location.pathname, location.search])

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

      // Check whether this account is pending deletion.
      const pending = await getPendingDeletion()
      if (pending?.deleted_at) {
        const days = daysUntilHardDelete(pending.deleted_at)
        if (days > 0) {
          setDaysRemaining(days)
          setRecoveryOpen(true)
          // Do NOT navigate yet — wait for the user's choice.
          return
        }
        // Recovery window expired; treat like a normal login and let
        // the Sprint 8 cron job tidy up.
      }

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

  const handleRestore = async () => {
    if (isRestoring) return
    setIsRestoring(true)
    try {
      await restoreAccount()
      setRecoveryOpen(false)
      showToast('Your account has been restored. Welcome back!', 'success', 3500)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      showToast(err?.message || 'Could not restore account. Try again.', 'error')
    } finally {
      setIsRestoring(false)
    }
  }

  const handleContinueDeletion = async () => {
    setRecoveryOpen(false)
    await logOut().catch(() => {})
    showToast('Your account is still scheduled for deletion.', 'info', 3500)
  }

  return (
    <div className="auth-page li-page auth-page--signature">
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
            Welcome <span className="auth-gradient-text">back</span>
          </h1>
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
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            labelExtra={
              <Link
                to={`/forgot-password${location.search || ''}`}
                className="li-forgot-link"
              >
                Forgot?
              </Link>
            }
            endAdornment={
              <button
                type="button"
                className="auth-eye-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
              </button>
            }
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

      <AccountRecoverySheet
        isOpen={recoveryOpen}
        daysRemaining={daysRemaining}
        onRestore={handleRestore}
        onContinue={handleContinueDeletion}
        isRestoring={isRestoring}
      />
    </div>
  )
}

export default LogIn
