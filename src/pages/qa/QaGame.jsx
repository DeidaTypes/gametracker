import { useParams } from 'react-router-dom'
import DiscoverSubHeader from '../../components/explore/DiscoverSubHeader'
import { useCachedResource } from '../../hooks/useCachedResource'
import { qaGame, qaGameKey } from '../../services/qaService'
import { QaPlainRows } from './QaPlaceholders'
import './qa.css'

// Filter and sort stay in the screen. They are not URL state.
const FILTER = 'answered'
const SORT = 'helpful'

export default function QaGame() {
  const { igdbId } = useParams()
  const key = igdbId ? qaGameKey(igdbId, FILTER, SORT) : null
  const { data, error } = useCachedResource(
    key,
    () => qaGame(igdbId, { filter: FILTER, sort: SORT }),
    { enabled: !!igdbId }
  )
  const pending = data === undefined && !error

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <DiscoverSubHeader title="Questions" />
      <div className="qa-push-body">
        <div className="qa-skel" aria-hidden="true">
          <QaPlainRows count={4} />
        </div>
      </div>
    </div>
  )
}
