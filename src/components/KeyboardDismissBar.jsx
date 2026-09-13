import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LuChevronDown } from 'react-icons/lu'
import {
  hideKeyboard,
  isKeyboardOpen,
} from '../services/keyboardInset'
import { useKeyboardOpen } from '../hooks/useKeyboardInset'
import '../styles/keyboard.css'

function isTypable(el) {
  if (!el || el.nodeType !== 1) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

/**
 * Keep the keyboard up when the tap is still "on the field": the input
 * itself, its immediate chrome (clear / eye / stepper), or a labelled
 * control marked data-kb-keep. Taps anywhere else hide the keyboard
 * without calling any modal onClose.
 */
function tapKeepsKeyboard(target) {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-kb-dismiss-bar]')) return true
  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true
  }

  const active = document.activeElement
  if (!isTypable(active)) return false

  const keep = active.closest('[data-kb-keep]')
  if (keep && keep.contains(target)) return true

  const chrome = active.parentElement
  if (chrome && chrome.contains(target)) return true

  const label = target.closest('label')
  if (label && active.id && label.htmlFor === active.id) return true

  return false
}

/**
 * Global keyboard-dismiss accessory. One instance at the app root covers
 * every text surface — composers, search, auth, sheets — instead of a
 * Done button forked into each header (those existing Dones save or
 * close the surface; they do not mean "put the keyboard down").
 */
export default function KeyboardDismissBar() {
  const open = useKeyboardOpen()

  useEffect(() => {
    const onPointerDown = (e) => {
      if (!isKeyboardOpen()) return
      if (tapKeepsKeyboard(e.target)) return
      hideKeyboard()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  if (typeof document === 'undefined') return null

  const dismiss = (e) => {
    e.preventDefault()
    e.stopPropagation()
    hideKeyboard()
  }

  return createPortal(
    <div
      className="kb-dismiss-bar"
      data-kb-dismiss-bar
      aria-hidden={open ? undefined : true}
    >
      <button
        type="button"
        className="kb-dismiss-bar__btn"
        aria-label="Dismiss keyboard"
        tabIndex={open ? 0 : -1}
        onPointerDown={dismiss}
        onClick={dismiss}
      >
        <LuChevronDown size={18} aria-hidden="true" />
        <span className="text-label">Done</span>
      </button>
    </div>,
    document.body,
  )
}
