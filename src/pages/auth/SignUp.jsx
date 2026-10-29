import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AtSign, Mail, Lock, LockKeyhole, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { SubmitButton } from '../../components/forms'
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
import {
  CONTENT_BLOCKED_MESSAGE,
  acceptTerms,
  holdTermsCheck,
  isTextAllowed,
  ugcErrorMessage,
} from '../../services/moderationService'
import { TermsSentence } from '../../components/TermsGate'
import AuthBrand from './AuthBrand'
import {
  AuthFieldGroup,
  AuthFieldRow,
  AuthFieldStatus,
  AuthNotice,
} from './AuthField'
import './Auth.css'
import './SignUp.css'

function usernameStatusMessage(status, username, issue) {
  const handle = normalizeUsername(username)
  if (status === 'checking') {
    return { tone: 'muted', message: 'Checking availability…', icon: false }
  }
  if (status === 'available') {
    return { tone: 'ok', message: `${handle} is available`, icon: true }
  }
  if (status === 'taken') {
    return { tone: 'bad', message: `${handle} is already taken`, icon: true }
  }
  if (status === 'invalid') {
    return { tone: 'bad', message: issue || USERNAME_HINT, icon: false }
  }
  return { tone: 'muted', message: USERNAME_HINT, icon: false }
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
  const [showFieldErrors, setShowFieldErrors] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  const goAuth = (e, path) => {
    if (location.state?.authFrom === path) {
      e.preventDefault()
      navigate(-1)
    }
  }

  const [usernameStatus, setUsernameStatus] = useState('idle')
  const [usernameIssue, setUsernameIssue] = useState(null)
  const [breachStatus, setBreachStatus] = useState('idle')

  const redirectTo =
    new URLSearchParams(location.search).get('redirectTo') || '/'

  const debouncedUsername = useDebounce(username, 400)
  useEffect(() => {
    const handle = normalizeUsername(debouncedUsername)
    if (!handle) {
      setUsernameStatus('idle')
      setUsernameIssue(null)
      return
    }
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

    const failValidation = (message) => {
      setFormError(message)
      setShowFieldErrors(true)
    }

    const trimmedUsername = normalizeUsername(username)
    const usernameCheck = validateUsername(trimmedUsername)
    if (!usernameCheck.valid) {
      failValidation(usernameCheck.message)
      return
    }
    if (usernameStatus === 'taken') {
      failValidation('That username is already taken. Please choose another.')
      return
    }
    if (!email.trim()) {
      failValidation('Please enter your email.')
      return
    }
    if (!isPasswordComposedCorrectly(password)) {
      failValidation('Your password doesn\u2019t meet the requirements below yet.')
      return
    }
    if (password !== confirmPassword) {
      failValidation('Passwords don\u2019t match.')
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

      if (!(await isTextAllowed(trimmedUsername, 'username'))) {
        setFormError(CONTENT_BLOCKED_MESSAGE)
        return
      }

      const releaseTermsCheck = holdTermsCheck()
      let created
      try {
        created = await signUp({
          email: email.trim(),
          password,
          displayName: trimmedUsername,
          username: trimmedUsername,
        })
        await acceptTerms().catch((termsErr) => {
          console.error('[signup] accept_terms failed:', termsErr)
        })
      } finally {
        releaseTermsCheck()
      }
      const { user, profile } = created
      syncProfileFromSupabase(profile)
      if (user?.id) convertReferral(user.id)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      const code = err?.code
      const moderation = ugcErrorMessage(err)
      if (moderation) {
        setFormError(moderation)
      } else if (code === AUTH_ERRORS.EMAIL_TAKEN) {
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
        showToast("Couldn't reach the server", 'error', null, null, null, { sub: 'Check your connection' })
      } else if (code === AUTH_ERRORS.PROFILE_BOOTSTRAP_FAILED) {
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

  const notice = useMemo(() => {
    if (!formError) return null
    if (formError === 'An account with this email already exists. Try logging in.') {
      return {
        title: formError,
        actionLabel: 'Log in',
        actionTo: `/login${location.search || ''}`,
        actionState: { authFrom: location.pathname },
        onActionClick: (e) => goAuth(e, '/login'),
      }
    }
    return { title: formError }
  }, [formError, location.pathname, location.search])

  const emailInvalid = showFieldErrors && !email.trim()
  const usernameInvalid =
    usernameStatus === 'taken' ||
    usernameStatus === 'invalid' ||
    (showFieldErrors && !normalizeUsername(username))
  const usernameValid = usernameStatus === 'available'
  const passwordValid = Boolean(password && !nextRequirement)
  const passwordInvalid =
    Boolean(password && nextRequirement && nextRequirement !== 'Checking against known breaches…')
  const confirmInvalid =
    confirmMismatch || (showFieldErrors && !confirmPassword)
  const confirmValid = confirmMatches

  const fieldStatus = useMemo(() => {
    if (focusedField === 'username') {
      return usernameStatusMessage(usernameStatus, username, usernameIssue)
    }
    if (focusedField === 'password') {
      return passwordStatusMessage(password, breachStatus) || { tone: null, message: null }
    }
    if (focusedField === 'confirm') {
      return confirmStatusMessage(confirmPassword, password) || { tone: null, message: null }
    }
    if (focusedField === 'email' && emailInvalid) {
      return { tone: 'bad', message: 'Email is required', icon: true }
    }

    const trimmed = normalizeUsername(username)
    if (!trimmed) {
      return { tone: 'muted', message: USERNAME_HINT, icon: false }
    }
    if (usernameStatus === 'taken' || usernameStatus === 'invalid') {
      return usernameStatusMessage(usernameStatus, username, usernameIssue)
    }
    if (password && nextRequirement && nextRequirement !== 'Checking against known breaches…') {
      return { tone: 'bad', message: nextRequirement, icon: false }
    }
    if (confirmMismatch) {
      return confirmStatusMessage(confirmPassword, password)
    }
    if (emailInvalid) {
      return { tone: 'bad', message: 'Email is required', icon: true }
    }
    if (showFieldErrors && !password) {
      return { tone: 'bad', message: 'Password is required', icon: true }
    }
    if (showFieldErrors && !confirmPassword) {
      return { tone: 'bad', message: 'Confirm password is required', icon: true }
    }
    return { tone: null, message: null }
  }, [
    focusedField,
    usernameStatus,
    username,
    usernameIssue,
    password,
    breachStatus,
    confirmPassword,
    nextRequirement,
    confirmMismatch,
    emailInvalid,
    showFieldErrors,
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

  return (
    <div className="auth-page">
      <div className="auth-wash" aria-hidden="true" />
      <div className="auth-body">
        <div className="auth-card">
          <AuthBrand
            title="Checkpoint"
            subtitle="Track, rate, and discover games with people who play like you."
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
                icon={AtSign}
                label="Username"
                value={username}
                onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                maxLength={USERNAME_MAX_LENGTH}
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                focused={focusedField === 'username'}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                invalid={usernameInvalid}
                valid={usernameValid}
                showCount
                countMax={USERNAME_MAX_LENGTH}
              />
              <AuthFieldRow
                icon={Lock}
                label="Password"
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
                label="Confirm password"
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
                Create account
              </SubmitButton>
              <p className="auth-legal">
                <TermsSentence
                  lead="By creating an account you agree to the"
                  linkClassName="auth-link"
                />{' '}
                We&rsquo;ll email a link to verify it&rsquo;s you.
              </p>
            </div>
          </form>
        </div>
      </div>

      <p className="auth-footer">
        Already have an account?{' '}
        <Link
          to={`/login${location.search || ''}`}
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

export default SignUp
