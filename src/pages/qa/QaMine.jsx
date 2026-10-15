import { useEffect, useRef } from 'react'
import DiscoverSubHeader from '../../components/explore/DiscoverSubHeader'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { qaMarkInboxSeen, qaMine, qaMineKey } from '../../services/qaService'
import { QaCoverRows } from './QaPlaceholders'
import './qa.css'

export default function QaMine() {
  const { user } = useAuth()
  const key = qaMineKey(user?.id)
  const { data, error } = useCachedResource(key, qaMine, { enabled: !!user?.id })
  const pending = data === undefined && !error
  const marked = useRef(false)

  // Opening the inbox clears the dot, once the list has actually returned.
  useEffect(() => {
    if (data == null || marked.current) return undefined
    marked.current = true
    qaMarkInboxSeen()
    return undefined
  }, [data])

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <DiscoverSubHeader title="Your questions" />
      <div className="qa-push-body">
        <div className="qa-skel" aria-hidden="true">
          <QaCoverRows count={3} />
        </div>
      </div>
    </div>
  )
}
