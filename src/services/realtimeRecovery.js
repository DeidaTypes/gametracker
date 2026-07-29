/**
 * Realtime — shared subscribe() status handler.
 *
 * Before this existed, most `.channel(...).subscribe()` call sites in the
 * app passed no status callback at all, and the two that did (usePresence,
 * useDmPresence) only acted on `SUBSCRIBED` (to `track()` the join payload).
 * None of them reacted to `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED` — a
 * channel that landed in one of those states stayed dead until some
 * unrelated effect happened to tear it down and rebuild it (e.g. a resume,
 * or a dependency change on the owning component).
 *
 * `subscribeWithRecovery()` is a drop-in replacement for `channel.subscribe(
 * cb)` that adds that missing half: on any of the three recoverable
 * statuses it schedules a `channel.subscribe()` retry with backoff, and
 * resets the backoff the moment a `SUBSCRIBED` lands. Callers keep their
 * own status callback for whatever they need to do per-status (track a
 * presence payload, log, etc.) — this wraps it rather than replacing it.
 *
 * Cleanup: callers MUST invoke the returned `dispose()` function in their
 * effect cleanup, before calling `supabase.removeChannel(channel)`. Without
 * it a pending retry timer could fire `channel.subscribe()` on a channel
 * instance that's already been removed.
 */

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 20000]

const RECOVERABLE_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/**
 * @param {import('@supabase/supabase-js').RealtimeChannel} channel
 * @param {(status: string, err?: Error) => void} [onStatus] Called with
 *   every status the channel reports, in addition to the backoff handling
 *   done here. Optional — omit if the caller only cares about recovery.
 * @param {{ retryDelaysMs?: number[] }} [options]
 * @returns {() => void} dispose — cancels any pending retry. Call this from
 *   effect cleanup before removeChannel().
 */
export function subscribeWithRecovery(channel, onStatus, options = {}) {
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS
  let attempt = 0
  let retryTimer = null
  let disposed = false

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function scheduleRetry() {
    if (disposed || retryTimer !== null) return
    const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]
    attempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (disposed) return
      try {
        channel.subscribe(handleStatus)
      } catch {
        // Channel is already (re)subscribing on this instance — whatever
        // status that settles to will come through handleStatus anyway.
      }
    }, delay)
  }

  function handleStatus(status, err) {
    if (disposed) return
    if (status === 'SUBSCRIBED') {
      attempt = 0
      clearRetry()
    } else if (RECOVERABLE_STATUSES.has(status)) {
      scheduleRetry()
    }
    onStatus?.(status, err)
  }

  channel.subscribe(handleStatus)

  return function dispose() {
    disposed = true
    clearRetry()
  }
}

export default subscribeWithRecovery
