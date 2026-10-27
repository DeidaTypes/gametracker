import React, { Suspense, useSyncExternalStore } from 'react'
import { JournalComposer, ReviewComposer } from '../../routes/lazyPages'

/**
 * Write review / Journal box, mounted once at the app level (next to
 * QaComposerHost) and opened by a function call. It renders the composer's
 * CenteredModal over whatever page is current: no navigate(), no URL change,
 * no history entry, so the page underneath never remounts and keeps its
 * scroll position.
 *
 *   openReviewComposer({ game, editReview?, onSaved? })
 *   openJournalComposer({ game, onSaved? })
 *
 * Save and Cancel both end in the composer's onClose, which clears the
 * session here after the fade-out. The page underneath updates in place
 * through the same window events it already listens for (`reviewAdded`,
 * `journalEntryAdded`).
 *
 * iOS edge swipe: the box is a portal over a full-screen overlay, and the
 * page's SwipeBackWrapper listens on the page element only, so an edge swipe
 * while the box is open does not reach the page. Same as QaComposerHost.
 */

let session = null
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSession() {
  return session
}

function getOpen() {
  return session !== null
}

function start(kind, props) {
  // One box at a time. A second tap while one is open (or still fading out)
  // is ignored rather than stacking a second box.
  if (session) return
  session = { kind, openedAt: Date.now(), props }
  emit()
}

function closeSession(openedAt) {
  if (!session || session.openedAt !== openedAt) return
  session = null
  emit()
}

export function openReviewComposer({ game = null, gameId = null, editReview = null, onSaved } = {}) {
  start('review', { game, gameId, editReview, onSaved })
}

export function openJournalComposer({ game = null, gameId = null, onSaved } = {}) {
  start('journal', { game, gameId, onSaved })
}

/** True while a review or journal box is on screen (including its fade-out). */
export function useComposerOpen() {
  return useSyncExternalStore(subscribe, getOpen)
}

export default function ComposerHost() {
  const current = useSyncExternalStore(subscribe, getSession)
  if (!current) return null

  const Composer = current.kind === 'review' ? ReviewComposer : JournalComposer
  return (
    <Suspense fallback={null}>
      <Composer
        key={current.openedAt}
        {...current.props}
        onClose={() => closeSession(current.openedAt)}
      />
    </Suspense>
  )
}
