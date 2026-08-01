import React, { forwardRef } from 'react'
import '../styles/keyboard.css'

/**
 * KeyboardAwareView — the single wrapper every typable surface uses so that
 * a comment box, a DM box, a bottom sheet and a search field all lift the
 * same amount, on the same curve, at the same time.
 *
 * It is deliberately thin: all of the behaviour lives in the shared classes
 * in src/styles/keyboard.css, driven by the `--keyboard-inset` variable that
 * src/services/keyboardInset.js writes on `keyboardWillShow`. Rendering a
 * class rather than an inline style keeps the whole animation on the
 * compositor — no React render happens during the keyboard transition.
 *
 * Modes — pick the one matching how the surface is positioned:
 *
 *   composer  Fixed bar anchored above the tab bar (DM / comment composers).
 *             Lifts by keyboard height minus the tab-bar space it already
 *             occupies.
 *
 *   sheet     Bottom sheet anchored to the viewport bottom. Lifts by the
 *             full keyboard height, falling back to the home-indicator safe
 *             area when the keyboard is down.
 *
 *   modal     Centered dialog. Shifts up by half the keyboard height to
 *             re-center in the visible area and caps its height so overflow
 *             scrolls rather than hiding behind the keyboard.
 *
 *   scroll    In-flow form or scroll container. Reserves bottom padding so
 *             the focused field can be scrolled clear of the keyboard.
 *             WKWebView cannot do this on its own here — the Capacitor
 *             plugin zeroes the scroll view contentInset on every keyboard
 *             event, so without reserved space there is nowhere to scroll.
 *
 * Props:
 *   mode       'composer' | 'sheet' | 'modal' | 'scroll'  (default 'scroll')
 *   as         element type to render (default 'div')
 *   reserveNav for mode="scroll": also reserve tab-bar space at rest, using
 *              whichever of the two is larger
 *   className  extra classes, appended after the keyboard classes
 */

const MODE_CLASSES = {
  composer: 'kb-lift',
  sheet: 'kb-sheet-lift',
  modal: 'kb-modal-lift kb-modal-fit',
  scroll: 'kb-scroll-pad',
}

const KeyboardAwareView = forwardRef(function KeyboardAwareView(
  { mode = 'scroll', as: Component = 'div', reserveNav = false, className = '', children, ...rest },
  ref,
) {
  let base = MODE_CLASSES[mode] || MODE_CLASSES.scroll
  if (mode === 'scroll' && reserveNav) base = 'kb-scroll-pad-nav'

  const classes = `${base} ${className}`.trim()

  return (
    <Component ref={ref} className={classes} {...rest}>
      {children}
    </Component>
  )
})

export default KeyboardAwareView
