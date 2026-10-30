import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { SubmitButton } from '../../components/forms'
import { showToast } from '../../components/Toast'
import { AUTH_ERRORS } from '../../services/auth'
import AuthBrand from './AuthBrand'
import {
  AuthFieldGroup,
  AuthFieldRow,
  AuthFieldStatus,
  AuthForgotLink,
  AuthNotice,
} from './AuthField'
import './Auth.css'
import './LogIn.css'

function LogIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [showFieldErrors, setShowFieldErrors] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  const goAuth = (e, path) => {
    if (location.state?.authFrom === path) {
      e.preventDefault()
      navigate(-1)
    }
  }

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  useEffect(() => {
    if (location.state?.accountDeleted) {
      showToast('Account deleted', 'success', 4000, null, 'trash', { sub: "We're sorry to see you go" })
      window.history.replaceState({}, '', location.pathname + location.search)
    }
  }, [location.state, location.pathname, location.search])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    if (!email.trim() || !password) {
      setFormError('Enter your email and password.')
      setShowFieldErrors(true)
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
        showToast("Couldn't reach the server", 'error', null, null, null, { sub: 'Check your connection' })
      } else {
        setFormError(err?.message || 'Something went wrong. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const notice = useMemo(() => {
    if (!formError) return null
    if (formError === 'Wrong email or password.') {
      return {
        title: 'Wrong email or password',
        sub: 'Check them and try again.',
        actionLabel: 'Reset',
        actionTo: `/forgot-password${location.search || ''}`,
        actionState: { authFrom: location.pathname },
        onActionClick: (e) => goAuth(e, '/forgot-password'),
      }
    }
    return { title: formError }
  }, [formError, location.pathname, location.search])

  const emailInvalid = showFieldErrors && !email.trim()
  const passwordInvalid = showFieldErrors && !password

  let statusMessage = null
  let statusTone = null
  if (focusedField === 'email' && emailInvalid) {
    statusMessage = 'Email is required'
    statusTone = 'bad'
  } else if (focusedField === 'password' && passwordInvalid) {
    statusMessage = 'Password is required'
    statusTone = 'bad'
  } else if (!focusedField) {
    if (emailInvalid) {
      statusMessage = 'Email is required'
      statusTone = 'bad'
    } else if (passwordInvalid) {
      statusMessage = 'Password is required'
      statusTone = 'bad'
    }
  }

  const forgotPath = `/forgot-password${location.search || ''}`

  return (
    <div className="auth-page">
      <div className="auth-wash" aria-hidden="true" />
      <div className="auth-body">
        <div className="auth-card">
          <AuthBrand
            title="Checkpoint"
            subtitle="Log in to keep tracking your games."
          />

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {notice ? (
              <AuthNotice
                title={notice.title}
                sub={notice.sub}
                actionLabel={notice.actionLabel}
                actionTo={notice.actionTo}
                actionState={notice.actionState}
                onActionClick={notice.onActionClick}
              />
            ) : null}

            <AuthFieldGroup>
              <AuthFieldRow
                icon={Mail}
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                focused={focusedField === 'email'}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                invalid={emailInvalid}
              />
              <AuthFieldRow
                icon={Lock}
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                focused={focusedField === 'password'}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                invalid={passwordInvalid}
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
            </AuthFieldGroup>

            {statusMessage ? (
              <AuthFieldStatus tone={statusTone} message={statusMessage} />
            ) : null}

            <AuthForgotLink
              to={forgotPath}
              state={{ authFrom: location.pathname }}
              onClick={(e) => goAuth(e, '/forgot-password')}
            >
              Forgot password?
            </AuthForgotLink>

            <div className="auth-form__actions">
              <SubmitButton type="submit" loading={submitting}>
                Log in
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>

      <p className="auth-footer">
        New to Checkpoint?{' '}
        <Link
          to={`/signup${location.search || ''}`}
          state={{ authFrom: location.pathname }}
          onClick={(e) => goAuth(e, '/signup')}
          className="auth-link"
        >
          Create an account
        </Link>
      </p>
    </div>
  )
}

export default LogIn
