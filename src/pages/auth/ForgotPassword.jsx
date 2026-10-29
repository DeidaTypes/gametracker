import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { SubmitButton } from '../../components/forms'
import {
  requestPasswordReset,
  RESET_REQUEST_MESSAGE,
} from '../../services/passwordReset'
import AuthBrand from './AuthBrand'
import {
  AuthFieldGroup,
  AuthFieldRow,
  AuthNotice,
} from './AuthField'
import './Auth.css'
import './ForgotPassword.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ForgotPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [sent, setSent] = useState(false)

  const goAuth = (e, path) => {
    if (location.state?.authFrom === path) {
      e.preventDefault()
      navigate(-1)
    }
  }

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
      await requestPasswordReset(address)
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  const loginPath = `/login${location.search || ''}`

  if (sent) {
    return (
      <div className="auth-page">
        <div className="auth-wash" aria-hidden="true" />
        <div className="auth-body">
          <div className="auth-card">
            <AuthBrand
              title="Check your inbox"
              subtitle={RESET_REQUEST_MESSAGE}
            />
            <p className="fp-note">
              The link expires in an hour. If it doesn’t arrive, check your spam
              folder before requesting another.
            </p>
          </div>
        </div>

        <p className="auth-footer">
          <Link
            to={loginPath}
            state={{ authFrom: location.pathname }}
            onClick={(e) => goAuth(e, '/login')}
            className="auth-link"
          >
            Back to log in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-wash" aria-hidden="true" />
      <div className="auth-body">
        <div className="auth-card">
          <AuthBrand
            title="Reset your password"
            subtitle="Enter the email you signed up with and we’ll send you a link to set a new password."
          />

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {formError ? <AuthNotice title={formError} /> : null}

            <AuthFieldGroup>
              <AuthFieldRow
                icon={Mail}
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </AuthFieldGroup>

            <div className="auth-form__actions">
              <SubmitButton type="submit" loading={submitting}>
                Send reset link
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>

      <p className="auth-footer">
        Remembered it?{' '}
        <Link
          to={loginPath}
          state={{ authFrom: location.pathname }}
          onClick={(e) => goAuth(e, '/login')}
          className="auth-link"
        >
          Log in
        </Link>
      </p>
    </div>
  )
}

export default ForgotPassword
