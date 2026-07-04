import React from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'

// TODO(auth): No password-reset flow exists yet (no
// supabase.auth.resetPasswordForEmail() call, no reset-confirmation screen).
// This stub exists so the Log In screen's "Forgot?" link has somewhere real
// to go. Wiring up the actual email-based reset flow is deferred to its own
// prompt — see LogIn rebuild deliverable for details.
function ForgotPassword() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-subtitle">
            Password recovery is coming soon. For now, contact support if
            you&rsquo;re locked out of your account.
          </p>
        </header>

        <p className="auth-footer">
          <Link to="/login" className="auth-link">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ForgotPassword
