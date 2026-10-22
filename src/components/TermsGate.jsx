import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CenteredModal from './CenteredModal'
import { SecondaryButton, SubmitButton } from './forms'
import { useAuth } from '../contexts/AuthContext'
import { PRIVACY_URL, TERMS_URL } from '../config/site'
import { acceptTerms, getAccountStatus } from '../services/moderationService'
import './TermsGate.css'

function openExternal(event, url) {
  event.preventDefault()
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.href = url
  }
}

function DocLink({ url, label, className }) {
  if (!url) return label
  return (
    <a href={url} className={className} onClick={(e) => openExternal(e, url)}>
      {label}
    </a>
  )
}

/**
 * "…the Terms of Use and Privacy Policy" with both linked through
 * config/site.js. Without SITE_URL the names render as plain text.
 */
export function TermsSentence({ lead, linkClassName = 'terms-gate__link' }) {
  return (
    <>
      {lead}{' '}
      <DocLink url={TERMS_URL} label="Terms of Use" className={linkClassName} /> and{' '}
      <DocLink url={PRIVACY_URL} label="Privacy Policy" className={linkClassName} />.
    </>
  )
}

const noop = () => {}

/**
 * One-time consent for accounts with no users.terms_accepted_at. It cannot be
 * dismissed: Agree records consent, Sign out is the only other way out.
 */
function TermsGate() {
  const navigate = useNavigate()
  const { user, logOut } = useAuth()
  const userId = user?.id ?? null
  const [needed, setNeeded] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setNeeded(false)
    setError(null)
    if (!userId) return undefined
    let alive = true
    getAccountStatus().then((status) => {
      if (alive && status && !status.terms_accepted_at) setNeeded(true)
    })
    return () => {
      alive = false
    }
  }, [userId])

  const handleAgree = useCallback(async () => {
    if (busy) return
    setBusy('agree')
    setError(null)
    try {
      await acceptTerms()
      setNeeded(false)
    } catch (err) {
      console.error('[terms] accept failed:', err)
      setError("Couldn't save that. Check your connection and try again.")
    } finally {
      setBusy(null)
    }
  }, [busy])

  const handleSignOut = useCallback(async () => {
    if (busy) return
    setBusy('signout')
    try {
      await logOut()
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('[terms] sign-out failed:', err)
      setError("Couldn't sign out. Try again.")
    } finally {
      setBusy(null)
    }
  }, [busy, logOut, navigate])

  return (
    <CenteredModal
      isOpen={needed && !!userId}
      onClose={noop}
      dismissOnBackdrop={false}
      ariaLabel="Terms of Use and Privacy Policy"
      maxWidth={360}
    >
      <div className="cm-scroll terms-gate">
        <h2 className="terms-gate__title text-title">Before you keep going</h2>
        <p className="terms-gate__body text-body">
          Checkpoint is for sharing what you play. Hateful, harassing or sexual
          content isn&rsquo;t allowed, reported posts are reviewed, and accounts
          that break the rules lose the ability to post.
        </p>
        <p className="terms-gate__body text-body">
          <TermsSentence lead="To keep using Checkpoint, agree to the" />
        </p>
        {error && (
          <p className="form-field__error" role="alert">{error}</p>
        )}
        <div className="terms-gate__actions">
          <SubmitButton
            type="button"
            onClick={handleAgree}
            loading={busy === 'agree'}
            disabled={busy === 'signout'}
          >
            Agree
          </SubmitButton>
          <SecondaryButton onClick={handleSignOut} disabled={busy !== null}>
            Sign out
          </SecondaryButton>
        </div>
      </div>
    </CenteredModal>
  )
}

export default TermsGate
