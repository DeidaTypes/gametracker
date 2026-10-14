import React from 'react'
import Pressable from '../Pressable'
import SharedCover from '../SharedCover'
import StatusChip from '../StatusChip'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { GRID_COVER_DISPLAY_PX, coverLoadingProps, getSizedImageUrl } from '../../services/imageUtils'

// Structural note (see ListDetail.jsx's .game-cover / .gg-cover-tap):
// the pointer-handled element (.lib-cov) must be a plain div and must be
// the OUTER element, with the tap/keyboard-activatable role living on an
// INNER Pressable. Previously this was inverted — .lib-cov sat inside a
// <button> — and iOS WKWebView aggressively cancels gestures (fires
// pointercancel) for touches that start on/inside a <button> in a
// scroll view. Matching ListDetail's shape removes that <button>
// ancestor entirely while keeping every affordance it provided:
// role="button", tabIndex, Enter/Space activation, and the aria-label,
// now on the inner Pressable (as="div") instead of a native button.
export function LibraryGameCard({
  game,
  onClick,
  cardRef,
  coverRef,
  cardClassName = '',
  coverClassName = '',
  onCoverPointerDown,
  onCoverPointerMove,
  onCoverPointerUp,
  onCoverPointerCancel,
  priorityIndex = 99,
}) {
  const ariaLabel = game.title ? `Open ${game.title}` : 'Open game'
  const imageSrc = getSizedImageUrl(game.image, GRID_COVER_DISPLAY_PX) || game.image || COVER_FALLBACK
  return (
    <div
      ref={cardRef}
      className={`lib-gamecard${cardClassName ? ` ${cardClassName}` : ''}`}
    >
      <div
        ref={coverRef}
        className={`lib-cov${coverClassName ? ` ${coverClassName}` : ''}`}
        onPointerDown={onCoverPointerDown}
        onPointerMove={onCoverPointerMove}
        onPointerUp={onCoverPointerUp}
        onPointerCancel={onCoverPointerCancel}
      >
        {/* Tap/keyboard target only — deliberately NOT where the pointer
            drag handlers above live. whileTap is neutralized here because
            Library.css already drives the identical press-scale off
            .lib-cov:active (see the rule below); leaving Pressable's own
            default whileTap in place too would compound the two scales. */}
        <Pressable
          as="div"
          role="button"
          tabIndex={0}
          className="lib-cov-tap"
          whileTap={{ scale: 1 }}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClick?.(e)
            }
          }}
          aria-label={ariaLabel}
        >
          <SharedCover gameId={game.id} imageSrc={imageSrc}>
            <img
              src={imageSrc}
              alt=""
              className="lib-cov-img"
              width={GRID_COVER_DISPLAY_PX}
              height={138}
              draggable={false}
              onError={(e) => { e.target.src = COVER_FALLBACK }}
              {...coverLoadingProps(priorityIndex, 9)}
            />
          </SharedCover>
        </Pressable>
      </div>
      <p className="lib-gamecard-title">{game.title || '—'}</p>
    </div>
  )
}

/**
 * Dense list-row counterpart to LibraryGameCard. Same pointer-event
 * contract (plain outer div carries drag handlers; inner Pressable is
 * the tap/keyboard target) so Library's drag-to-delete path can attach
 * without a second gesture implementation. TrackerGameRow / Search's
 * GameResultRow were not reused: neither is exported, and both carry
 * extra chrome (progress, hours, year/dev chevron) this row must not.
 */
export function LibraryGameRow({
  game,
  onClick,
  cardRef,
  coverRef,
  isDragged = false,
  isRemoving = false,
  isRestoring = false,
  trashArmed = false,
  onCoverPointerDown,
  onCoverPointerMove,
  onCoverPointerUp,
  onCoverPointerCancel,
  priorityIndex = 99,
}) {
  const ariaLabel = game.title ? `Open ${game.title}` : 'Open game'
  const imageSrc = getSizedImageUrl(game.image, 48) || game.image || COVER_FALLBACK
  const rowClass = [
    'lib-gamerow',
    isDragged && 'lib-gamerow--dragged',
    isRemoving && 'lib-gamerow--removing',
    isRestoring && 'lib-gamerow--restoring',
  ].filter(Boolean).join(' ')
  const coverClass = [
    'lib-gamerow-cover',
    isRemoving && 'lib-gamerow-cover--removing',
    isDragged && 'lib-gamerow-cover--lifted',
    isDragged && trashArmed && 'lib-gamerow-cover--armed',
  ].filter(Boolean).join(' ')

  return (
    <div ref={cardRef} className={rowClass}>
      {/* Same shape as LibraryGameCard: pointer handlers live on a
          plain cover wrapper, not a <button>, so iOS WKWebView does
          not cancel the long-press. Tap/keyboard stay on the inner
          Pressable. Handlers stay on the cover (not the whole row)
          so a finger starting on the title can still scroll. */}
      <div
        ref={coverRef}
        className={coverClass}
        onPointerDown={onCoverPointerDown}
        onPointerMove={onCoverPointerMove}
        onPointerUp={onCoverPointerUp}
        onPointerCancel={onCoverPointerCancel}
      >
        <Pressable
          as="div"
          role="button"
          tabIndex={0}
          className="lib-gamerow-cover-tap"
          whileTap={{ scale: 1 }}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClick?.(e)
            }
          }}
          aria-label={ariaLabel}
        >
          <SharedCover gameId={game.id} imageSrc={imageSrc}>
            <img
              src={imageSrc}
              alt=""
              className="lib-gamerow-cover-img"
              width={48}
              height={72}
              draggable={false}
              onError={(e) => { e.target.src = COVER_FALLBACK }}
              {...coverLoadingProps(priorityIndex, 9)}
            />
          </SharedCover>
        </Pressable>
      </div>
      <Pressable
        as="div"
        className="lib-gamerow-body"
        whileTap={{ scale: 1 }}
        onClick={onClick}
        tabIndex={-1}
        aria-hidden="true"
      >
        <p className="text-body lib-gamerow-title">{game.title || '—'}</p>
        {game._status ? (
          <StatusChip status={game._status} variant="pill" />
        ) : null}
      </Pressable>
    </div>
  )
}

export default function LibraryGameGrid({
  games,
  onGameClick,
  gridRef,
  dragging = false,
  hasMore = false,
  onLoadMore,
  renderCard,
  view = 'grid',
  ariaLabel = 'Games',
}) {
  const isList = view === 'list'
  return (
    <>
      <div
        key={view}
        className={
          isList
            ? `lib-gamelist${dragging ? ' lib-gamelist--dragging' : ''} lib-games-view-in`
            : `lib-grid3${dragging ? ' lib-grid3--dragging' : ''}`
        }
        ref={gridRef}
        aria-label={ariaLabel}
      >
        {renderCard
          ? games.map((g, index) => renderCard(g, index))
          : games.map((g, index) =>
              isList ? (
                <LibraryGameRow
                  key={g.id}
                  game={g}
                  priorityIndex={index}
                  onClick={() => onGameClick?.(g)}
                />
              ) : (
                <LibraryGameCard
                  key={g.id}
                  game={g}
                  priorityIndex={index}
                  onClick={() => onGameClick?.(g)}
                />
              )
            )}
      </div>
      {hasMore && (
        <button
          type="button"
          className="lib-loadmore"
          onClick={onLoadMore}
        >
          Show more
        </button>
      )}
    </>
  )
}
