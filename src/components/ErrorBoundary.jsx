import React from 'react'
import { AlertTriangle } from 'lucide-react'
import './ErrorBoundary.css'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
    this._handleTryAgain = this._handleTryAgain.bind(this)
    this._handleGoHome = this._handleGoHome.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info)
    // Sprint 8: forward to Sentry here
  }

  _handleTryAgain() {
    this.setState({ hasError: false, error: null })
  }

  _handleGoHome() {
    this.setState({ hasError: false, error: null })
    // Use window.location so this works even if the Router context is broken
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { error } = this.state
    const isDev = import.meta.env.DEV || import.meta.env.MODE === 'staging'

    return (
      <div className="error-boundary" role="alert" aria-live="assertive">
        <div className="error-boundary__inner">
          <AlertTriangle
            className="error-boundary__icon"
            size={48}
            aria-hidden="true"
          />
          <h2 className="error-boundary__title">Something went wrong.</h2>
          <p className="error-boundary__body">
            Sorry — that wasn&apos;t supposed to happen. Try again, and if it
            keeps happening let us know.
          </p>
          <div className="error-boundary__actions">
            <button
              className="error-boundary__btn error-boundary__btn--primary"
              onClick={this._handleTryAgain}
            >
              Try again
            </button>
            <button
              className="error-boundary__btn error-boundary__btn--secondary"
              onClick={this._handleGoHome}
            >
              Go home
            </button>
          </div>
          {isDev && error?.message && (
            <p className="error-boundary__debug">Error: {error.message}</p>
          )}
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
