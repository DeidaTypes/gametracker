import React from 'react'
import ListCoverCluster from '../ListCoverCluster'
import InlineErrorBanner from '../InlineErrorBanner'

export function formatListMeta(list, saveCounts) {
  const games = `${list.gameCount} ${list.gameCount === 1 ? 'game' : 'games'}`
  const saves = saveCounts?.get(list.id) || 0
  return saves > 0 ? `${games} · ${saves} ${saves === 1 ? 'save' : 'saves'}` : games
}

function CoverStack({ list }) {
  return (
    <ListCoverCluster
      games={list.games}
      coverImageUrl={list.coverImageUrl}
      name={list.name}
      variant="poster"
    />
  )
}

export function LibraryPinnedHero({ list, meta, onOpen }) {
  return (
    <button
      type="button"
      className="lib-pin-hero"
      onClick={() => onOpen(list)}
      aria-label={`Open pinned list ${list.name} (${meta})`}
    >
      <div className="lib-pin-hero-stack">
        <CoverStack list={list} />
      </div>
      <span className="lib-pin-hero-body">
        <span className="lib-pin-hero-tag" aria-hidden="true">◆ Pinned</span>
        <span className="lib-pin-hero-name">{list.name}</span>
        <span className="lib-pin-hero-meta">{meta}</span>
      </span>
    </button>
  )
}

export function LibraryListCard({ list, meta, onOpen }) {
  return (
    <button
      type="button"
      className="lib-list-card"
      onClick={() => onOpen(list)}
      aria-label={`Open list ${list.name} (${meta})`}
    >
      <div className="lib-list-card-stack">
        <CoverStack list={list} />
      </div>
      <span className="lib-list-card-body">
        <span className="lib-list-card-name">{list.name}</span>
        <span className="lib-list-card-meta">{meta}</span>
      </span>
    </button>
  )
}

export function LibraryListsSkeleton() {
  return (
    <div className="lib-lists-grid" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="lib-list-card lib-list-card--skeleton">
          <div className="lib-list-card-stack">
            <div className="skeleton lib-stack-skeleton" />
          </div>
          <span className="lib-list-card-body">
            <span className="skeleton lib-sk-name" />
            <span className="skeleton lib-sk-meta" />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Lists tab body: optional pinned hero + all-lists grid.
 * Empty / error / loading are passed in so own-Library can offer a
 * create CTA and the other-user screen can stay read-only.
 */
export default function LibraryListsPanel({
  lists,
  pinnedLists,
  saveCounts,
  isLoading,
  error,
  onRetry,
  onOpenList,
  empty,
  errorMessage = "Couldn't load your lists. Tap to retry.",
}) {
  if (isLoading) return <LibraryListsSkeleton />

  if (error) {
    return (
      <div className="lib-lists-error">
        <InlineErrorBanner message={errorMessage} onRetry={onRetry} />
      </div>
    )
  }

  if (!lists?.length) {
    return <div className="lib-lists-empty">{empty}</div>
  }

  const heroList = pinnedLists?.[0] || null
  const restLists = heroList ? lists.filter((l) => l.id !== heroList.id) : lists

  return (
    <>
      {heroList && (
        <>
          <p className="lib-sec-label">Pinned</p>
          <LibraryPinnedHero
            list={heroList}
            meta={formatListMeta(heroList, saveCounts)}
            onOpen={onOpenList}
          />
        </>
      )}

      {restLists.length > 0 && (
        <>
          <p className="lib-sec-label">All lists</p>
          <div className="lib-lists-grid">
            {restLists.map((list) => (
              <LibraryListCard
                key={list.id}
                list={list}
                meta={formatListMeta(list, saveCounts)}
                onOpen={onOpenList}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
