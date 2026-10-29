import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Lock, LockKeyhole, Eye, EyeOff } from 'lucide-react'
import { SubmitButton } from '../../components/forms'
import { useDebounce } from '../../hooks/useDebounce'
import {
  isPasswordComposedCorrectly,
  isPasswordBreached,
  getNextPasswordRequirement,
} from '../../services/passwordPolicy'
import { supabase } from '../../services/supabase'
import {
  parseRecoveryParams,
  establishRecoverySession,
  completePasswordReset,
  APP_URL_SCHEME,
  RESET_PATH,
} from '../../services/passwordReset'
import AuthBrand from './AuthBrand'
import {
  AuthFieldGroup,
  AuthFieldRow,
  AuthFieldStatus,
  AuthNotice,
} from './AuthField'
import './Auth.css'
import './ForgotPassword.css'

async function waitForRecoverySession(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await supabase.auth.getSession()
    if (data?.session) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  const { data } = await supabase.auth.getSession()
  return Boolean(data?.session)
}

function passwordStatusMessage(password, breachStatus) {
  if (!password) return null
  const next = getNextPasswordRequirement(password, breachStatus)
  if (!next) {
    return { tone: 'ok', message: 'Looks good', icon: true }
  }
  if (next === 'Checking against known breaches…') {
    return { tone: 'muted', message: next, icon: false }
  }
  return { tone: 'bad', message: next, icon: false }
}

function confirmStatusMessage(confirmPassword, password) {
  if (!confirmPassword) return null
  if (confirmPassword === password) {
    return { tone: 'ok', message: 'Passwords match', icon: true }
  }
  return { tone: 'bad', message: "Passwords don't match", icon: true }
}

function ResetPassword() {
  const navigate = useNavigate()
  const location = useLocation()

  const [phase, setPhase] = useState('verifying')
  const [linkError, setLinkError] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [breachStatus, setBreachStatus] = useState('idle')
  const [focusedField, setFocusedField] = useState(null)
  const [handoffUrl, setHandoffUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    setPhase('verifying')

    ;(async () => {
      const href = typeof window !== 'undefined' ? window.location.href : ''
      const params = parseRecoveryParams(href)

      if (!cancelled && !Capacitor.isNativePlatform() && params?.kind !== 'error') {
        const isMobileBrowser =
          typeof navigator !== 'undefined' &&
          /iphone|ipad|ipod/i.test(navigator.userAgent || '')
        if (isMobileBrowser && href) {
          const fragment = href.slice(href.indexOf(RESET_PATH) + RESET_PATH.length)
          setHandoffUrl(`${APP_URL_SCHEME}://reset-password${fragment}`)
        }
      }

      if (!params) {
        const ok = await waitForRecoverySession()
        if (cancelled) return
        if (ok) {
          setPhase('ready')
        } else {
          setLinkError(
            'This reset link is no longer valid. Request a new one to continue.'
          )
          setPhase('invalid')
        }
        return
      }

      const result = await establishRecoverySession(params)
      if (cancelled) return

      if (!result.ok) {
        setLinkError(
          result.message ||
            'This reset link has expired or has already been used.'
        )
        setPhase('invalid')
        return
      }

      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', RESET_PATH)
      }
      setPhase('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [location.hash])

  const debouncedPassword = useDebounce(password, 500)
  useEffect(() => {
    if (!debouncedPassword) {
      setBreachStatus('idle')
      return
    }
    let cancelled = false
    setBreachStatus('checking')
    isPasswordBreached(debouncedPassword).then((breached) => {
      if (cancelled) return
      setBreachStatus(breached ? 'breached' : 'clear')
    })
    return () => {
      cancelled = true
    }
  }, [debouncedPassword])

  const nextRequirement = password
    ? getNextPasswordRequirement(password, breachStatus)
    : null

  const confirmMatches = confirmPassword.length > 0 && confirmPassword === password
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    if (!isPasswordComposedCorrectly(password)) {
      setFormError('Your password doesn’t meet the requirements below yet.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords don’t match.')
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      const breached = await isPasswordBreached(password)
      if (breached) {
        setBreachStatus('breached')
        setFormError(
          'That password has appeared in a known data breach. Please choose a different one.'
        )
        return
      }

      const result = await completePasswordReset(password)
      if (!result.ok) {
        setFormError(result.message || 'Could not update your password.')
        return
      }
      setPhase('done')
    } finally {
      setSubmitting(false)
    }
  }

  const passwordValid = Boolean(password && !nextRequirement)
  const passwordInvalid =
    Boolean(password && nextRequirement && nextRequirement !== 'Checking against known breaches…')
  const confirmValid = confirmMatches
  const confirmInvalid = confirmMismatch

  const fieldStatus = useMemo(() => {
    if (focusedField === 'password') {
      return passwordStatusMessage(password, breachStatus) || { tone: null, message: null }
    }
    if (focusedField === 'confirm') {
      return confirmStatusMessage(confirmPassword, password) || { tone: null, message: null }
    }
    if (password && nextRequirement && nextRequirement !== 'Checking against known breaches…') {
      return { tone: 'bad', message: nextRequirement, icon: false }
    }
    if (confirmMismatch) {
      return confirmStatusMessage(confirmPassword, password)
    }
    return { tone: null, message: null }
  }, [
    focusedField,
    password,
    breachStatus,
    confirmPassword,
    nextRequirement,
    confirmMismatch,
  ])

  const eyeToggle = (
    <button
      type="button"
      className="auth-eye-toggle"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      aria-pressed={showPassword}
    >
      {showPassword ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
    </button>
  )

  const shell = (body, footer) => (
    <div className="auth-page">
      <div className="auth-wash" aria-hidden="true" />
      <div className="auth-body">
        <div className="auth-card">{body}</div>
      </div>
      {footer}
    </div>
  )

  if (phase === 'verifying') {
    return shell(
      <>
        <AuthBrand title="Checking your link" />
        <div className="fp-verifying">
          <span className="fp-spinner" aria-hidden="true" />
          <span className="sr-only">Verifying reset link…</span>
        </div>
      </>,
      null
    )
  }

  if (phase === 'invalid') {
    return shell(
      <>
        <AuthBrand title="Link no longer valid" subtitle={linkError} />
        <div className="auth-form__actions">
          <SubmitButton
            type="button"
            onClick={() => navigate('/forgot-password', { replace: true })}
          >
            Request a new link
          </SubmitButton>
        </div>
      </>,
      <p className="auth-footer">
        Remembered it?{' '}
        <Link to="/login" className="auth-link">
          Log in
        </Link>
      </p>
    )
  }

  if (phase === 'done') {
    return shell(
      <>
        <AuthBrand
          title="Password updated"
          subtitle="You’re all set. Use your new password the next time you log in."
        />
        <div className="auth-form__actions">
          <SubmitButton type="button" onClick={() => navigate('/', { replace: true })}>
            Continue to Checkpoint
          </SubmitButton>
        </div>
      </>,
      <p className="auth-footer">
        Remembered it?{' '}
        <Link to="/login" className="auth-link">
          Log in
        </Link>
      </p>
    )
  }

  return shell(
    <>
      <AuthBrand
        title="Set a new password"
        subtitle="Choose something you haven’t used anywhere else."
      />

      {handoffUrl ? (
        <div className="fp-handoff">
          <p className="fp-handoff__text">
            Have the Checkpoint app installed?
          </p>
          <a className="fp-handoff__action" href={handoffUrl}>
            Open this in the app
          </a>
        </div>
      ) : null}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <AuthNotice title={formError} /> : null}

        <AuthFieldGroup>
          <AuthFieldRow
            icon={Lock}
            label="New password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            focused={focusedField === 'password'}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
            invalid={passwordInvalid}
            valid={passwordValid}
            endAdornment={eyeToggle}
          />
          <AuthFieldRow
            icon={LockKeyhole}
            label="Confirm new password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            focused={focusedField === 'confirm'}
            onFocus={() => setFocusedField('confirm')}
            onBlur={() => setFocusedField(null)}
            invalid={confirmInvalid}
            valid={confirmValid}
          />
        </AuthFieldGroup>

        <AuthFieldStatus
          tone={fieldStatus.tone}
          message={fieldStatus.message}
          icon={fieldStatus.icon !== false}
        />

        <div className="auth-form__actions">
          <SubmitButton type="submit" loading={submitting}>
            Update password
          </SubmitButton>
        </div>
      </form>
    </>,
    <p className="auth-footer">
      Remembered it?{' '}
      <Link to="/login" className="auth-link">
        Log in
      </Link>
    </p>
  )
}

export default ResetPassword
