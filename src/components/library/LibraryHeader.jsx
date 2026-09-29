import React from 'react'
import { LuChevronLeft } from 'react-icons/lu'

/**
 * Shared Library header: optional back + title at left, actions at right.
 * Both the signed-in Library and the other-user screen pass the search
 * toggle as `actions` and `onBack` for the same chevron affordance.
 */
export default function LibraryHeader({ title, onBack = null, actions = null }) {
  return (
    <header className="lib-header">
      {onBack ? (
        <div className="lib-header-left">
          <button
            type="button"
            className="lib-back"
            onClick={onBack}
            aria-label="Go back"
          >
            <LuChevronLeft size={22} aria-hidden="true" />
          </button>
          <h1 className="lib-title">{title}</h1>
        </div>
      ) : (
        <h1 className="lib-title">{title}</h1>
      )}
      {actions ? <div className="lib-header-actions">{actions}</div> : null}
    </header>
  )
}
