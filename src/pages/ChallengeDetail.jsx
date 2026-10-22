import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Trophy } from 'lucide-react'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import {
  deleteCompletionEventsForGame,
  getFinishedGamesThisYear,
  getGoalProgress,
  restoreCompletionEvents,
} from '../services/goalService'
import { recomputeBadges } from '../services/badgeService'
import { useIosLongPressDrag } from '../hooks/useIosLongPressDrag'
import { useAutoAnimateMotion, useMotionPreference } from '../hooks/useMotionPreference'
import GoalRing from '../components/GoalRing'
import SharedCover from '../components/SharedCover'
import Pressable from '../components/Pressable'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ReorderTrashTarget from '../components/ReorderTrashTarget'
import { showToast } from '../components/Toast'
import { DestructiveButton, SecondaryButton } from '../components/forms'
import { hapticImpact } from '../utils/haptics'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getGameNavStub } from '../utils/gameNavStub'
import '../components/CreateListModal.css'
import '../components/DeleteConfirmModal.css'
import './ChallengeDetail.css'

const REMOVE_ANIM_MS = 280
const GRID_REFLOW_MS = 250
const TRASH_ENTER_MS = 220

/**
 * Yearly-challenge detail for `/user/:username/challenge` and
 * `/user/id/:userId/challenge` — the destination behind the challenge
 * card on Home and Profile.
 *
 * Lists the games the user actually finished during the challenge year,
 * newest first, from `getFinishedGamesThisYear` — the same function the
 * ring numerator uses via `countFinishedThisYear`. The list length
 * therefore always equals the ring's `current`.
 *
 * Own-profile only: long-press drag-to-trash removes the completion
 * EVENT (not the tracker row). Library delete is a different path and
 * is not used here.
 *
 * `?year=` overrides the year so an older challenge stays linkable; it
 * defaults to the current calendar year.
 */
function ChallengeDetail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { userId, user, resolving, notFound, isOwnProfile } = useProfileRouteUser()

  const parsedYear = parseInt(searchParams.get('year') || '', 10)
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()

  const [progress, setProgress] = useState(null)
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [trashArmed, setTrashArmed] = useState(false)
  const [removingGameId, setRemovingGameId] = useState(null)
  const [restoringGameId, setRestoringGameId] = useState(null)
  const [pendingRemoval, setPendingRemoval] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const itemEls = useRef({})
  const coverEls = useRef({})
  const trashBarRef = useRef(null)
  const gamesRef = useRef(games)
  gamesRef.current = games

  const [gridRef] = useAutoAnimateMotion({ duration: GRID_REFLOW_MS })
  const { reduced: reducedMotion } = useMotionPreference()

  useEffect(() => {
    if (resolving || !userId) return undefined
    let cancelled = false
    setLoading(true)

    // One activities query for the completed set. Progress then reuses
    // that length as `current` so the header cannot drift from the grid.
    getFinishedGamesThisYear(userId, year)
      .then(async (rows) => {
        if (cancelled) return
        const gp = await getGoalProgress(userId, year, { current: rows.length })
        if (cancelled) return
        setGames(rows)
        setProgress(gp)
      })
      .catch((err) => {
        console.error('[challenge] load failed:', err)
        if (!cancelled) setGames([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [userId, year, resolving])

  const getItemEl = useCallback((id) => itemEls.current[id], [])

  const cacheTrashRect = useCallback((session) => {
    if (session.trashRect) return session.trashRect
    const trashEl = trashBarRef.current
    if (!trashEl?.classList.contains('reorder-trash-target--visible')) return null
    session.trashRect = trashEl.getBoundingClientRect()
    return session.trashRect
  }, [])

  const measureTrashRectOnce = useCallback((session) => {
    if (session.trashRect) return session.trashRect
    const slideMs = reducedMotion ? 0 : TRASH_ENTER_MS
    if (Date.now() - (session.activatedAt ?? 0) < slideMs) return null
    return cacheTrashRect(session)
  }, [cacheTrashRect, reducedMotion])

  const {
    bindItem,
    dragId,
    suppressClickRef,
    sessionRef,
    scheduleDragTransform,
    hardResetDrag,
  } = useIosLongPressDrag({
    enabled: isOwnProfile && !pendingRemoval,
    getItemEl,
    onArm: (session) => {
      const cover = coverEls.current[session.id]
      if (cover) session.startRect = cover.getBoundingClientRect()
      session.trashRect = null
      session.armed = false
      setTrashArmed(false)
    },
    onMove: (session, { dx, dy }) => {
      scheduleDragTransform(session, dx, dy)
      const trashRect = measureTrashRectOnce(session)
      if (!trashRect || !session.startRect) return

      const centerX = session.startRect.left + session.startRect.width / 2 + dx
      const centerY = session.startRect.top + session.startRect.height / 2 + dy
      const nowArmed =
        centerX >= trashRect.left &&
        centerX <= trashRect.right &&
        centerY >= trashRect.top &&
        centerY <= trashRect.bottom

      if (nowArmed !== session.armed) {
        session.armed = nowArmed
        setTrashArmed(nowArmed)
        if (nowArmed) hapticImpact('Light')
      }
    },
    onRelease: (session) => {
      const game = gamesRef.current.find((g) => g.igdbGameId === session.id)
      const armed = session.armed
      setTrashArmed(false)

      if (armed && game) {
        const nextCount = Math.max(0, gamesRef.current.length - 1)
        const index = gamesRef.current.findIndex((g) => g.igdbGameId === game.igdbGameId)
        hardResetDrag(session.id)
        setPendingRemoval({ game, index, nextCount })
        return
      }

      hardResetDrag(session.id)
    },
    onCancel: () => {
      setTrashArmed(false)
    },
  })

  useEffect(() => {
    if (dragId == null) return undefined

    const el = trashBarRef.current
    if (!el) return undefined

    let settled = false
    const settleTrashRect = () => {
      if (settled) return
      settled = true
      const session = sessionRef.current
      if (session?.id === dragId) cacheTrashRect(session)
    }

    const onTransitionEnd = (e) => {
      if (e.target === el && e.propertyName === 'transform') settleTrashRect()
    }
    el.addEventListener('transitionend', onTransitionEnd)

    if (reducedMotion) {
      requestAnimationFrame(() => requestAnimationFrame(settleTrashRect))
    } else {
      setTimeout(settleTrashRect, TRASH_ENTER_MS + 32)
    }

    return () => {
      settled = true
      el.removeEventListener('transitionend', onTransitionEnd)
    }
  }, [dragId, reducedMotion, cacheTrashRect, sessionRef])

  const handleTap = (game) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    navigate(`/game/${game.igdbGameId}`, { state: getGameNavStub(game) })
  }

  const closeConfirm = () => {
    if (confirming) return
    setPendingRemoval(null)
  }

  useEffect(() => {
    if (!pendingRemoval) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') closeConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pendingRemoval, confirming])

  const commitRemoval = async () => {
    if (!pendingRemoval || !userId || confirming) return
    const { game, index, nextCount } = pendingRemoval
    setConfirming(true)

    const { rows, error } = await deleteCompletionEventsForGame(
      userId,
      game.igdbGameId,
      year
    )
    if (error || !rows.length) {
      setConfirming(false)
      setPendingRemoval(null)
      showToast('Could not remove this completion. Please try again.', 'error')
      return
    }

    setRemovingGameId(game.igdbGameId)
    setPendingRemoval(null)
    setConfirming(false)
    hapticImpact('Medium')

    const finishRemove = async () => {
      setGames((prev) => prev.filter((g) => g.igdbGameId !== game.igdbGameId))
      setRemovingGameId(null)
      const gp = await getGoalProgress(userId, year, { current: nextCount })
      setProgress(gp)
      await recomputeBadges({ allowCompletionTierDrop: true })

      showToast(`Removed from the ${year} Challenge`, 'success', 4000, {
        label: 'Undo',
        onClick: () => {
          void undoRemoval({ game, index, rows })
        },
      })
    }

    if (reducedMotion) {
      await finishRemove()
    } else {
      setTimeout(() => {
        void finishRemove()
      }, REMOVE_ANIM_MS)
    }
  }

  const undoRemoval = async ({ game, index, rows }) => {
    const restored = await restoreCompletionEvents(rows)
    if (!restored) {
      showToast("Couldn't restore the completion. Please try again.", 'error')
      return
    }

    setRestoringGameId(game.igdbGameId)
    setGames((prev) => {
      if (prev.some((g) => g.igdbGameId === game.igdbGameId)) return prev
      const next = [...prev]
      const insertAt = Math.max(0, Math.min(index, next.length))
      next.splice(insertAt, 0, game)
      return next
    })

    const gp = await getGoalProgress(userId, year, {
      current: gamesRef.current.some((g) => g.igdbGameId === game.igdbGameId)
        ? gamesRef.current.length
        : gamesRef.current.length + 1,
    })
    setProgress(gp)
    await recomputeBadges()

    setTimeout(() => {
      setRestoringGameId((current) => (current === game.igdbGameId ? null : current))
    }, reducedMotion ? 0 : REMOVE_ANIM_MS)
  }

  const showSkeleton = resolving || loading
  const displayName = user?.display_name || user?.username || ''
  const current = progress?.hasGoal ? progress.current : games.length
  const target = progress?.hasGoal ? progress.target : null
  const remaining =
    progress?.hasGoal && progress.target != null
      ? Math.max(0, progress.target - progress.current)
      : null

  return (
    <div className="challenge-detail">
      <header className="challenge-detail__header">
        <button
          type="button"
          className="challenge-detail__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="challenge-detail__heading">
          <h1 className="challenge-detail__title">{year} Challenge</h1>
          {!showSkeleton && !notFound && (
            <p className="challenge-detail__header-count">
              {target != null ? `${current} of ${target}` : `${games.length} finished`}
            </p>
          )}
        </div>
        <span className="challenge-detail__spacer" aria-hidden="true" />
      </header>

      <div className="challenge-detail__body">
        {notFound ? (
          <p className="challenge-detail__empty">
            This user doesn&apos;t exist or has been removed.
          </p>
        ) : (
          <>
            <section className="challenge-detail__summary" aria-label="Challenge progress">
              {showSkeleton ? (
                <>
                  <Skeleton variant="circle" width={72} height={72} />
                  <div className="challenge-detail__summary-text">
                    <Skeleton variant="text" width={90} height={28} />
                    <Skeleton variant="text" width={130} height={15} style={{ marginTop: 8 }} />
                  </div>
                </>
              ) : (
                <>
                  {progress?.hasGoal && (
                    <GoalRing
                      current={progress.current}
                      target={progress.target}
                      year={year}
                      variant="compact"
                    />
                  )}
                  <div className="challenge-detail__summary-text">
                    <p className="challenge-detail__count">
                      {progress?.hasGoal
                        ? `${progress.current}/${progress.target}`
                        : `${games.length} finished`}
                    </p>
                    <p className="challenge-detail__sub">
                      {progress?.hasGoal
                        ? remaining === 0
                          ? 'Goal reached'
                          : `${remaining} to go`
                        : `Games finished in ${year}`}
                    </p>
                  </div>
                </>
              )}
            </section>

            {showSkeleton ? (
              <div className="challenge-detail__grid" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="challenge-detail__cover-skeleton" />
                ))}
              </div>
            ) : games.length === 0 ? (
              <EmptyState
                icon={Trophy}
                size="compact"
                body={
                  isOwnProfile
                    ? `Nothing finished yet in ${year}. Mark a game as Played and it'll show up here.`
                    : `${displayName || 'This player'} hasn't finished a game in ${year} yet.`
                }
              />
            ) : (
              <div
                ref={gridRef}
                className={`challenge-detail__grid${dragId != null ? ' challenge-detail__grid--dragging' : ''}`}
                aria-label="Completed games"
              >
                {games.map((game) => {
                  const id = game.igdbGameId
                  const isDragged = dragId === id
                  const isRemoving = removingGameId === id
                  const isRestoring = restoringGameId === id
                  const pointerBind = isOwnProfile ? bindItem(id) : {}
                  const ariaLabel = game.title ? `Open ${game.title}` : 'Open game'

                  return (
                    <div
                      key={id}
                      ref={(el) => {
                        if (el) itemEls.current[id] = el
                        else delete itemEls.current[id]
                      }}
                      className={[
                        'challenge-detail__poster',
                        isDragged && 'challenge-detail__poster--dragged',
                        isRemoving && 'challenge-detail__poster--removing',
                        isRestoring && 'challenge-detail__poster--restoring',
                      ].filter(Boolean).join(' ')}
                    >
                      <div
                        ref={(el) => {
                          if (el) coverEls.current[id] = el
                          else delete coverEls.current[id]
                        }}
                        className={[
                          'challenge-detail__cover',
                          isRemoving && 'challenge-detail__cover--removing',
                          isDragged && 'challenge-detail__cover--lifted',
                          isDragged && trashArmed && 'challenge-detail__cover--armed',
                        ].filter(Boolean).join(' ')}
                        {...pointerBind}
                      >
                        <Pressable
                          as="div"
                          role="button"
                          tabIndex={0}
                          className="challenge-detail__cover-tap"
                          whileTap={{ scale: 1 }}
                          onClick={() => handleTap(game)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleTap(game)
                            }
                          }}
                          aria-label={ariaLabel}
                        >
                          <SharedCover gameId={game.igdbGameId} imageSrc={game.image || COVER_FALLBACK}>
                            <img
                              src={game.image || COVER_FALLBACK}
                              alt=""
                              className="challenge-detail__cover-img"
                              loading="lazy"
                              draggable={false}
                              onError={(e) => { e.target.src = COVER_FALLBACK }}
                            />
                          </SharedCover>
                        </Pressable>
                      </div>
                      {game.title ? (
                        <span className="challenge-detail__poster-title">{game.title}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {isOwnProfile && (
        <ReorderTrashTarget
          visible={dragId != null}
          armed={trashArmed}
          barRef={trashBarRef}
          ariaLabel="Remove from challenge"
        />
      )}

      {pendingRemoval &&
        createPortal(
          <div
            className="modal-overlay delete-confirm-overlay"
            onClick={closeConfirm}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-completion-title"
            aria-describedby="remove-completion-body"
          >
            <div
              className="modal-content delete-confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="remove-completion-title" className="delete-confirm__title">
                Remove from your {year} Challenge?
              </h2>
              <p id="remove-completion-body" className="delete-confirm__body">
                This will lower your count to{' '}
                <strong>{pendingRemoval.nextCount}</strong>
                {' '}and may affect badge progress. Your library status will stay as it is.
              </p>
              <div className="delete-confirm__footer">
                <DestructiveButton onClick={() => void commitRemoval()} disabled={confirming}>
                  {confirming ? 'Removing…' : 'Remove'}
                </DestructiveButton>
                <SecondaryButton onClick={closeConfirm} autoFocus disabled={confirming}>
                  Cancel
                </SecondaryButton>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

export default ChallengeDetail
