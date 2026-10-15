import { useNavigate } from 'react-router-dom'
import { Inbox, Plus, Search } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { qaHome, qaHomeKey } from '../../services/qaService'
import { QaCoverRows, QaMostAsked } from './QaPlaceholders'
import './qa.css'

/**
 * Q&A tab root. Skeleton until the real home screen lands. The fetch
 * fills qa:home:{uid}, which is what the nav dot reads.
 */
export default function QaHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const key = qaHomeKey(user?.id)
  const { data, error } = useCachedResource(key, qaHome, { enabled: !!user?.id })
  const inbox = data?.inbox_has_new === true
  const pending = data === undefined && !error

  return (
    <div className="qa-screen" aria-busy={pending || undefined}>
      <header className="qa-tabhead">
        <h1 className="text-display-l qa-tabhead__title">Q&A</h1>
        <button
          type="button"
          className="qa-icon-btn"
          aria-label={inbox ? 'Your questions, new answers' : 'Your questions'}
          onClick={() => navigate('/qa/mine')}
        >
          <Inbox size={20} aria-hidden="true" />
          {inbox ? <span className="qa-badge-dot" aria-hidden="true" /> : null}
        </button>
        <button type="button" className="qa-ask text-body">
          <Plus size={16} aria-hidden="true" />
          Ask
        </button>
      </header>
      <p className="text-body qa-sub">Answers from players who&apos;ve been there</p>
      <button type="button" className="qa-search text-body" onClick={() => navigate('/qa/search')}>
        <Search size={18} aria-hidden="true" />
        <span>Search any game or question</span>
      </button>
      <div className="qa-skel" aria-hidden="true">
        <QaMostAsked />
        <QaCoverRows count={3} />
      </div>
    </div>
  )
}
