import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Flag, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { TextField, SubmitButton } from '../../components/forms'
import { showToast } from '../../components/Toast'
import { AUTH_ERRORS, isUsernameAvailableRemote } from '../../services/auth'
import {
  normalizeUsername,
  validateUsername,
  USERNAME_HINT,
  USERNAME_MAX_LENGTH,
} from '../../services/usernameRules'
import {
  isPasswordComposedCorrectly,
  isPasswordBreached,
  getNextPasswordRequirement,
} from '../../services/passwordPolicy'
import { useDebounce } from '../../hooks/useDebounce'
import { syncProfileFromSupabase } from '../../services/profileService'
import { convertReferral } from '../../services/inviteService'
import './Auth.css'
import './SignUp.css'

function SignUp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signUp } = useAuth()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  // 'idle' | 'invalid' | 'checking' | 'available' | 'taken'
  const [usernameStatus, setUsernameStatus] = useState('idle')
  // Which rule an invalid handle broke, so the hint can name it instead of
  // repeating the generic format line.
  const [usernameIssue, setUsernameIssue] = useState(null)
  // 'idle' | 'checking' | 'clear' | 'breached'
  const [breachStatus, setBreachStatus] = useState('idle')

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  // ── Real-time username availability (debounced) ─────────────────────────
  const debouncedUsername = useDebounce(username, 400)
  useEffect(() => {
    const handle = normalizeUsername(debouncedUsername)
    if (!handle) {
      setUsernameStatus('idle')
      setUsernameIssue(null)
      return
    }
    // Structural rules are checked locally first — there's no point spending a
    // round trip asking whether "_bob" is available when it can never be legal.
    const check = validateUsername(handle)
    if (!check.valid) {
      setUsernameStatus('invalid')
      setUsernameIssue(check.message)
      return
    }
    setUsernameIssue(null)
    let cancelled = false
    setUsernameStatus('checking')
    isUsernameAvailableRemote(handle).then((available) => {
      if (cancelled) return
      setUsernameStatus(available ? 'available' : 'taken')
    })
    return () => {
      cancelled = true
    }
  }, [debouncedUsername])

  // ── Real-time leaked-password screening (debounced, k-anonymity) ────────
  // Best-effort client-side stand-in for Supabase's server-side
  // password_hibp_enabled flag, which requires a Pro-plan project (this
  // project is on Free — see services/passwordPolicy.js for details).
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

  // Single dynamic requirement line: shows only the next unmet rule
  // (length → uppercase → number → special char → breach check), or the
  // green "Looks good" success state once everything passes.
  const nextRequirement = password
    ? getNextPasswordRequirement(password, breachStatus)
    : null

  const confirmMatches = confirmPassword.length > 0 && confirmPassword === password
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    const trimmedUsername = normalizeUsername(username)
    const usernameCheck = validateUsername(trimmedUsername)
    if (!usernameCheck.valid) {
      setFormError(usernameCheck.message)
      return
    }
    if (usernameStatus === 'taken') {
      setFormError('That username is already taken. Please choose another.')
      return
    }
    if (!email.trim()) {
      setFormError('Please enter your email.')
      return
    }
    if (!isPasswordComposedCorrectly(password)) {
      setFormError('Your password doesn\u2019t meet the requirements below yet.')
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords don\u2019t match.')
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      // Final breach re-check right before account creation. The debounced
      // check above already runs live while typing (drives the hint line);
      // this guards the case where the user submits before that debounce
      // fires.
      const breached = await isPasswordBreached(password)
      if (breached) {
        setBreachStatus('breached')
        setFormError(
          'That password has appeared in a known data breach. Please choose a different one.'
        )
        return
      }

      // Display name defaults to the username at signup time — there's no
      // separate Name field on this screen. The user can change their
      // display name later via Edit Profile.
      const { user, profile } = await signUp({
        email: email.trim(),
        password,
        displayName: trimmedUsername,
        username: trimmedUsername,
      })
      // Mirror the just-created server profile into the localStorage store
      // the own-profile UI reads, so the entered username shows up
      // immediately instead of a stock default.
      syncProfileFromSupabase(profile)
      // Fire-and-forget: record referral conversion if the user arrived via
      // an invite link. Errors are logged but never surface to the user.
      if (user?.id) convertReferral(user.id)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      const code = err?.code
      if (code === AUTH_ERRORS.EMAIL_TAKEN) {
        setFormError(
          'An account with this email already exists. Try logging in.'
        )
      } else if (code === AUTH_ERRORS.USERNAME_TAKEN) {
        setFormError('That username is already taken. Please choose another.')
      } else if (code === AUTH_ERRORS.USERNAME_INVALID) {
        setFormError(err?.message || USERNAME_HINT)
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

  let usernameHintNode = <span className="su-status su-status--muted">{USERNAME_HINT}</span>
  let usernameFieldClass = ''
  if (usernameStatus === 'checking') {
    usernameHintNode = <span className="su-status su-status--pending">Checking availability…</span>
  } else if (usernameStatus === 'available') {
    usernameHintNode = (
      <span className="su-status su-status--ok">
        ✓ {normalizeUsername(username)} is available
      </span>
    )
    usernameFieldClass = 'auth-field--valid'
  } else if (usernameStatus === 'taken') {
    usernameHintNode = (
      <span className="su-status su-status--bad">
        ✗ {normalizeUsername(username)} is already taken
      </span>
    )
    usernameFieldClass = 'auth-field--invalid'
  } else if (usernameStatus === 'invalid') {
    usernameHintNode = (
      <span className="su-status su-status--bad">{usernameIssue || USERNAME_HINT}</span>
    )
    usernameFieldClass = 'auth-field--invalid'
  }

  let confirmHintNode = null
  let confirmFieldClass = ''
  if (confirmMatches) {
    confirmHintNode = <span className="su-status su-status--ok">✓ Passwords match</span>
    confirmFieldClass = 'auth-field--valid'
  } else if (confirmMismatch) {
    confirmHintNode = <span className="su-status su-status--bad">✗ Passwords don&rsquo;t match</span>
    confirmFieldClass = 'auth-field--invalid'
  }

  return (
    <div className="auth-page su-page auth-page--signature">
      <div className="auth-mesh" aria-hidden="true">
        <span className="auth-mesh__blob auth-mesh__blob--a" />
        <span className="auth-mesh__blob auth-mesh__blob--b" />
        <span className="auth-mesh__blob auth-mesh__blob--c" />
      </div>
      <div className="auth-card su-card">
        <div className="auth-brand-mark" aria-hidden="true">
          <Flag strokeWidth={2.25} />
        </div>

        <header className="auth-header">
          <h1 className="auth-title">
            Create your <span className="auth-gradient-text">account</span>
          </h1>
          <p className="auth-subtitle">
            Track, rate, and discover games with people who play like you.
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

          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(normalizeUsername(e.target.value))}
            placeholder="username"
            maxLength={USERNAME_MAX_LENGTH}
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            hint={usernameHintNode}
            className={usernameFieldClass}
            required
          />

          <div className="su-password-block">
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
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
            label="Confirm password"
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
              Create account
            </SubmitButton>
            <p className="su-verify-note">
              We&rsquo;ll email a link to verify it&rsquo;s you.
            </p>
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
