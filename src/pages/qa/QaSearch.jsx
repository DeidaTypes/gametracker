import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Plus, Search, WifiOff, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useCachedResource } from '../../hooks/useCachedResource'
import { useDebounce } from '../../hooks/useDebounce'
import { coverUrlFromImageId } from '../../services/igdb'
import { qaHome, qaHomeKey, qaSearch, qaSearchKey } from '../../services/qaService'
import { openQaAsk, qaGamePreset } from './qaComposer'
import { isQaQuestionHidden, useQaHides } from './qaHides'
import { runAfterSlide } from '../../motion/xMotion'
import QaQuestionListRow from './QaQuestionListRow'
import { QaPlainRows } from './QaPlaceholders'
import { useOnline } from './useOnline'
import './qa.css'

function asList(value) {
  return Array.isArray(value) ? value : []
}

function groupByGame(items) {
  const groups = []
  const index = new Map()
  for (const item of items) {
    const key = item?.igdb_game_id
    if (key == null) continue
    let group = index.get(key)
    if (!group) {
      group = {
        igdb_game_id: key,
        game_title: item.game_title,
        game_cover_image_id: item.game_cover_image_id,
        items: [],
      }
      index.set(key, group)
      groups.push(group)
    }
    if (!group.game_cover_image_id && item.game_cover_image_id) {
      group.game_cover_image_id = item.game_cover_image_id
    }
    group.items.push(item)
  }
  return groups
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

function GameHead({ group, countLabel }) {
  const src = group.game_cover_image_id
    ? coverUrlFromImageId(group.game_cover_image_id, 'cover_big')
    : null
  return (
    <div className="qa-match-head">
      <span className="qa-match-head__id">
        {src ? (
          <img className="qa-match-cover" src={src} alt="" />
        ) : (
          <span className="qa-match-cover qa-fill" aria-hidden="true" />
        )}
        <span className="qa-match-head__col">
          <span className="qa-match-head__title text-body">{group.game_title}</span>
          <span className="qa-match-head__count text-caption">{countLabel}</span>
        </span>
      </span>
      <Link className="qa-open text-caption" to={`/qa/game/${group.igdb_game_id}`}>
        Open
      </Link>
    </div>
  )
}

function MostAskedBrowse({ games }) {
  if (!games.length) return null
  return (
    <section className="qa-search-sec">
      <h2 className="text-label qa-label">Most asked</h2>
      <div className="qa-group">
        {games.map((game, index) => {
          const count = Number(game.question_count) || 0
          return (
            <div key={game.igdb_game_id}>
              {index > 0 ? <div className="qa-hair qa-hair--full" /> : null}
              <div className="qa-match-pad">
                <GameHead
                  group={game}
                  countLabel={`${count} question${count === 1 ? '' : 's'}`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function QaSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tick: hideTick } = useQaHides()
  const { user } = useAuth()
  const online = useOnline()
  const inputRef = useRef(null)
  const browseMost = location.state?.browse === 'most-asked'
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const debounced = useDebounce(trimmed, 250)
  const waiting = trimmed !== debounced
  const searchKey = !waiting && debounced ? qaSearchKey(null, debounced) : null

  const { data, error, refresh } = useCachedResource(
    searchKey,
    () => qaSearch(debounced),
    { enabled: !!searchKey }
  )

  const homeKey = browseMost ? qaHomeKey(user?.id) : null
  const { data: home } = useCachedResource(homeKey, qaHome, { enabled: !!homeKey })

  useEffect(() => {
    if (browseMost) return undefined
    runAfterSlide(() => inputRef.current?.focus())
    return undefined
  }, [browseMost])

  const items = useMemo(
    () => (Array.isArray(data) ? data : []).filter((item) => item?.id && !isQaQuestionHidden(item.id)),
    [data, hideTick],
  )
  const groups = useMemo(() => groupByGame(items), [items])
  const most = asList(home?.most_asked).filter((game) => game?.igdb_game_id != null)
  const showMost = !trimmed && browseMost && most.length > 0
  const searching = !!trimmed
  const pending = searching && (waiting || (data === undefined && !error))
  const noMatch = searching && !waiting && Array.isArray(data) && data.length === 0 && !error
  const showOffline = !online && ((Array.isArray(data) && data.length > 0) || showMost)
  const single = groups.length === 1 ? groups[0] : null

  return (
    <div className="qa-screen qa-screen--push qa-screen--search">
      <div className="qa-search-top">
        <label className="qa-search qa-search--field text-body">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any game or question"
            aria-label="Search any game or question"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {query ? (
            <button
              type="button"
              className="qa-search__clear"
              aria-label="Clear"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <button type="button" className="qa-cancel text-body" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>

      <div className="qa-push-body">
        {showOffline ? <OfflineBanner /> : null}

        {showMost ? <MostAskedBrowse games={most} /> : null}

        {pending ? (
          <div className="qa-search-sec" aria-hidden="true">
            <QaPlainRows count={4} fill />
          </div>
        ) : null}

        {searching && error && !items.length ? (
          <ListError onRetry={() => refresh().catch(() => {})} offline={!online} />
        ) : null}

        {noMatch ? (
          <div className="qa-empty qa-empty--search">
            <h2 className="text-title qa-empty__title">No questions match</h2>
            <button type="button" className="qa-btn-block text-body" onClick={() => openQaAsk({ title: trimmed })}>
              <Plus size={16} aria-hidden="true" />
              Ask about it
            </button>
          </div>
        ) : null}

        {groups.map((group) => {
          const count = group.items.length
          return (
            <section key={group.igdb_game_id} className="qa-search-sec">
              <GameHead
                group={group}
                countLabel={`${count} matching question${count === 1 ? '' : 's'}`}
              />
              <div className="qa-group">
                {group.items.map((item, index) => (
                  <div key={item.id}>
                    {index > 0 ? <div className="qa-hair qa-hair--full" /> : null}
                    <QaQuestionListRow item={item} query={debounced} showAge />
                  </div>
                ))}
              </div>
            </section>
          )
        })}

        {single ? (
          <div className="qa-ask-more">
            <p className="qa-ask-more__title text-body">Didn&apos;t find it?</p>
            <p className="qa-ask-more__body text-caption">
              Ask the {single.game_title} community.
            </p>
            <button
              type="button"
              className="qa-btn-block qa-btn-block--wide text-body"
              onClick={() =>
                openQaAsk({
                  title: trimmed,
                  game: qaGamePreset({
                    igdbId: single.igdb_game_id,
                    title: single.game_title,
                    coverImageId: single.game_cover_image_id,
                  }),
                })
              }
            >
              <Plus size={16} aria-hidden="true" />
              Ask about {single.game_title}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
