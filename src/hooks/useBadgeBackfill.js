import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { backfillMyBadges } from '../services/badgeService'

const IDLE = { settled: false, grants: [], alreadyDone: false, failed: false }

/**
 * Runs the one-time badge backfill for the signed-in user.
 *
 * "First launch after badges went live" is detected server-side by
 * users.badge_backfill_version (see backfill_my_badges). That marker
 * survives reinstall; this hook never re-shows a summary once it is 1.
 *
 * Mounted by both the unlock watcher (so it waits) and the summary
 * screen. The service promise is deduped per user, so two callers
 * share one RPC.
 */
export function useBadgeBackfill() {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id || null
  const [state, setState] = useState(IDLE)

  useEffect(() => {
    if (authLoading) return undefined

    if (!userId) {
      setState({ settled: true, grants: [], alreadyDone: true, failed: false })
      return undefined
    }

    let cancelled = false
    setState(IDLE)

    backfillMyBadges(userId).then((result) => {
      if (cancelled) return
      setState({
        settled: true,
        grants: result.grants || [],
        alreadyDone: !!result.alreadyDone,
        failed: !!result.failed,
      })
    })

    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  return state
}
