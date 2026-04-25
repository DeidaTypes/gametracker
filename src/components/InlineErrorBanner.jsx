import React from 'react'
import './InlineErrorBanner.css'

function InlineErrorBanner({ message, onRetry }) {
  return (
    <div className="inline-error-banner" role="alert">
      <svg
        className="inline-error-banner__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="inline-error-banner__message">{message}</span>
      {onRetry && (
        <button
          className="inline-error-banner__retry"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export default InlineErrorBanner
