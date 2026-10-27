import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { toastMotion } from '../motion/xMotion'
import './Toast.css'

let _addToast = () => {}

/**
 * Show a toast notification.
 *
 * @param {string} message
 * @param {'success'|'error'|'badge'} type
 * @param {number} [duration=3500]
 * @param {{ label: string, onClick: () => void } | null} [action] - optional action link (e.g. Undo)
 * @param {React.ComponentType<{ size?: number }> | null} [icon] - optional lucide-react icon
 *   component. When provided it replaces the default svg glyph — used by
 *   the badge unlock watcher so each celebration shows its own badge icon.
 * @param {{ offsetTop?: number | string }} [options] - optional.
 *   `offsetTop` pushes this toast down from its default spot (a number is px,
 *   a string is any CSS length, e.g. 'calc(var(--space-48) + var(--space-4))').
 *   Omit it and the toast sits where it always has.
 */
export function showToast(message, type = 'error', duration = 3500, action = null, icon = null, options = null) {
  _addToast({
    message,
    type,
    duration,
    action,
    icon,
    offsetTop: options?.offsetTop ?? null,
    id: Date.now() + Math.random(),
  })
}

function ToastItem({ toast, onDone, reduced }) {
  const timerRef = useRef(null)

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current)
    onDone()
  }, [onDone])

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, toast.duration)
    return () => clearTimeout(timerRef.current)
  }, [toast.duration, dismiss])

  const handleAction = () => {
    dismiss()
    toast.action?.onClick()
  }

  const CustomIcon = toast.icon
  const offset = toast.offsetTop
  const style = offset == null
    ? undefined
    : { '--toast-offset-top': typeof offset === 'number' ? `${offset}px` : offset }

  return (
    <motion.div
      className={`toast toast--${toast.type}`}
      style={style}
      role="alert"
      {...toastMotion(reduced)}
    >
      {CustomIcon ? (
        <span className="toast-icon" aria-hidden="true">
          <CustomIcon size={18} />
        </span>
      ) : (
        <svg className="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {toast.type === 'error' ? (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </>
          ) : (
            <>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </>
          )}
        </svg>
      )}
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button className="toast-action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
    </motion.div>
  )
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([])
  const { reduced } = useMotionPreference()

  _addToast = useCallback((t) => {
    setToasts((prev) => [...prev, t])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // The container stays mounted so the last toast can play its exit.
  return createPortal(
    <div className="toast-container">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} reduced={reduced} onDone={() => removeToast(t.id)} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  )
}
