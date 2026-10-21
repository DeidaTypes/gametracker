import { Fragment, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import IOSSwitch from '../../components/IOSSwitch'
import { useDebounce } from '../../hooks/useDebounce'
import { hideKeyboard } from '../../services/keyboardInset'
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
  platformDraftFor,
  qaGamePreset,
} from './qaComposer'
import { QaComposerNotices, QaCounter, QaGrowField } from './QaComposerSheet'
import { QA_TOPICS, highlightQuery, topicLabel } from './qaFormat'

const ENTER_SETTLE_MS = 280

function GameCover({ src, className }) {
  if (src) return <img src={src} alt="" className={className} />
  return <div className={`${className} ${className}--placeholder`} aria-hidden="true" />
}

function PickRow({ game, meta, onChoose }) {
  return (
    <button type="button" className="qa-cmp-pick-row" onClick={() => onChoose(game)}>
      <GameCover src={game.coverUrl || game.image} className="qa-cmp-pick-cover" />
      <span className="qa-cmp-pick-info">
        <span className="qa-cmp-pick-title">{game.title}</span>
        {meta ? <span className="qa-cmp-pick-meta">{meta}</span> : null}
      </span>
    </button>
  )
}

function AskPick({ draft, onCancel }) {
  const query = draft.search.trim()
  const debounced = useDebounce(query, 300)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [labels, setLabels] = useState(() => new Map())
  const choosing = useRef(false)
  const { playing, played } = libraryPickLists()

  const addLabels = (ids) => {
    loadPlatformLabels(ids).then((map) => {
      if (!map.size) return
      setLabels((prev) => new Map([...prev, ...map]))
    })
  }

  useEffect(() => {
    addLabels([...playing, ...played].map((game) => game.id))
    // Library membership is read at open. A status change mid-popup is rare.
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
        const list = Array.isArray(games) ? games : []
        setResults(list)
        setSearching(false)
        addLabels(list.map((game) => game.id))
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
    if (choosing.current) return
    const preset = qaGamePreset(game)
    if (!preset) return
    choosing.current = true
    // Blurs synchronously; the returned promise can stay pending on web.
    void hideKeyboard()
    patchQaDraft({
      step: 'compose',
      game: preset,
      search: '',
      focusTitle: false,
      ...platformDraftFor(preset.igdbId, labels.get(String(preset.igdbId))),
    })
  }

  const libraryMeta = (game, status) =>
    [labels.get(String(game.id)), status].filter(Boolean).join(' · ')
  const resultMeta = (game) =>
    labels.get(String(game.id)) || [game.year, game.developer].filter(Boolean).join(' · ')

  const waiting = query.length > 0 && (query !== debounced || searching)
  const showLibrary = !query && (playing.length > 0 || played.length > 0)

  return (
    <>
      <div className="qa-cmp-pick-head">
        <div className="qa-cmp-pick-titlerow">
          <h2 className="qa-cmp-pick-heading">Which game is it about?</h2>
          <button type="button" className="qa-cmp-pick-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="qa-cmp-search-row">
          <Search size={18} className="qa-cmp-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="qa-cmp-search-input"
            value={draft.search}
            placeholder="Search games…"
            aria-label="Search games"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(event) => patchQaDraft({ search: event.target.value })}
          />
          {draft.search ? (
            <button
              type="button"
              className="qa-cmp-search-clear"
              aria-label="Clear search"
              onClick={() => patchQaDraft({ search: '' })}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="qa-cmp-pick-body cm-scroll">
        {query ? (
          <section className="qa-cmp-pick-section">
            {waiting ? (
              <div className="qa-cmp-state-row qa-cmp-state-row--loading" aria-live="polite">
                <span className="qa-cmp-state-spinner" aria-hidden="true" />
                Searching…
              </div>
            ) : null}
            {!waiting && searchError ? (
              <p className="qa-cmp-state-row qa-cmp-state-row--error" aria-live="assertive">
                Couldn&apos;t search. Try again.
              </p>
            ) : null}
            {!waiting && !searchError && results.length === 0 ? (
              <p className="qa-cmp-state-row" aria-live="polite">No games match</p>
            ) : null}
            {!waiting && results.length > 0
              ? results.map((game) => (
                  <PickRow key={game.id} game={game} meta={resultMeta(game)} onChoose={choose} />
                ))
              : null}
          </section>
        ) : null}

        {!query && playing.length > 0 ? (
          <section className="qa-cmp-pick-section">
            <p className="qa-cmp-pick-label">Currently playing</p>
            {playing.map((game) => (
              <PickRow
                key={game.id}
                game={game}
                meta={libraryMeta(game, 'Currently Playing')}
                onChoose={choose}
              />
            ))}
          </section>
        ) : null}

        {!query && played.length > 0 ? (
          <section className="qa-cmp-pick-section">
            <p className="qa-cmp-pick-label">Recently played</p>
            {played.map((game) => (
              <PickRow key={game.id} game={game} meta={libraryMeta(game, 'Played')} onChoose={choose} />
            ))}
          </section>
        ) : null}

        {!query && !showLibrary ? (
          <p className="qa-cmp-state-row qa-cmp-state-row--empty">Search above to find a game</p>
        ) : null}
      </div>
    </>
  )
}

function HighlightedTitle({ text, query }) {
  const parts = highlightQuery(text, query)
  return parts.map((part, index) =>
    part.match ? (
      <span key={index} className="qa-cmp-similar-hl">
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    )
  )
}

function SimilarMeta({ item }) {
  let lead = null
  if (item.status === 'best') lead = 'Answered'
  else if (item.status === 'community_pick') lead = 'Community pick'
  const count = item.answer_count
  const rest = [
    topicLabel(item.topic),
    count != null ? `${count} answer${count === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  if (!lead && rest.length === 0) return null
  return (
    <span className="qa-cmp-similar-meta">
      {lead ? <span className="qa-cmp-similar-ok">{lead}</span> : null}
      {lead && rest.length ? ' · ' : null}
      {rest.join(' · ')}
    </span>
  )
}

function PlatformOptions({ draft, onDone }) {
  if (draft.platformMode === 'text') {
    return (
      <div className="qa-cmp-group" role="group" aria-label="Platform">
        <label className="qa-cmp-group-row">
          <span className="qa-cmp-group-label">Platform</span>
          <input
            className="qa-cmp-inline-input"
            value={draft.platform}
            maxLength={QA_PLATFORM_MAX}
            placeholder="Optional"
            autoComplete="off"
            aria-label="Platform"
            onChange={(event) =>
              patchQaDraft({
                platform: event.target.value.slice(0, QA_PLATFORM_MAX),
                platformTouched: true,
              })
            }
          />
        </label>
      </div>
    )
  }

  return (
    <div className="qa-cmp-group" role="listbox" aria-label="Platform">
      {draft.platformOptions.map((name, index) => {
        const on = name === draft.platform
        return (
          <Fragment key={name}>
            {index > 0 ? <div className="qa-cmp-group-divider" aria-hidden="true" /> : null}
            <button
              type="button"
              role="option"
              aria-selected={on}
              className="qa-cmp-group-row qa-cmp-option-row"
              onClick={() => {
                patchQaDraft({ platform: name, platformTouched: true })
                onDone()
              }}
            >
              <span className="qa-cmp-group-label">{name}</span>
              {on ? <Check size={18} className="qa-cmp-option-check" aria-hidden="true" /> : null}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

function AskCompose({ draft, online, limit, onOpenMatch, editing }) {
  const [matches, setMatches] = useState([])
  const [platformOpen, setPlatformOpen] = useState(false)
  const titleRef = useRef(null)
  const game = draft.game

  useEffect(() => {
    if (!draft.focusTitle) return undefined
    const id = setTimeout(() => {
      const el = titleRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      patchQaDraft({ focusTitle: false })
    }, ENTER_SETTLE_MS)
    return () => clearTimeout(id)
    // Once, on the open that asked for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!game) return undefined
    let cancelled = false
    loadPlatformChoices(game.igdbId).then((choice) => {
      if (cancelled) return
      const current = getQaComposerSession()?.draft?.platform || ''
      let options = choice.options
      if (choice.mode === 'list' && current && !options.includes(current)) options = [current, ...options]
      patchQaDraft({
        platformMode: choice.mode,
        platformOptions: options,
        ...(current ? {} : { platform: choice.selected }),
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

  const textMode = draft.platformMode === 'text'
  const canChoose = (draft.platformMode === 'list' && draft.platformOptions.length > 1) || textMode
  const platformText = draft.platform || (textMode ? 'Add platform' : '')
  const titleLong = draft.title.length > QA_TITLE_MAX * 0.8
  const showTip = matches.length === 0

  let platformNode = null
  if (platformText && canChoose) {
    platformNode = (
      <button
        type="button"
        className="qa-cmp-platform"
        aria-expanded={platformOpen}
        onClick={() => setPlatformOpen((value) => !value)}
      >
        {platformText}
        {textMode ? null : <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />}
      </button>
    )
  } else if (platformText) {
    platformNode = <span className="qa-cmp-platform">{platformText}</span>
  }

  return (
    <>
      <QaComposerNotices online={online} limit={limit} />

      {game ? (
        <div className="qa-cmp-game-header">
          <GameCover src={game.coverUrl} className="qa-cmp-game-cover" />
          <div className="qa-cmp-game-info">
            <p className="qa-cmp-game-title">{game.title}</p>
            <p className="qa-cmp-game-meta">
              {platformNode}
              {platformNode && game.fromLibrary ? ' · ' : null}
              {game.fromLibrary ? 'From your library' : null}
            </p>
          </div>
        </div>
      ) : null}

      {platformOpen && canChoose ? (
        <PlatformOptions draft={draft} onDone={() => setPlatformOpen(false)} />
      ) : null}

      <div className="qa-cmp-field">
        <QaGrowField
          className="qa-cmp-title-input"
          fieldRef={titleRef}
          value={draft.title}
          maxLength={QA_TITLE_MAX}
          placeholder="What are you stuck on?"
          enterKeyHint="next"
          aria-label="Your question"
          onChange={(value) => patchQaDraft({ title: value.replace(/\n/g, ' ') })}
        />
        {showTip || titleLong ? (
          <div className="qa-cmp-under">
            {showTip ? (
              <p className="qa-cmp-tip">
                Keep the question spoiler-free. It always shows, even when spoilers are on.
              </p>
            ) : null}
            <QaCounter value={draft.title} max={QA_TITLE_MAX} />
          </div>
        ) : null}
        {matches.length > 0 ? (
          <section className="qa-cmp-similar" aria-label="Is this your question?">
            <p className="qa-cmp-similar-label">Is this your question?</p>
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                className="qa-cmp-similar-row"
                onClick={() => onOpenMatch(item)}
              >
                <span className="qa-cmp-similar-text">
                  <span className="qa-cmp-similar-title">
                    <HighlightedTitle text={item.title} query={draft.title} />
                  </span>
                  <SimilarMeta item={item} />
                </span>
                <ChevronRight size={16} className="qa-cmp-similar-chev" aria-hidden="true" />
              </button>
            ))}
            <p className="qa-cmp-similar-keep">Not it? Keep writing.</p>
          </section>
        ) : null}
      </div>

      <div className="qa-cmp-field">
        <p className="qa-cmp-section-label">Topic</p>
        <div className="qa-cmp-chip-row" role="listbox" aria-label="Topic">
          {QA_TOPICS.map((topic) => {
            const on = draft.topic === topic
            return (
              <button
                key={topic}
                type="button"
                role="option"
                aria-selected={on}
                className={`qa-cmp-chip${on ? ' qa-cmp-chip--active' : ''}`}
                onClick={() => chooseTopic(topic)}
              >
                {topicLabel(topic)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="qa-cmp-textarea-wrap">
        <QaGrowField
          className="qa-cmp-textarea"
          value={draft.body}
          maxLength={QA_BODY_MAX}
          placeholder="Add details: what you tried, where you're stuck… (optional)"
          aria-label="Details"
          onChange={(value) => patchQaDraft({ body: value })}
        />
        <QaCounter value={draft.body} max={QA_BODY_MAX} always />
      </div>

      <div className="qa-cmp-group" role="group" aria-label="Question options">
        <label className="qa-cmp-group-row">
          <span className="qa-cmp-group-label">Where are you?</span>
          <input
            className="qa-cmp-inline-input"
            value={draft.location}
            maxLength={QA_LOCATION_MAX}
            placeholder="Optional"
            autoComplete="off"
            aria-label="Where are you?"
            onChange={(event) => patchQaDraft({ location: event.target.value.slice(0, QA_LOCATION_MAX) })}
          />
        </label>
        <div className="qa-cmp-group-divider" aria-hidden="true" />
        <div className="qa-cmp-group-row">
          <span className="qa-cmp-group-copy">
            <span className="qa-cmp-group-label">Contains spoilers</span>
            <span className="qa-cmp-group-sub">Hides details and answers</span>
          </span>
          <IOSSwitch
            checked={draft.topic === 'story' ? true : draft.isSpoiler}
            disabled={draft.topic === 'story'}
            label="Contains spoilers"
            onChange={(next) => patchQaDraft({ isSpoiler: next })}
          />
        </div>
      </div>
    </>
  )
}

export default function QaAskForm({ draft, online, limit, onOpenMatch, onCancel, editing = false }) {
  if (draft.step === 'pick') return <AskPick draft={draft} onCancel={onCancel} />
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
