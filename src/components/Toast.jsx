import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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
 */
export function showToast(message, type = 'error', duration = 3500, action = null, icon = null) {
  _addToast({ message, type, duration, action, icon, id: Date.now() + Math.random() })
}

function ToastItem({ toast, onDone }) {
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef(null)

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current)
    setExiting(true)
    setTimeout(onDone, 220)
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

  return (
    <div className={`toast toast--${toast.type}${exiting ? ' toast--exiting' : ''}`} role="alert">
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
    </div>
  )
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  _addToast = useCallback((t) => {
    setToasts((prev) => [...prev, t])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (toasts.length === 0) return null

  return createPortal(
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />
      ))}
    </div>,
    document.body
  )
}
