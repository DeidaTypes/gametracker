import React from 'react'
import { showToast } from './Toast'
import './ErrorBoundary.css'

function firstStackLine(error) {
  const lines = String(error?.stack || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const frame = lines.find((line) => line.startsWith('at ') || line.includes('@'))
  return frame || ''
}

function copyWithExecCommand(text) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.focus()
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('copy failed')
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyWithExecCommand(text))
  }
  return Promise.resolve().then(() => copyWithExecCommand(text))
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
    this._handleTryAgain = this._handleTryAgain.bind(this)
    this._handleCopyDetails = this._handleCopyDetails.bind(this)
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

  _handleCopyDetails() {
    const { error } = this.state
    const message = error?.message || 'Unknown error'
    const stackLine = firstStackLine(error)
    const path = `${window.location.pathname}${window.location.search}`
    const text = [message, stackLine, path].filter(Boolean).join('\n')
    copyText(text)
      .then(() => {
        showToast('Details copied', 'success', null, null, 'copy')
      })
      .catch(() => {})
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
          <div className="error-boundary__scene" aria-hidden="true">
            <div className="error-boundary__glow" />
            <svg
              className="error-boundary__illustration"
              viewBox="0 0 220 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <ellipse
                className="error-boundary__shadow"
                cx="110"
                cy="178"
                rx="70"
                ry="8"
              />

              <path
                className="error-boundary__antenna"
                d="M96 46 L86 20"
              />
              <path
                className="error-boundary__antenna"
                d="M124 46 L134 20"
              />
              <circle className="error-boundary__antenna-tip" cx="86" cy="18" r="3.5" />
              <circle className="error-boundary__antenna-tip" cx="134" cy="18" r="3.5" />

              <rect
                className="error-boundary__stand"
                x="100"
                y="136"
                width="20"
                height="9"
                rx="2"
              />

              <rect
                className="error-boundary__tv-body"
                x="54"
                y="44"
                width="112"
                height="92"
                rx="18"
              />
              <rect
                className="error-boundary__tv-screen"
                x="68"
                y="58"
                width="84"
                height="62"
                rx="10"
              />

              <rect className="error-boundary__bar error-boundary__bar--1" x="80" y="74" width="56" height="7" rx="3.5" />
              <rect className="error-boundary__bar error-boundary__bar--2" x="80" y="88" width="40" height="7" rx="3.5" />
              <rect className="error-boundary__bar error-boundary__bar--3" x="80" y="102" width="62" height="7" rx="3.5" />

              <path
                className="error-boundary__spark"
                d="M16 138 L18.2 144.8 L25 147 L18.2 149.2 L16 156 L13.8 149.2 L7 147 L13.8 144.8 Z"
              />

              <g className="error-boundary__controller">
                <rect
                  className="error-boundary__controller-body"
                  x="26"
                  y="150"
                  width="64"
                  height="28"
                  rx="14"
                />
                <path
                  className="error-boundary__controller-detail"
                  d="M42 164 h8 M46 160 v8"
                />
                <circle className="error-boundary__controller-detail" cx="72" cy="160" r="2.6" />
                <circle className="error-boundary__controller-detail" cx="80" cy="167" r="2.6" />
              </g>
            </svg>
          </div>

          <h2 className="error-boundary__title">Dropped a frame.</h2>
          <p className="error-boundary__body">
            Your progress is safe — try again, or head home.
          </p>

          <div className="error-boundary__actions">
            <button
              className="error-boundary__btn error-boundary__btn--primary"
              onClick={this._handleTryAgain}
            >
              Try again
            </button>
            <button
              type="button"
              className="error-boundary__copy text-caption"
              onClick={this._handleCopyDetails}
            >
              Copy details
            </button>
            <button
              className="error-boundary__btn error-boundary__btn--secondary"
              onClick={this._handleGoHome}
            >
              Go home
            </button>
          </div>

          {isDev && error?.message && (
            <p className="error-boundary__debug">{error.message}</p>
          )}
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
