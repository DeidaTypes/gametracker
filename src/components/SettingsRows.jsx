import React from 'react'
import { LuChevronRight } from 'react-icons/lu'
import IOSSwitch from './IOSSwitch'

function SettingsGroup({ id, title, footer = null, icons = false, children }) {
  const className = icons ? 'settings-group settings-group--icons' : 'settings-group'
  return (
    <section id={id} className={className}>
      {title && <h2 className="settings-group__title text-caption">{title}</h2>}
      <div className="settings-group__rows">{children}</div>
      {footer && <p className="settings-group__footer text-caption">{footer}</p>}
    </section>
  )
}

function SettingsRow({
  label,
  value,
  onClick,
  icon = null,
  trailing = null,
  destructive = false,
  disabled = false,
}) {
  const Element = onClick ? 'button' : 'div'
  const className = [
    'settings-row',
    onClick ? 'settings-row--tappable' : '',
    destructive ? 'settings-row--destructive' : '',
    icon ? 'settings-row--icon' : '',
    disabled ? 'settings-row--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showChevron = Boolean(onClick) && !trailing && !destructive

  return (
    <Element
      type={onClick ? 'button' : undefined}
      className={className}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
    >
      {icon && (
        <span className="settings-row__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="settings-row__label text-body">{label}</span>
      {value !== undefined && value !== null && (
        <span className="settings-row__value text-caption">{value}</span>
      )}
      {trailing && <span className="settings-row__trailing">{trailing}</span>}
      {showChevron && (
        <span className="settings-row__chevron" aria-hidden="true">
          <LuChevronRight size={16} strokeWidth={1.75} />
        </span>
      )}
    </Element>
  )
}

/**
 * Whole-row switch. The row owns role="switch"; the visual toggle is
 * presentational so there is only one switch in the accessibility tree.
 */
function SettingsSwitchRow({ label, checked, onChange }) {
  return (
    <button
      type="button"
      className="settings-row settings-row--tappable settings-row--switch"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-row__label text-body">{label}</span>
      <span className="settings-row__trailing">
        <IOSSwitch checked={checked} onChange={() => {}} label={label} presentational />
      </span>
    </button>
  )
}

export { SettingsGroup, SettingsRow, SettingsSwitchRow }
