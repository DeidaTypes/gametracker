import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { useSettingsHighlight } from '../hooks/useSettingsHighlight'
import './SettingsHeader.css'

/**
 * Back within the in-app stack. A deep link has no prior entry
 * (history idx 0), so sub-screens fall back to the settings hub
 * instead of leaving the app.
 */
function goBack(navigate, pathname) {
  const idx = window.history.state?.idx
  if (typeof idx === 'number' && idx > 0) {
    navigate(-1)
    return
  }
  if (pathname !== '/settings') navigate('/settings')
}

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      className="settings-header__back"
      onClick={onClick}
      aria-label="Go back"
    >
      <LuChevronLeft size={22} strokeWidth={1.6} aria-hidden="true" />
    </button>
  )
}

/**
 * Shared settings header.
 * variant "large" — hub: back row, then a left-aligned Display L title.
 * variant "sub" — centered Body title with the back button on the left.
 */
function SettingsHeader({ title, variant = 'sub', titleCollapsed = false, inChrome = false }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useSettingsHighlight()
  const onBack = () => goBack(navigate, pathname)

  if (variant === 'large') {
    const headerClass = [
      'settings-header',
      'settings-header--large',
      inChrome ? 'settings-header--in-chrome' : '',
    ].filter(Boolean).join(' ')

    return (
      <header className={headerClass}>
        <div className="settings-header__bar">
          <BackButton onClick={onBack} />
        </div>
        <div className={`settings-header__title-slot${titleCollapsed ? ' is-collapsed' : ''}`}>
          <div className="settings-header__title-clip">
            <h1 className="settings-header__large text-display-l">{title}</h1>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="settings-header settings-header--sub">
      <BackButton onClick={onBack} />
      <h1 className="settings-header__title text-body">{title}</h1>
      <span className="settings-header__spacer" aria-hidden="true" />
    </header>
  )
}

export default SettingsHeader
