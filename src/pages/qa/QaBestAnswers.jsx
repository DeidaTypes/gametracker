import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EmptyState from '../../components/EmptyState'
import QaPushBar from './QaPushBar'
import QaQuestionListRow from './QaQuestionListRow'
import { QaCoverRows } from './QaPlaceholders'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { getProfile } from '../../services/profileService'
import { qaBestKey, qaUserBestAnswers } from '../../services/qaService'
import { getUserByUsername } from '../../services/userService'
import { useWarmTopQuestions } from './qaCache'
import { useQaHides } from './qaHides'
import './qa.css'

/**
 * /user/:username/best-answers and /user/id/:userId/best-answers — the
 * questions where this person's answer was picked as best. Pushed from the
 * "{n} best answers" line on Profile; the owner and a visitor see the same
 * list (the RPC applies blocks and report auto-hide for the viewer).
 */

function asList(value) {
  return Array.isArray(value) ? value : []
}

function pickedDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function rowMeta(item) {
  return [item.game_title, pickedDate(item.picked_at)].filter(Boolean).join(' · ')
}

/** Resolves the route to a user id. `failed` is true when there is no such user. */
function useTargetUserId() {
  const { username, userId: paramUserId } = useParams()
  const { user } = useAuth()
  const currentUserId = user?.id || null
  const routeUserId = paramUserId ? decodeURIComponent(paramUserId) : null
  const routeUsername = username ? decodeURIComponent(username) : ''
  const [resolved, setResolved] = useState({ key: null, id: null, failed: false })

  const key = routeUserId ? `id:${routeUserId}` : `name:${routeUsername.toLowerCase()}`

  useEffect(() => {
    if (routeUserId) return undefined
    let cancelled = false

    async function resolve() {
      const local = getProfile()
      const localName = (local?.username || '').toLowerCase()
      if (currentUserId && localName && localName === routeUsername.toLowerCase()) {
        if (!cancelled) setResolved({ key, id: currentUserId, failed: false })
        return
      }
      try {
        const row = routeUsername ? await getUserByUsername(routeUsername) : null
        if (!cancelled) setResolved({ key, id: row?.id || null, failed: !row?.id })
      } catch {
        if (!cancelled) setResolved({ key, id: null, failed: true })
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [key, routeUserId, routeUsername, currentUserId])

  if (routeUserId) return { id: routeUserId, failed: false }
  if (resolved.key !== key) return { id: null, failed: false }
  return { id: resolved.id, failed: resolved.failed }
}

export default function QaBestAnswers() {
  const navigate = useNavigate()
  const hides = useQaHides()
  const target = useTargetUserId()
  const key = qaBestKey(target.id, 'list')
  const load = useCallback(() => qaUserBestAnswers(target.id, 100), [target.id])
  const { data, error, refresh } = useCachedResource(key, load, { enabled: !!target.id })

  const items = useMemo(
    () => asList(data?.items).filter((item) => item?.id && !hides.hasQuestion(item.id)),
    [data, hides],
  )
  useWarmTopQuestions(items.map((item) => item.id))

  const pending = !target.failed && data === undefined && !error

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <QaPushBar onBack={() => navigate(-1)} />
      <div className="qa-push-body">
        <h1 className="text-display-l qa-mine-title">Best answers</h1>

        {pending ? (
          <div aria-hidden="true">
            <QaCoverRows count={3} />
          </div>
        ) : null}

        {target.failed ? (
          <EmptyState size="compact" title="User not found" />
        ) : null}

        {error && data == null && !target.failed ? (
          <EmptyState
            size="compact"
            title="Couldn't load best answers"
            body="Check your connection and try again."
            cta="Try again"
            onCta={() => refresh().catch(() => {})}
            ctaVariant="secondary"
          />
        ) : null}

        {data && items.length === 0 ? (
          <div className="qa-mine-empty">
            <EmptyState size="compact" title="No best answers yet" />
          </div>
        ) : null}

        {data && items.length > 0 ? (
          <div className="qa-group">
            {items.map((item, index) => (
              <div key={item.id}>
                {index > 0 ? <div className="qa-hair" /> : null}
                <QaQuestionListRow item={item} showCover meta={rowMeta(item)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
