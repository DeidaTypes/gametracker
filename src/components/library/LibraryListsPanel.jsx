import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLongPressMenu } from '../../hooks/useLongPressMenu'
import ListCoverCluster from '../ListCoverCluster'
import InlineErrorBanner from '../InlineErrorBanner'
import ListCardActionHost, { listCardMenuKind } from './ListCardActionHost'

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

export function LibraryPinnedHero({ list, meta, onOpen, onClick, pressBind }) {
  return (
    <button
      type="button"
      className="lib-pin-hero"
      onClick={onClick || (() => onOpen(list))}
      aria-label={`Open pinned list ${list.name} (${meta})`}
      {...(pressBind || {})}
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

export function LibraryListCard({ list, meta, onOpen, onClick, pressBind }) {
  return (
    <button
      type="button"
      className="lib-list-card"
      onClick={onClick || (() => onOpen(list))}
      aria-label={`Open list ${list.name} (${meta})`}
      {...(pressBind || {})}
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
  const { user } = useAuth()
  const currentUserId = user?.id || null
  const [menuList, setMenuList] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const { bind, suppressClickRef } = useLongPressMenu({
    shouldOpen: (list) => listCardMenuKind(list, currentUserId) != null,
    onOpen: (list) => {
      setMenuList(list)
      setSheetOpen(true)
    },
  })

  const handleCardClick = (list) => (e) => {
    if (suppressClickRef.current) {
      e.preventDefault()
      return
    }
    onOpenList(list)
  }

  if (isLoading && !(lists?.length)) return <LibraryListsSkeleton />

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
            onClick={handleCardClick(heroList)}
            pressBind={bind(heroList)}
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
                onClick={handleCardClick(list)}
                pressBind={bind(list)}
              />
            ))}
          </div>
        </>
      )}

      <ListCardActionHost
        list={menuList}
        currentUserId={currentUserId}
        sheetOpen={sheetOpen}
        onCloseSheet={() => setSheetOpen(false)}
      />
    </>
  )
}
