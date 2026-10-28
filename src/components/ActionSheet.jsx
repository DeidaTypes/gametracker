import React from 'react'
import MenuSheet from './MenuSheet'

/**
 * ActionSheet — the older sheet API, now a thin adapter onto MenuSheet so
 * every slide-up menu in the app has one look (handle, X, 48pt rows, 18px
 * line icons, hairlines from the label). Callers keep their props.
 *
 * Props:
 *   isOpen       – boolean
 *   onClose      – () => void
 *   title        – optional string, left of the X (sentence case)
 *   subtitle     – optional sentence under the title (2 lines max)
 *   items        – Array<Item>, where Item is one of:
 *                    { divider: true }   — a group break
 *                    { heading: string } — non-interactive section label
 *                    {
 *                      label, onClick, disabled?, destructive?,
 *                      icon?    – bare 18px line icon. Tiles and tones are
 *                                 gone; a row without an icon keeps its
 *                                 label at the gutter.
 *                      detail?  – second line under the label
 *                    }
 *                  label may be a string or JSX element.
 *   layer        – 'top' lifts the sheet above CenteredModal (.cm-overlay, 1100)
 *                  so it can open over a popup (see ConfirmSheet)
 *   keepFocus    – never move focus into the sheet or off the field beneath
 *                  it, so a popup's keyboard stays up (see ConfirmSheet)
 *   cancelLabel  – there is no Cancel row any more: the X, a tap outside,
 *                  dragging down and Escape all close the sheet. A cancelLabel
 *                  other than "Cancel" (e.g. "Keep editing") is a real choice,
 *                  so it is added as the last row, a normal row.
 *   cancelIcon   – optional icon for that last row
 *
 * Ignored on purpose (they belonged to the old look): `plain`, item `tone`,
 * item `chevron`, and the uppercase title style.
 */
function ActionSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  layer = 'base',
  keepFocus = false,
  items = [],
  cancelLabel = 'Cancel',
  cancelIcon,
}) {
  const rows = items.map((item) => {
    if (item.divider) return { divider: true }
    if (item.heading) return { heading: item.heading }
    return {
      icon: item.icon,
      label: item.label,
      detail: item.detail,
      destructive: item.destructive,
      disabled: item.disabled,
      selected: item.selected,
      onClick: item.onClick,
    }
  })

  if (cancelLabel && cancelLabel !== 'Cancel') {
    // MenuSheet closes the sheet when any row is tapped, so this row needs
    // no handler of its own.
    rows.push({ icon: cancelIcon, label: cancelLabel })
  }

  return (
    <MenuSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      layer={layer}
      keepFocus={keepFocus}
      items={rows}
    />
  )
}

export default ActionSheet
