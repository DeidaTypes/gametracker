import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowUpDown,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import ActionSheet from '../../components/ActionSheet'
import EmptyState from '../../components/EmptyState'
import { useDebounce } from '../../hooks/useDebounce'
import { useCachedResource } from '../../hooks/useCachedResource'
import { coverUrlFromImageId } from '../../services/igdb'
import { getGameStatus } from '../../services/libraryService'
import { hapticImpact } from '../../utils/haptics'
import {
  qaGame,
  qaGameKey,
  qaSearch,
  qaSearchKey,
} from '../../services/qaService'
import QaPushBar from './QaPushBar'
import QaQuestionListRow from './QaQuestionListRow'
import { QaPlainRows } from './QaPlaceholders'
import { formatGameStatsLine } from './qaFormat'
import { openQaAsk, qaGamePreset } from './qaComposer'
import { isQaQuestionHidden, useQaHides } from './qaHides'
import { useQaGameMeta } from './qaGameMeta'
import './qa.css'

const PAGE_SIZE = 30

export default function QaGame() {
  const { igdbId } = useParams()
  const navigate = useNavigate()
  const { tick: hideTick } = useQaHides()

  const [filter, setFilter] = useState('answered')
  const [sort, setSort] = useState('helpful')
  const [searchText, setSearchText] = useState('')
  const [sortOpen, setSortOpen] = useState(false)
  const debouncedSearch = useDebounce(searchText.trim(), 300)
  const searching = debouncedSearch.length > 0

  const listKey = !searching && igdbId ? qaGameKey(igdbId, filter, sort) : null
  const searchKey = searching && igdbId ? qaSearchKey(igdbId, debouncedSearch) : null

  const {
    data: gameData,
    error: listError,
    refresh: refreshList,
  } = useCachedResource(
    listKey,
    () => qaGame(igdbId, { filter, sort, limit: PAGE_SIZE }),
    { enabled: !!listKey }
  )

  const {
    data: searchData,
    error: searchError,
    refresh: refreshSearch,
  } = useCachedResource(
    searchKey,
    () => qaSearch(debouncedSearch, igdbId),
    { enabled: !!searchKey }
  )

  const [extraItems, setExtraItems] = useState([])
  const [moreAvailable, setMoreAvailable] = useState(false)
  const [nextBefore, setNextBefore] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    setExtraItems([])
    setMoreAvailable(gameData?.has_more === true)
    setNextBefore(gameData?.next_before ?? null)
  }, [listKey, gameData])

  const sourceItems = useMemo(() => {
    if (searching) return Array.isArray(searchData) ? searchData : []
    return [...(gameData?.items ?? []), ...extraItems]
  }, [searching, searchData, gameData, extraItems])

  const listItems = useMemo(
    () => sourceItems.filter((item) => item?.id && !isQaQuestionHidden(item.id)),
    [sourceItems, hideTick],
  )

  const header = gameData?.header
  const listLoaded = searching ? searchData !== undefined : gameData !== undefined
  const activeError = searching ? searchError : listError
  const pending = !listLoaded && !activeError

  const gameMeta = useQaGameMeta(igdbId, sourceItems, listLoaded)
  const gameTitle = gameMeta?.title
  const coverUrl =
    gameMeta?.coverUrl ||
    (gameMeta?.coverImageId ? coverUrlFromImageId(gameMeta.coverImageId, 'cover_big') : null)

  const statsLine = formatGameStatsLine(header)
  const totalEmpty =
    !searching && listLoaded && !activeError && (header?.question_count ?? 0) === 0

  const sortLabel = sort === 'newest' ? 'Newest' : 'Most helpful'
  const sectionLabel = sort === 'newest' && filter === 'unanswered' ? 'Newest' : 'Most helpful'

  const loadMore = useCallback(async () => {
    if (searching || sort !== 'newest' || !moreAvailable || !nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await qaGame(igdbId, {
        filter,
        sort,
        limit: PAGE_SIZE,
        before: nextBefore,
      })
      setExtraItems((prev) => [...prev, ...(page?.items || [])])
      setMoreAvailable(page?.has_more === true)
      setNextBefore(page?.next_before ?? null)
    } catch {
      // keep existing rows
    } finally {
      setLoadingMore(false)
    }
  }, [searching, sort, moreAvailable, nextBefore, loadingMore, igdbId, filter])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || searching || sort !== 'newest' || !moreAvailable) return undefined
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '200px' }
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [searching, sort, moreAvailable, loadMore])

  const selectFilter = (next) => {
    if (next === filter) return
    hapticImpact('Light')
    setFilter(next)
  }

  const handleRetry = () => {
    if (searching) refreshSearch()
    else refreshList()
  }

  const answeredCount = header?.answered_count
  const unansweredCount = header?.unanswered_count

  const askAboutGame = () => {
    const preset = qaGamePreset({
      igdbId,
      title: gameTitle,
      coverImageId: gameMeta?.coverImageId,
      coverUrl,
      fromLibrary: getGameStatus(igdbId) != null,
    })
    if (preset) openQaAsk({ game: preset })
  }

  return (
    <div className="qa-screen qa-screen--push" aria-busy={pending || undefined}>
      <QaPushBar
        onBack={() => navigate(-1)}
        ask
        onAsk={askAboutGame}
      />

      <div className="qa-push-body">
        <header className="qa-game-hero">
          <div className="qa-game-hero__cover-wrap">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="qa-game-hero__cover" />
            ) : (
              <span className="qa-game-hero__cover skeleton" aria-hidden="true" />
            )}
          </div>
          <div className="qa-game-hero__text">
            <p className="text-label qa-game-hero__kicker">Questions</p>
            {gameTitle ? (
              <h1 className="text-heading qa-game-hero__title">{gameTitle}</h1>
            ) : (
              <span className="skeleton qa-game-hero__title-skel" aria-hidden="true" />
            )}
            {statsLine && listLoaded && !searching ? (
              <p className="text-caption qa-game-hero__stats">{statsLine}</p>
            ) : pending && !gameTitle ? (
              <span className="skeleton qa-game-hero__stats-skel" aria-hidden="true" />
            ) : null}
          </div>
        </header>

        {!totalEmpty ? (
          <label className="qa-search qa-search--field text-body">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={
                gameTitle ? `Search ${gameTitle} questions` : 'Search questions for this game'
              }
              aria-label={
                gameTitle ? `Search ${gameTitle} questions` : 'Search questions for this game'
              }
            />
            {searchText ? (
              <button
                type="button"
                className="qa-search__clear"
                onClick={() => setSearchText('')}
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        ) : null}

        {!searching && !totalEmpty ? (
          <div className="qa-seg qa-seg--tight" role="tablist" aria-label="Question status">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'answered'}
              className={`qa-seg__btn text-body${filter === 'answered' ? ' qa-seg__btn--on' : ''}`}
              onClick={() => selectFilter('answered')}
            >
              Answered
              {answeredCount != null ? (
                <span className="qa-seg__count text-caption">{answeredCount}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'unanswered'}
              className={`qa-seg__btn text-body${filter === 'unanswered' ? ' qa-seg__btn--on' : ''}`}
              onClick={() => selectFilter('unanswered')}
            >
              Unanswered
              {unansweredCount != null ? (
                <span className="qa-seg__count qa-seg__count--soc text-caption">{unansweredCount}</span>
              ) : null}
            </button>
          </div>
        ) : null}

        {!totalEmpty ? (
          <section className="qa-sec">
            <div className="qa-sec-head">
              <h2 className="text-label">{searching ? 'Results' : sectionLabel}</h2>
              {!searching ? (
                <button
                  type="button"
                  className="qa-link-btn text-caption"
                  onClick={() => setSortOpen(true)}
                >
                  <ArrowUpDown size={15} aria-hidden="true" />
                  {sortLabel}
                </button>
              ) : null}
            </div>

            {activeError && sourceItems.length === 0 ? (
              <div className="qa-group">
                <EmptyState
                  size="compact"
                  title="Couldn't load questions"
                  body="Check your connection and try again."
                  cta="Try again"
                  onCta={handleRetry}
                  ctaVariant="secondary"
                  icon={RefreshCw}
                />
              </div>
            ) : pending && sourceItems.length === 0 ? (
              <div className="qa-group" aria-hidden="true">
                <QaPlainRows count={4} />
              </div>
            ) : sourceItems.length === 0 && listLoaded ? (
              <EmptyState
                size="compact"
                title={searching ? 'No questions match' : 'Nothing here yet'}
                body={
                  searching
                    ? 'Try different words or ask a new question.'
                    : filter === 'unanswered'
                      ? 'Every question has an answer — nice.'
                      : undefined
                }
              />
            ) : (
              <div className="qa-group">
                {listItems.map((item, i) => (
                  <div key={item.id}>
                    {i > 0 ? <div className="qa-hair qa-hair--full" /> : null}
                    <QaQuestionListRow item={item} withAsker />
                  </div>
                ))}
                {loadingMore ? (
                  <>
                    <div className="qa-hair qa-hair--full" />
                    <QaPlainRows count={2} flat />
                  </>
                ) : null}
              </div>
            )}
            {!searching && sort === 'newest' && moreAvailable ? (
              <div ref={sentinelRef} className="qa-sentinel" aria-hidden="true" />
            ) : null}
          </section>
        ) : null}

        {totalEmpty ? (
          <EmptyState
            icon={MessageCircleQuestion}
            title={gameTitle ? `No questions about ${gameTitle} yet` : 'No questions yet'}
            body="Be the first. Players who've played it will see your question."
            cta={gameTitle ? `Ask about ${gameTitle}` : 'Ask a question'}
            onCta={askAboutGame}
          />
        ) : null}
      </div>

      <ActionSheet
        isOpen={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sort"
        items={[
          {
            label: 'Most helpful',
            onClick: () => {
              setSort('helpful')
              setSortOpen(false)
            },
          },
          {
            label: 'Newest',
            onClick: () => {
              setSort('newest')
              setSortOpen(false)
            },
          },
        ]}
      />
    </div>
  )
}
