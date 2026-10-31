import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import {
  Award,
  Ban,
  Bell,
  Bookmark,
  Check,
  CircleAlert,
  Clock,
  Copy,
  Download,
  Flag,
  Info,
  KeyRound,
  Link2,
  ListMinus,
  ListPlus,
  LogOut,
  Mail,
  Pin,
  PinOff,
  RotateCcw,
  Send,
  Share2,
  Shield,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { toastMotion, TOAST_SWAP } from '../motion/xMotion'
import './Toast.css'

let _addToast = () => {}

/** Line icons a caller can name instead of importing one. */
const ICONS = {
  alert: CircleAlert,
  award: Award,
  ban: Ban,
  bell: Bell,
  bookmark: Bookmark,
  check: Check,
  clock: Clock,
  copy: Copy,
  download: Download,
  flag: Flag,
  info: Info,
  key: KeyRound,
  link: Link2,
  list: ListPlus,
  'list-minus': ListMinus,
  'log-out': LogOut,
  mail: Mail,
  pin: Pin,
  'pin-off': PinOff,
  restore: RotateCcw,
  send: Send,
  share: Share2,
  shield: Shield,
  star: Star,
  trash: Trash2,
  'user-minus': UserMinus,
  'user-plus': UserPlus,
}

// What a toast shows when the caller passes nothing new.
const TYPE_DEFAULTS = {
  success: { tone: 'neutral', icon: Check },
  error: { tone: 'error', icon: CircleAlert },
  badge: { tone: 'badge', icon: Award },
  info: { tone: 'neutral', icon: Info },
}

const TONES = ['saved', 'list', 'neutral', 'error', 'badge']

const DEFAULT_MS = 2200
const LONG_MS = 4000

/**
 * Show a toast notice (one at a time; a new one replaces the current one).
 *
 * @param {string} message - the title. Short, sentence case, no exclamation mark.
 * @param {'success'|'error'|'badge'|'info'} [type='error']
 * @param {number} [duration] - ms. Default 2200; 4000 with an action or for an error.
 *   A duration a caller passes is kept.
 * @param {{ label: string, onClick: () => void } | null} [action] - optional action on the
 *   right (e.g. Undo).
 * @param {React.ComponentType<{ size?: number }> | string | null} [icon] - the line icon in
 *   the left circle: a lucide-react component, or a name from ICONS above. The badge unlock
 *   watcher passes the badge's own icon.
 * @param {{
 *   offsetTop?: number | string,
 *   sub?: string,
 *   image?: string,
 *   tone?: 'saved' | 'list' | 'neutral' | 'error' | 'badge',
 *   onTap?: () => void,
 * }} [options]
 *   `offsetTop` pushes this toast down from its default spot (a number is px, a string is any
 *   CSS length). `sub` is the quieter second line. `image` is a cover URL; it replaces the
 *   icon circle. `tone` picks the circle's color: saved = review green, list = list purple,
 *   neutral, error, badge. Defaults come from `type`. `onTap`, when set, runs after a tap
 *   dismisses the notice.
 */
export function showToast(message, type = 'error', duration = null, action = null, icon = null, options = null) {
  const defaults = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.error
  const tone = TONES.includes(options?.tone) ? options.tone : defaults.tone
  const isError = type === 'error' || tone === 'error'
  const customIcon = typeof icon === 'string' ? ICONS[icon] || null : icon
  _addToast({
    message,
    sub: options?.sub || null,
    image: options?.image || null,
    type,
    tone,
    isError,
    duration: duration ?? (action || isError ? LONG_MS : DEFAULT_MS),
    action,
    icon: customIcon || defaults.icon,
    offsetTop: options?.offsetTop ?? null,
    onTap: typeof options?.onTap === 'function' ? options.onTap : null,
    id: Date.now() + Math.random(),
  })
}

function ToastItem({ toast, onDone, reduced }) {
  const timerRef = useRef(null)
  const isPresent = useIsPresent()
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current)
    onDone()
  }, [onDone])

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, toast.duration)
    return () => clearTimeout(timerRef.current)
  }, [toast.duration, dismiss])

  const handleAction = (e) => {
    e.stopPropagation()
    dismiss()
    toast.action?.onClick()
  }

  const Icon = toast.icon
  const showCover = toast.image && !coverFailed
  const offset = toast.offsetTop
  const style = offset == null
    ? undefined
    : { '--toast-offset-top': typeof offset === 'number' ? `${offset}px` : offset }

  const handleTap = () => {
    dismiss()
    toast.onTap?.()
  }

  return (
    <motion.div
      className={`toast${isPresent ? '' : ' is-leaving'}`}
      style={style}
      role={toast.isError ? 'alert' : 'status'}
      onClick={handleTap}
      {...toastMotion(reduced)}
    >
      {showCover ? (
        <span className="toast-cover" aria-hidden="true">
          <img
            src={toast.image}
            alt=""
            className={coverLoaded ? 'is-loaded' : undefined}
            onLoad={() => setCoverLoaded(true)}
            onError={() => setCoverFailed(true)}
          />
        </span>
      ) : (
        <span className={`toast-lead toast-lead--${toast.tone}`} aria-hidden="true">
          <Icon size={17} strokeWidth={2.2} />
        </span>
      )}
      <span className="toast-text">
        <span className="toast-title">{toast.message}</span>
        {toast.sub && <span className="toast-sub">{toast.sub}</span>}
      </span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
    </motion.div>
  )
}

export default function ToastHost() {
  // One notice at a time. `swap` is true while a newer notice is replacing
  // the current one, so the leaving one crossfades (200) instead of the
  // plain 220 fade-out.
  const [state, setState] = useState({ toast: null, swap: false })
  const { reduced } = useMotionPreference()

  _addToast = useCallback((t) => {
    setState((prev) => ({ toast: t, swap: prev.toast !== null }))
  }, [])

  const removeToast = useCallback((id) => {
    setState((prev) => (prev.toast?.id === id ? { toast: null, swap: false } : prev))
  }, [])

  const { toast } = state

  // The container stays mounted so the last toast can play its exit.
  return createPortal(
    <div className="toast-container">
      <AnimatePresence initial={false} custom={state.swap ? TOAST_SWAP : undefined}>
        {toast && (
          <ToastItem key={toast.id} toast={toast} reduced={reduced} onDone={() => removeToast(toast.id)} />
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
