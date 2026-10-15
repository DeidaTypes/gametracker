import { useState } from 'react'
import { Search } from 'lucide-react'
import DiscoverSubHeader from '../../components/explore/DiscoverSubHeader'
import { useCachedResource } from '../../hooks/useCachedResource'
import { qaSearch, qaSearchKey } from '../../services/qaService'
import { QaCoverRows } from './QaPlaceholders'
import './qa.css'

export default function QaSearch() {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const key = trimmed ? qaSearchKey(null, trimmed) : null
  const { data, error } = useCachedResource(key, () => qaSearch(trimmed), {
    enabled: !!trimmed,
  })
  const pending = !!trimmed && data === undefined && !error

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <DiscoverSubHeader title="Search" />
      <div className="qa-push-body">
        <label className="qa-search qa-search--field text-body">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any game or question"
            aria-label="Search any game or question"
            enterKeyHint="search"
          />
        </label>
        <div className="qa-skel" aria-hidden="true">
          <QaCoverRows count={3} />
        </div>
      </div>
    </div>
  )
}
