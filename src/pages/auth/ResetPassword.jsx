import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Flag, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { TextField, SubmitButton } from '../../components/forms'
import { useDebounce } from '../../hooks/useDebounce'
import {
  isPasswordComposedCorrectly,
  isPasswordBreached,
  getNextPasswordRequirement,
} from '../../services/passwordPolicy'
import {
  parseRecoveryParams,
  establishRecoverySession,
  completePasswordReset,
  APP_URL_SCHEME,
  RESET_PATH,
} from '../../services/passwordReset'
import './Auth.css'
import './SignUp.css'
import './ForgotPassword.css'

/**
 * Resolve once a session exists, or after `timeoutMs` without one.
 *
 * Covers the window between this screen mounting and supabase-js finishing its
 * own detectSessionInUrl exchange. Polls rather than relying solely on
 * onAuthStateChange because the event may already have fired before we
 * subscribed.
 */
async function waitForRecoverySession(timeoutMs = 3000) {
  const { supabase } = await import('../../services/supabase')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await supabase.auth.getSession()
    if (data?.session) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  const { data } = await supabase.auth.getSession()
  return Boolean(data?.session)
}

/**
 * Set-new-password screen — where the reset email's link lands.
 *
 * The password rules are imported from services/passwordPolicy.js, the same
 * module SignUp.jsx uses, rather than restated: min 8 + uppercase + number +
 * special character, plus the k-anonymity HaveIBeenPwned screen. Restating them
 * is how the two screens end up disagreeing about what a valid password is.
 *
 * Lifecycle: 'verifying' → 'ready' (valid link) | 'invalid' (expired/used/
 * malformed) → 'done'.
 */
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

  // Offer to reopen in the app only when the link was opened in a mobile
  // browser — inside the app there is nothing to hand off to.
  const [handoffUrl, setHandoffUrl] = useState(null)

  // Keyed on the hash so a SECOND link arriving while this screen is already
  // open re-runs the exchange. Without it the screen would keep rendering the
  // outcome of the first link — which on native is reachable: appLifecycle.js
  // routes here on every recovery deep link, and React Router does not remount
  // a component when only the fragment changes.
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

      // No token in the URL is the NORMAL case on web, not an error: the
      // Supabase client is created with detectSessionInUrl, so it consumes the
      // fragment and strips it during module init — which happens before this
      // component ever renders. The same is true on native, where
      // appLifecycle.js establishes the session before routing here.
      //
      // So when there is nothing to parse, wait briefly for a session to appear
      // rather than declaring the link dead. Only a genuinely absent session
      // after that window means the link was bad.
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

      // Drop the tokens from the address bar so they don't survive in history
      // or get shoulder-surfed. The session is already established.
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', RESET_PATH)
      }
      setPhase('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [location.hash])

  // Same debounced breach screening SignUp runs while typing.
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
      // Final breach re-check before committing, mirroring SignUp — guards the
      // case where the user submits before the debounce fires.
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

  const mesh = (
    <div className="auth-mesh" aria-hidden="true">
      <span className="auth-mesh__blob auth-mesh__blob--a" />
      <span className="auth-mesh__blob auth-mesh__blob--b" />
      <span className="auth-mesh__blob auth-mesh__blob--c" />
    </div>
  )

  if (phase === 'verifying') {
    return (
      <div className="auth-page fp-page auth-page--signature">
        {mesh}
        <div className="auth-card">
          <div className="auth-brand-mark" aria-hidden="true">
            <Flag strokeWidth={2.25} />
          </div>
          <header className="auth-header">
            <h1 className="auth-title">Checking your link</h1>
          </header>
          <div className="fp-verifying">
            <span className="fp-spinner" aria-hidden="true" />
            <span className="sr-only">Verifying reset link…</span>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div className="auth-page fp-page auth-page--signature">
        {mesh}
        <div className="auth-card">
          <div className="auth-brand-mark" aria-hidden="true">
            <Flag strokeWidth={2.25} />
          </div>
          <header className="auth-header">
            <h1 className="auth-title">
              Link no longer <span className="auth-gradient-text">valid</span>
            </h1>
            <p className="auth-subtitle">{linkError}</p>
          </header>

          <div className="auth-form__actions">
            <SubmitButton
              type="button"
              onClick={() => navigate('/forgot-password', { replace: true })}
            >
              Request a new link
            </SubmitButton>
          </div>

          <p className="auth-footer">
            <Link to="/login" className="auth-link">
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="auth-page fp-page auth-page--signature">
        {mesh}
        <div className="auth-card">
          <div className="auth-brand-mark" aria-hidden="true">
            <ShieldCheck strokeWidth={2.25} />
          </div>
          <header className="auth-header">
            <h1 className="auth-title">
              Password <span className="auth-gradient-text">updated</span>
            </h1>
            <p className="auth-subtitle">
              You’re all set. Use your new password the next time you log in.
            </p>
          </header>

          <div className="auth-form__actions">
            <SubmitButton type="button" onClick={() => navigate('/', { replace: true })}>
              Continue to Checkpoint
            </SubmitButton>
          </div>

          <p className="auth-footer">
            <Link to="/login" className="auth-link">
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    )
  }

  let confirmHintNode = null
  let confirmFieldClass = ''
  if (confirmMatches) {
    confirmHintNode = <span className="su-status su-status--ok">✓ Passwords match</span>
    confirmFieldClass = 'auth-field--valid'
  } else if (confirmMismatch) {
    confirmHintNode = (
      <span className="su-status su-status--bad">✗ Passwords don&rsquo;t match</span>
    )
    confirmFieldClass = 'auth-field--invalid'
  }

  return (
    <div className="auth-page fp-page auth-page--signature">
      {mesh}
      <div className="auth-card">
        <div className="auth-brand-mark" aria-hidden="true">
          <Flag strokeWidth={2.25} />
        </div>

        <header className="auth-header">
          <h1 className="auth-title">
            Set a new <span className="auth-gradient-text">password</span>
          </h1>
          <p className="auth-subtitle">
            Choose something you haven’t used anywhere else.
          </p>
        </header>

        {handoffUrl && (
          <div className="fp-handoff">
            <p className="fp-handoff__text">
              Have the Checkpoint app installed?
            </p>
            <a className="fp-handoff__action" href={handoffUrl}>
              Open this in the app
            </a>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="auth-error" role="alert">
              <span>{formError}</span>
            </div>
          )}

          <div className="su-password-block">
            <TextField
              label="New password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoFocus
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

            {password && (
              <p
                className={`auth-password-hint ${
                  nextRequirement
                    ? 'auth-password-hint--unmet'
                    : 'auth-password-hint--ok'
                }`}
              >
                {nextRequirement || '✓ Looks good'}
              </p>
            )}
          </div>

          <TextField
            label="Confirm new password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            hint={confirmHintNode}
            className={confirmFieldClass}
            required
          />

          <div className="auth-form__actions">
            <SubmitButton type="submit" loading={submitting}>
              Update password
            </SubmitButton>
          </div>
        </form>

        <p className="auth-footer">
          <Link to="/login" className="auth-link">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ResetPassword
