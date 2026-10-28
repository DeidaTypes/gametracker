import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LuCheck, LuPencil, LuTrash2 } from 'react-icons/lu'
import ActionSheet from './ActionSheet'
import { hapticImpact } from '../utils/haptics'

/**
 * ConfirmSheet — the app's one "are you sure?" moment. It replaces the
 * browser's blocking confirm and alert dialogs (the grey iOS system alert
 * with "OK").
 *
 * It is the one menu look (MenuSheet, through ActionSheet) with a title, a
 * one-line message, one destructive (or primary) action, and X / tap outside /
 * drag down / Escape to cancel. A cancelLabel other than "Cancel" ("Keep
 * editing") is shown as a last row.
 *
 * Opening above a popup. The sheet normally sits at z-index 1020, under
 * CenteredModal's .cm-overlay (1100). `layer="top"` lifts it to 1120/1121 so
 * it opens over a popup, and `keepFocus` leaves the popup's field focused:
 * the sheet never takes focus, its buttons do not blur the field, and a tap
 * inside it does not run the global tap-to-dismiss-keyboard handler. If the
 * keyboard is up when it opens it stays up, the sheet sits above it (the sheet
 * already lifts by --keyboard-inset), and "Keep editing" lands back in the
 * draft with the keyboard where it was.
 *
 * Haptic: a destructive confirm is one Medium tap (delete / remove / discard).
 * Cancelling is silent.
 *
 * Props:
 *   isOpen        boolean
 *   title         string — "Discard this review?"
 *   message       string — one line
 *   confirmLabel  string — "Discard" / "Delete"
 *   cancelLabel   string — "Keep editing" / "Cancel" (default "Cancel")
 *   destructive   boolean (default true)
 *   onConfirm     () => void
 *   onCancel      () => void — X, "Keep editing" row, backdrop tap, swipe down, Escape
 */
function ConfirmSheet({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}) {
  // The sheet runs onClose() and then the item's onClick() for the same tap.
  // Hold the cancel for a microtask so a confirm tap can cancel it first.
  const cancelPendingRef = useRef(false)

  const handleClose = useCallback(() => {
    cancelPendingRef.current = true
    queueMicrotask(() => {
      if (!cancelPendingRef.current) return
      cancelPendingRef.current = false
      onCancel?.()
    })
  }, [onCancel])

  const handleConfirm = useCallback(() => {
    cancelPendingRef.current = false
    if (destructive) hapticImpact('Medium')
    onConfirm?.()
  }, [destructive, onConfirm])

  useEffect(() => {
    if (!isOpen) return undefined

    // Window capture runs before the document-level handlers in
    // services/keyboardInset.js, which hide the keyboard on any tap outside
    // the field. Taps on the sheet are not "outside" the draft. The drag
    // handle is left alone so swipe-down still starts.
    const onPointerDown = (e) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (!target.closest('.menu-sheet-root--top')) return
      if (target.closest('.menu-sheet__drag-zone')) return
      e.stopPropagation()
    }

    // Escape closes the sheet only, not the popup underneath it.
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      handleClose()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [isOpen, handleClose])

  return (
    <ActionSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      subtitle={message}
      layer="top"
      keepFocus
      cancelLabel={cancelLabel}
      cancelIcon={cancelLabel === 'Keep editing' ? <LuPencil size={18} /> : undefined}
      items={[
        {
          icon: destructive ? <LuTrash2 size={18} /> : <LuCheck size={18} />,
          label: confirmLabel,
          destructive,
          onClick: handleConfirm,
        },
      ]}
    />
  )
}

/** Copy for "Discard this {thing}?" — drafts being abandoned. */
export function discardConfirm(thing, { editing = false } = {}) {
  return editing
    ? {
        title: 'Discard changes?',
        message: 'Your changes will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      }
    : {
        title: `Discard this ${thing}?`,
        message: 'Your draft will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      }
}

/** Copy for "Delete this {thing}?" — saved content being removed. */
export function deleteConfirm(thing) {
  return {
    title: `Delete this ${thing}?`,
    message: "This can't be undone.",
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    destructive: true,
  }
}

/**
 * useConfirmSheet — promise-style stand-in for the browser's confirm dialog.
 *
 *   const [confirm, confirmSheet] = useConfirmSheet()
 *   if (!(await confirm(discardConfirm('review')))) return
 *   ...
 *   return (<>{...}{confirmSheet}</>)   // render as a SIBLING of the popup
 *
 * Render the sheet outside the popup it opens over so its taps do not bubble
 * through React to the popup's own handlers.
 */
export function useConfirmSheet() {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState(null)
  const settleRef = useRef(null)

  const settle = useCallback((value) => {
    const resolve = settleRef.current
    settleRef.current = null
    setOpen(false)
    resolve?.(value)
  }, [])

  const confirm = useCallback((next) => {
    // A new request replaces one that is still waiting (counts as cancelled).
    settleRef.current?.(false)
    return new Promise((resolve) => {
      settleRef.current = resolve
      setOptions(next)
      setOpen(true)
    })
  }, [])

  // Resolve a pending request if the host unmounts, so no await hangs.
  useEffect(
    () => () => {
      settleRef.current?.(false)
      settleRef.current = null
    },
    [],
  )

  const sheet = (
    <ConfirmSheet
      isOpen={open}
      {...(options || {})}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return [confirm, sheet]
}

export default ConfirmSheet
