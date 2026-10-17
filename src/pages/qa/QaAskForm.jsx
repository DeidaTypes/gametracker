import { useEffect, useState } from 'react'
import { Search, WifiOff, X } from 'lucide-react'
import IOSSwitch from '../../components/IOSSwitch'
import ActionSheet from '../../components/ActionSheet'
import { useDebounce } from '../../hooks/useDebounce'
import { searchGames } from '../../services/searchService'
import { qaSimilar } from '../../services/qaService'
import {
  QA_BODY_MAX,
  QA_LOCATION_MAX,
  QA_PLATFORM_MAX,
  QA_TITLE_MAX,
  libraryPickLists,
  getQaComposerSession,
  loadPlatformChoices,
  loadPlatformLabels,
  patchQaDraft,
  qaGamePreset,
} from './qaComposer'
import { QaCounter, QaGrowField, useComposerFieldFocus } from './QaComposerSheet'
import { QA_TOPICS, formatSimilarStats, highlightQuery, topicLabel } from './qaFormat'

function FieldLabel({ children, extra }) {
  return (
    <div className="qa-ps-label-row">
      <span className="qa-ps-label text-caption">{children}</span>
      {extra}
    </div>
  )
}

function GameCover({ src, className }) {
  if (src) return <img src={src} alt="" className={className} />
  return <span className={`${className} qa-fill`} aria-hidden="true" />
}

function PickRow({ game, subtitle, onChoose }) {
  return (
    <button type="button" className="qa-pick-row" onClick={() => onChoose(game)}>
      <GameCover src={game.coverUrl || game.image} className="qa-pick-row__cover" />
      <span className="qa-pick-row__text">
        <span className="qa-pick-row__title text-body">{game.title}</span>
        {subtitle ? <span className="qa-pick-row__sub text-caption">{subtitle}</span> : null}
      </span>
    </button>
  )
}

function PickSkeleton() {
  return (
    <div className="qa-pick-row" aria-hidden="true">
      <span className="qa-pick-row__cover skeleton" />
      <span className="qa-pick-row__text">
        <span className="skeleton qa-pick-row__skel" />
        <span className="skeleton qa-pick-row__skel qa-pick-row__skel--short" />
      </span>
    </div>
  )
}

function subtitleFor(game, labels, statusLabel) {
  const platform = labels.get(String(game.id))
  return platform ? `${platform} · ${statusLabel}` : statusLabel
}

function AskPick({ draft }) {
  const sheetFocus = useComposerFieldFocus()
  const query = draft.search.trim()
  const debounced = useDebounce(query, 300)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [labels, setLabels] = useState(() => new Map())
  const { playing, played } = libraryPickLists()

  useEffect(() => {
    const ids = [...playing, ...played].map((game) => game.id)
    let cancelled = false
    loadPlatformLabels(ids).then((map) => {
      if (!cancelled) setLabels(map)
    })
    return () => {
      cancelled = true
    }
    // Library membership is read at open. A status change mid-sheet is rare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!debounced) {
      setResults([])
      setSearching(false)
      setSearchError(false)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    setSearchError(false)
    searchGames(debounced, 20)
      .then((games) => {
        if (cancelled) return
        setResults(Array.isArray(games) ? games : [])
        setSearching(false)
      })
      .catch(() => {
        if (cancelled) return
        setResults([])
        setSearching(false)
        setSearchError(true)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const choose = (game) => {
    const preset = qaGamePreset(game)
    if (!preset) return
    patchQaDraft({
      step: 'compose',
      game: preset,
      search: '',
      platform: '',
      platformMode: null,
      platformOptions: [],
      platformTouched: false,
    })
  }

  const waiting = query.length > 0 && (query !== debounced || searching)

  return (
    <>
      <label className="qa-ps-field">
        <span className="qa-ps-label text-caption">Which game?</span>
        <span className="qa-ps-search text-body">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={draft.search}
            autoFocus
            placeholder="Search all games"
            aria-label="Search all games"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            enterKeyHint="search"
            onChange={(event) => patchQaDraft({ search: event.target.value })}
            onFocus={sheetFocus || undefined}
          />
          {draft.search ? (
            <button
              type="button"
              className="qa-ps-search__clear"
              aria-label="Clear"
              onClick={() => patchQaDraft({ search: '' })}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </label>

      {waiting ? (
        <div aria-hidden="true">
          <PickSkeleton />
          <PickSkeleton />
          <PickSkeleton />
        </div>
      ) : null}

      {searchError ? <p className="text-caption qa-ps-hint">Couldn&apos;t search. Try again.</p> : null}

      {!waiting && debounced && !searchError && results.length === 0 ? (
        <p className="text-caption qa-ps-hint">No games match</p>
      ) : null}

      {!waiting && results.length > 0
        ? results.map((game) => (
            <PickRow key={game.id} game={game} subtitle={null} onChoose={choose} />
          ))
        : null}

      {!query && playing.length > 0 ? (
        <section className="qa-ps-section">
          <h2 className="text-label qa-label">Currently playing</h2>
          {playing.map((game) => (
            <PickRow
              key={game.id}
              game={game}
              subtitle={subtitleFor(game, labels, 'Currently Playing')}
              onChoose={choose}
            />
          ))}
        </section>
      ) : null}

      {!query && played.length > 0 ? (
        <section className="qa-ps-section">
          <h2 className="text-label qa-label">Recently played</h2>
          {played.map((game) => (
            <PickRow
              key={game.id}
              game={game}
              subtitle={subtitleFor(game, labels, 'Played')}
              onChoose={choose}
            />
          ))}
        </section>
      ) : null}
    </>
  )
}

function HighlightedTitle({ text, query }) {
  const parts = highlightQuery(text, query)
  return parts.map((part, index) =>
    part.match ? (
      <span key={index} className="qa-similar__hl">
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    )
  )
}

function AskCompose({ draft, online, limit, onOpenMatch, editing }) {
  const sheetFocus = useComposerFieldFocus()
  const [matches, setMatches] = useState([])
  const [platformOpen, setPlatformOpen] = useState(false)
  const game = draft.game

  useEffect(() => {
    if (!game) return undefined
    let cancelled = false
    loadPlatformChoices(game.igdbId).then((choice) => {
      if (cancelled) return
      const touched = getQaComposerSession()?.draft?.platformTouched
      patchQaDraft({
        platformMode: choice.mode,
        platformOptions: choice.options,
        ...(touched ? {} : { platform: choice.selected }),
      })
    })
    return () => {
      cancelled = true
    }
    // Only when the game changes. A later keystroke must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.igdbId])

  useEffect(() => {
    const title = draft.title.trim()
    const words = title.split(/\s+/).filter(Boolean)
    if (editing || !game || words.length < 3) {
      setMatches([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      qaSimilar(title, game.igdbId)
        .then((rows) => {
          if (cancelled) return
          setMatches(Array.isArray(rows) ? rows.slice(0, 3) : [])
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft.title, game, editing])

  const chooseTopic = (topic) => {
    patchQaDraft({
      topic,
      isSpoiler: topic === 'story' ? true : draft.isSpoiler,
    })
  }

  const platformList = draft.platformMode === 'list' && draft.platformOptions.length > 0

  return (
    <>
      {!online ? (
        <div className="qa-banner qa-ps-banner" role="status">
          <WifiOff size={18} aria-hidden="true" />
          <span>You&apos;re offline</span>
        </div>
      ) : null}

      {limit ? (
        <div className="qa-banner qa-ps-banner" role="status">
          <span>{limit.message}</span>
        </div>
      ) : null}

      {game ? (
        <div className="qa-gamepick">
          <GameCover src={game.coverUrl} className="qa-gamepick__cover" />
          <span className="qa-gamepick__text">
            <span className="qa-gamepick__title text-body">{game.title}</span>
            {game.fromLibrary ? (
              <span className="qa-gamepick__from text-caption">From your library</span>
            ) : null}
          </span>
          {platformList && draft.platformOptions.length > 1 ? (
            <button
              type="button"
              className="qa-platform-chip text-caption"
              onClick={() => setPlatformOpen(true)}
              aria-haspopup="menu"
            >
              {draft.platform || draft.platformOptions[0]}
            </button>
          ) : null}
          {platformList && draft.platformOptions.length === 1 ? (
            <span className="qa-platform-chip text-caption">{draft.platform || draft.platformOptions[0]}</span>
          ) : null}
        </div>
      ) : null}

      {draft.platformMode === 'text' ? (
        <label className="qa-ps-field">
          <FieldLabel extra={<QaCounter value={draft.platform} max={QA_PLATFORM_MAX} />}>
            Platform
          </FieldLabel>
          <input
            className="qa-ps-input qa-ps-input--line text-body"
            value={draft.platform}
            maxLength={QA_PLATFORM_MAX}
            autoComplete="off"
            onChange={(event) =>
              patchQaDraft({
                platform: event.target.value.slice(0, QA_PLATFORM_MAX),
                platformTouched: true,
              })
            }
            onFocus={sheetFocus || undefined}
          />
        </label>
      ) : null}

      <label className="qa-ps-field">
        <FieldLabel extra={<QaCounter value={draft.title} max={QA_TITLE_MAX} />}>
          Your question
        </FieldLabel>
        <QaGrowField
          value={draft.title}
          maxLength={QA_TITLE_MAX}
          autoFocus
          enterKeyHint="next"
          aria-label="Your question"
          onChange={(value) => patchQaDraft({ title: value.replace(/\n/g, ' ') })}
        />
        <span className="qa-ps-hint text-caption">Keep the title spoiler-free. Titles always show.</span>
      </label>

      {matches.length > 0 ? (
        <section className="qa-similar" aria-label="Is this your question?">
          <h2 className="qa-similar__label text-caption">Is this your question?</h2>
          <div className="qa-similar__list">
            {matches.map((item) => {
              const stats = formatSimilarStats(item)
              return (
                <button
                  key={item.id}
                  type="button"
                  className="qa-similar__item"
                  onClick={() => onOpenMatch(item)}
                >
                  <span className="qa-similar__title text-body">
                    <HighlightedTitle text={item.title} query={draft.title} />
                  </span>
                  {stats ? <span className="qa-similar__stats text-caption">{stats}</span> : null}
                </button>
              )
            })}
          </div>
          <p className="qa-similar__keep text-caption">Not it? Keep writing.</p>
        </section>
      ) : null}

      <div className="qa-ps-field">
        <span className="qa-ps-label text-caption">Topic</span>
        <div className="qa-topics" role="listbox" aria-label="Topic">
          {QA_TOPICS.map((topic) => {
            const on = draft.topic === topic
            return (
              <button
                key={topic}
                type="button"
                role="option"
                aria-selected={on}
                className={`qa-topic text-caption${on ? ' qa-topic--on' : ''}`}
                onClick={() => chooseTopic(topic)}
              >
                {topicLabel(topic)}
              </button>
            )
          })}
        </div>
      </div>

      <label className="qa-ps-field">
        <FieldLabel extra={<QaCounter value={draft.body} max={QA_BODY_MAX} />}>Details</FieldLabel>
        <QaGrowField
          className="qa-ps-input--area"
          value={draft.body}
          maxLength={QA_BODY_MAX}
          aria-label="Details"
          onChange={(value) => patchQaDraft({ body: value })}
        />
      </label>

      <label className="qa-ps-field">
        <FieldLabel extra={<QaCounter value={draft.location} max={QA_LOCATION_MAX} />}>
          Where are you?
        </FieldLabel>
        <input
          className="qa-ps-input qa-ps-input--line text-body"
          value={draft.location}
          maxLength={QA_LOCATION_MAX}
          placeholder="Optional"
          aria-label="Where are you?"
          onChange={(event) => patchQaDraft({ location: event.target.value.slice(0, QA_LOCATION_MAX) })}
          onFocus={sheetFocus || undefined}
        />
      </label>

      <div className="qa-ps-switch">
        <span className="qa-ps-switch__copy">
          <span className="text-body">Contains spoilers</span>
          <span className="qa-ps-hint text-caption">Hides the details and answers until someone taps</span>
        </span>
        <IOSSwitch
          checked={draft.topic === 'story' ? true : draft.isSpoiler}
          disabled={draft.topic === 'story'}
          label="Contains spoilers"
          onChange={(next) => patchQaDraft({ isSpoiler: next })}
        />
      </div>

      <ActionSheet
        isOpen={platformOpen}
        onClose={() => setPlatformOpen(false)}
        title="Platform"
        items={draft.platformOptions.map((name) => ({
          label: name,
          onClick: () => {
            patchQaDraft({ platform: name, platformTouched: true })
            setPlatformOpen(false)
          },
        }))}
      />
    </>
  )
}

export default function QaAskForm({ draft, online, limit, onOpenMatch, editing = false }) {
  if (draft.step === 'pick') return <AskPick draft={draft} />
  return (
    <AskCompose
      draft={draft}
      online={online}
      limit={limit}
      onOpenMatch={onOpenMatch}
      editing={editing}
    />
  )
}
