import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Inbox, MessageCircle, MessageCircleQuestion, Plus, Search, WifiOff } from 'lucide-react'
import PullToRefresh from '../../components/PullToRefresh'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaHome, qaHomeKey } from '../../services/qaService'
import { openQaAsk } from './qaComposer'
import QaQuestionListRow from './QaQuestionListRow'
import { QaCoverRows, QaMostAsked } from './QaPlaceholders'
import { formatGamePlatform } from './qaFormat'
import { useOnline } from './useOnline'
import './qa.css'

/**
 * Answered | Unanswered is screen state, remembered for this JS session.
 * It is not in the URL, so a tab switch never reloads the board.
 */
let rememberedFilter = 'answered'

function asList(value) {
  return Array.isArray(value) ? value : []
}

function OfflineBanner() {
  return (
    <div className="qa-banner" role="status">
      <WifiOff size={18} aria-hidden="true" />
      <span>You&apos;re offline. Showing questions you already loaded.</span>
    </div>
  )
}

function ListError({ onRetry, offline }) {
  return (
    <div className="qa-list-error" role="alert">
      <p className="text-body">{offline ? 'You\u2019re offline.' : 'Couldn\u2019t load questions.'}</p>
      <button type="button" className="qa-retry text-caption" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function EmptyBoard() {
  return (
    <div className="qa-empty">
      <span className="qa-empty__icon" aria-hidden="true">
        <MessageCircleQuestion size={40} strokeWidth={1.6} />
      </span>
      <h2 className="text-title qa-empty__title">Ask the first question</h2>
      <p className="text-body qa-empty__body">
        Stuck on a boss, a puzzle or a build? Players who&apos;ve played it can help.
      </p>
      <button type="button" className="qa-btn-block text-body" onClick={() => openQaAsk()}>
        <Plus size={16} aria-hidden="true" />
        Ask a question
      </button>
    </div>
  )
}

function MostAsked({ games }) {
  const navigate = useNavigate()
  return (
    <section className="qa-home-sec">
      <div className="qa-sec-head">
        <h2 className="text-label qa-label">Most asked</h2>
        <button
          type="button"
          className="qa-see text-caption"
          onClick={() => navigate('/qa/search', { state: { browse: 'most-asked' } })}
        >
          See all
        </button>
      </div>
      <div className="qa-most">
        {games.map((game) => {
          const id = game.igdb_game_id
          const src = game.game_cover_image_id
            ? coverUrlFromImageId(game.game_cover_image_id, 'cover_big')
            : null
          const count = Number(game.question_count)
          return (
            <Link key={id} className="qa-most__item" to={`/qa/game/${id}`}>
              <span className="qa-most__cover">
                {src ? <img src={src} alt="" /> : null}
                {Number.isFinite(count) ? (
                  <span className="qa-count-chip">
                    <MessageCircle size={10} strokeWidth={2.6} aria-hidden="true" />
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="qa-most__name text-caption">{game.game_title}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function FilterSwitch({ filter, helpCount, onSelect }) {
  return (
    <div className="qa-seg qa-home-seg" role="tablist" aria-label="Question status">
      <button
        type="button"
        role="tab"
        aria-selected={filter === 'answered'}
        className={`qa-seg__btn text-body${filter === 'answered' ? ' qa-seg__btn--on' : ''}`}
        onClick={() => onSelect('answered')}
      >
        Answered
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={filter === 'unanswered'}
        className={`qa-seg__btn text-body${filter === 'unanswered' ? ' qa-seg__btn--on' : ''}`}
        onClick={() => onSelect('unanswered')}
      >
        Unanswered
        {helpCount > 0 ? <span className="qa-seg__pill">{helpCount}</span> : null}
      </button>
    </div>
  )
}

function QuestionGroup({ items, showCover, showAge }) {
  if (!items.length) return null
  return (
    <div className="qa-group">
      {items.map((item, index) => (
        <div key={item.id}>
          {index > 0 ? <div className="qa-hair" /> : null}
          <QaQuestionListRow
            item={item}
            showCover={showCover}
            showAge={showAge}
            meta={formatGamePlatform(item)}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Q&A tab. One read: qa:home:{uid}. Answered and Unanswered are the
 * same payload, so switching them never refetches.
 */
export default function QaHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const online = useOnline()
  const key = qaHomeKey(user?.id)
  const { data, error, refresh } = useCachedResource(key, qaHome, { enabled: !!user?.id })
  const [filter, setFilter] = useState(rememberedFilter)

  const home = data && typeof data === 'object' ? data : null
  const pending = !home && !error
  const most = asList(home?.most_asked)
  const showMost = most.length >= 4
  const answered = asList(home?.answered_week)
  const canHelp = asList(home?.can_help)
  const helpIds = new Set(canHelp.map((item) => item.id))
  const newest = asList(home?.newest_open).filter((item) => !helpIds.has(item.id))
  const helpCount = Number(home?.can_help_count) || 0
  const hasBoard = showMost || answered.length > 0 || canHelp.length > 0 || newest.length > 0
  const inbox = home?.inbox_has_new === true
  const showOffline = !online && !!home

  const selectFilter = (next) => {
    rememberedFilter = next
    setFilter(next)
  }

  const retry = () => {
    refresh().catch(() => {})
  }

  const onRefresh = useCallback(() => refresh().catch(() => undefined), [refresh])

  return (
    <PullToRefresh onRefresh={onRefresh}>
      <div className="qa-screen qa-screen--tab" aria-busy={pending || undefined}>
        <header className="qa-tabhead">
          <h1 className="text-display-l qa-tabhead__title">Q&amp;A</h1>
          <button
            type="button"
            className="qa-icon-btn"
            aria-label={inbox ? 'Your questions, new answers' : 'Your questions'}
            onClick={() => navigate('/qa/mine')}
          >
            <Inbox size={20} aria-hidden="true" />
            {inbox ? <span className="qa-badge-dot" aria-hidden="true" /> : null}
          </button>
          <button type="button" className="qa-ask text-body" onClick={() => openQaAsk()}>
            <Plus size={16} aria-hidden="true" />
            Ask
          </button>
        </header>
        <p className="text-body qa-sub">Answers from players who&apos;ve been there</p>
        <button type="button" className="qa-search text-body" onClick={() => navigate('/qa/search')}>
          <Search size={18} aria-hidden="true" />
          <span>Search any game or question</span>
        </button>

        {showOffline ? <OfflineBanner /> : null}

        {pending ? (
          <>
            <section className="qa-home-sec" aria-hidden="true">
              <div className="qa-sec-head">
                <h2 className="text-label qa-label">Most asked</h2>
              </div>
              <QaMostAsked fill />
            </section>
            <FilterSwitch filter={filter} helpCount={0} onSelect={selectFilter} />
            <section className="qa-home-sec" aria-hidden="true">
              <div className="qa-sec-head">
                <h2 className="text-label qa-label">
                  {filter === 'unanswered' ? 'Newest' : 'Popular this week'}
                </h2>
              </div>
              <QaCoverRows count={4} fill />
            </section>
          </>
        ) : null}

        {error && !home ? (
          <div className="qa-home-sec">
            <ListError onRetry={retry} offline={!online} />
          </div>
        ) : null}

        {home && !hasBoard ? <EmptyBoard /> : null}

        {home && hasBoard ? (
          <>
            {showMost ? <MostAsked games={most.slice(0, 4)} /> : null}

            <FilterSwitch filter={filter} helpCount={helpCount} onSelect={selectFilter} />

            {filter === 'answered' && answered.length > 0 ? (
              <section className="qa-home-sec">
                <div className="qa-sec-head">
                  <h2 className="text-label qa-label">Popular this week</h2>
                </div>
                <QuestionGroup items={answered} showCover showAge={false} />
              </section>
            ) : null}

            {filter === 'unanswered' ? (
              <>
                {canHelp.length > 0 ? (
                  <section className="qa-home-sec">
                    <div className="qa-sec-head">
                      <h2 className="text-label qa-label">You can help</h2>
                      <span className="text-caption qa-hint">Games you&apos;ve played</span>
                    </div>
                    <QuestionGroup items={canHelp} showCover showAge />
                  </section>
                ) : null}
                {newest.length > 0 ? (
                  <section className="qa-home-sec">
                    <div className="qa-sec-head">
                      <h2 className="text-label qa-label">Newest</h2>
                    </div>
                    <QuestionGroup items={newest} showCover showAge />
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </PullToRefresh>
  )
}
