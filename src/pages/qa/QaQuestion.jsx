import { useParams } from 'react-router-dom'
import DiscoverSubHeader from '../../components/explore/DiscoverSubHeader'
import { useCachedResource } from '../../hooks/useCachedResource'
import { qaQuestion, qaQuestionKey } from '../../services/qaService'
import { QaPlainRows, QaQuestionBlock } from './QaPlaceholders'
import './qa.css'

export default function QaQuestion() {
  const { questionId } = useParams()
  const key = qaQuestionKey(questionId)
  const { data, error } = useCachedResource(key, () => qaQuestion(questionId), {
    enabled: !!questionId,
  })
  const pending = data === undefined && !error

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <DiscoverSubHeader title="Question" />
      <div className="qa-push-body">
        <div className="qa-skel" aria-hidden="true">
          <QaQuestionBlock />
          <QaPlainRows count={3} />
        </div>
      </div>
    </div>
  )
}
