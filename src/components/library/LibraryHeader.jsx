import React from 'react'

/**
 * Shared Library header: title at left (optional back), actions at right.
 * Own Library passes the search toggle + avatar; the other-user screen
 * passes the search toggle alone and a back button.
 */
export default function LibraryHeader({ title, back = null, actions = null }) {
  return (
    <header className="lib-header">
      {back ? (
        <div className="lib-header-left">
          {back}
          <h1 className="lib-title">{title}</h1>
        </div>
      ) : (
        <h1 className="lib-title">{title}</h1>
      )}
      {actions ? <div className="lib-header-actions">{actions}</div> : null}
    </header>
  )
}
