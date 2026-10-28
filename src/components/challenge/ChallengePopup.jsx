import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import {
  deleteCompletionEventsForGame,
  getFinishedGamesThisYear,
  getGoalProgress,
  restoreCompletionEvents,
} from '../../services/goalService'
import { recomputeBadges } from '../../services/badgeService'
import { useLongPressMenu } from '../../hooks/useLongPressMenu'
import { useAutoAnimateMotion, useMotionPreference } from '../../hooks/useMotionPreference'
import { MOTION } from '../../motion/xMotion'
import CenteredModal from '../CenteredModal'
import ActionSheet from '../ActionSheet'
import GoalRing from '../GoalRing'
import Pressable from '../Pressable'
import Skeleton from '../Skeleton'
import EmptyState from '../EmptyState'
import { Arrive } from '../motion/ContentSwap'
import { showToast } from '../Toast'
import { hapticImpact } from '../../utils/haptics'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import './ChallengePopup.css'

const PLACEHOLDER_COVERS = 6

/**
 * ChallengePopup — the yearly challenge as a centered popup over whatever
 * page opened it (Home, Profile, a visitor's Profile, a cold deep link).
 *
 * Lists the games the user actually finished during the challenge year,
 * newest first, from `getFinishedGamesThisYear` — the same function the
 * ring numerator uses via `countFinishedThisYear`. The list length therefore
 * always equals the ring's `current`.
 *
 * The box is 80% of the viewport from the first frame; the summary and the
 * 3-column grid scroll inside it. Placeholders are the final size of the
 * content, so numbers and covers crossfade in without anything moving.
 *
 * Own challenge only: long-press a game for the standard ActionSheet with one
 * destructive item. That removes the completion EVENT (not the tracker row);
 * Library delete is a different path and is not used here.
 *
 * Tapping a game closes the popup (it fades out on the leave curve) and pushes
 * Game Detail in the same tick, so the push never starts over a blank page.
 * The popup is in-page state: nothing here touches the URL.
 *
 * Props:
 *   isOpen, onClose
 *   userId         – whose challenge (required to load)
 *   year           – challenge year (defaults to the current calendar year)
 *   isOwnProfile   – enables long-press removal
 *   displayName    – used only for another player's empty state
 */
function ChallengePopup({
  isOpen,
  onClose,
  userId,
  year: yearProp,
  isOwnProfile = false,
  displayName = '',
}) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const year = Number.isFinite(yearProp) ? yearProp : new Date().getFullYear()
  const loadKey = userId ? `${userId}:${year}` : null

  // { key, games, progress } for the last completed load. Stays put when the
  // popup closes, so a reopen paints the last value and revalidates.
  const [data, setData] = useState(null)
  const [removingGameId, setRemovingGameId] = useState(null)
  const [restoringGameId, setRestoringGameId] = useState(null)
  const [menuGame, setMenuGame] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const dataRef = useRef(data)
  dataRef.current = data
  const [gridRef] = useAutoAnimateMotion({ duration: MOTION.arrive })

  const loaded = data && data.key === loadKey ? data : null
  const games = loaded?.games ?? []
  const progress = loaded?.progress ?? null
  const ready = !!loaded

  useEffect(() => {
    if (!isOpen || !loadKey) return undefined
    let cancelled = false

    // One activities query for the completed set. Progress then reuses that
    // length as `current` so the summary cannot drift from the grid.
    getFinishedGamesThisYear(userId, year)
      .then(async (rows) => {
        if (cancelled) return
        const gp = await getGoalProgress(userId, year, { current: rows.length })
        if (cancelled) return
        setData({ key: loadKey, games: rows, progress: gp })
      })
      .catch((err) => {
        console.error('[challenge] load failed:', err)
        if (!cancelled) setData({ key: loadKey, games: [], progress: null })
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, loadKey, userId, year])

  const patchLoaded = useCallback((update) => {
    setData((prev) => (prev && prev.key === loadKey ? { ...prev, ...update(prev) } : prev))
  }, [loadKey])

  // ── Open a game ─────────────────────────────────────────────────────
  const { bind, suppressClickRef } = useLongPressMenu({
    enabled: isOwnProfile,
    onOpen: (game) => {
      setMenuGame(game)
      setMenuOpen(true)
    },
  })

  const handleTap = (game) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onClose()
    navigate(`/game/${game.igdbGameId}`, { state: getGameNavStub(game) })
  }

  // ── Remove (own challenge) ──────────────────────────────────────────
  const settleMs = reduced ? MOTION.reducedFade : MOTION.popOut

  const undoRemoval = async ({ game, index, rows, nextCount }) => {
    const restored = await restoreCompletionEvents(rows)
    if (!restored) {
      showToast("Couldn't restore the completion. Please try again.", 'error')
      return
    }

    setRestoringGameId(game.igdbGameId)
    patchLoaded((prev) => {
      if (prev.games.some((g) => g.igdbGameId === game.igdbGameId)) return {}
      const next = [...prev.games]
      next.splice(Math.max(0, Math.min(index, next.length)), 0, game)
      return { games: next }
    })

    const gp = await getGoalProgress(userId, year, { current: nextCount + 1 })
    patchLoaded(() => ({ progress: gp }))
    await recomputeBadges()

    setTimeout(() => {
      setRestoringGameId((current) => (current === game.igdbGameId ? null : current))
    }, settleMs)
  }

  const commitRemoval = async (game) => {
    if (!userId || !isOwnProfile) return
    const current = dataRef.current?.games ?? []
    const index = current.findIndex((g) => g.igdbGameId === game.igdbGameId)
    const nextCount = Math.max(0, current.length - 1)

    const { rows, error } = await deleteCompletionEventsForGame(userId, game.igdbGameId, year)
    if (error || !rows.length) {
      showToast('Could not remove this completion. Please try again.', 'error')
      return
    }

    setRemovingGameId(game.igdbGameId)
    hapticImpact('Medium')

    const finishRemove = async () => {
      patchLoaded((prev) => ({ games: prev.games.filter((g) => g.igdbGameId !== game.igdbGameId) }))
      setRemovingGameId(null)
      const gp = await getGoalProgress(userId, year, { current: nextCount })
      patchLoaded(() => ({ progress: gp }))
      await recomputeBadges({ allowCompletionTierDrop: true })

      showToast(`Removed from the ${year} Challenge`, 'success', 4000, {
        label: 'Undo',
        onClick: () => {
          void undoRemoval({ game, index, rows, nextCount })
        },
      })
    }

    setTimeout(() => {
      void finishRemove()
    }, settleMs)
  }

  // ── Display ─────────────────────────────────────────────────────────
  const hasGoal = !!progress?.hasGoal
  const remaining = hasGoal ? Math.max(0, progress.target - progress.current) : null
  const countLine = hasGoal
    ? `${progress.current} of ${progress.target}`
    : `${games.length} finished`

  const summaryPlaceholder = (
    <div className="cp-summary" aria-hidden="true">
      <Skeleton variant="circle" className="cp-summary__ring-skel" />
      <div className="cp-summary__text">
        <Skeleton variant="text" className="cp-summary__count-skel" />
        <Skeleton variant="text" className="cp-summary__sub-skel" />
      </div>
    </div>
  )

  const gridPlaceholder = (
    <div className="cp-grid" aria-busy="true">
      {Array.from({ length: PLACEHOLDER_COVERS }, (_, i) => (
        <div key={i} className="cp-poster">
          <Skeleton className="cp-cover-skel" />
        </div>
      ))}
    </div>
  )

  return (
    <>
      <CenteredModal
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel={`${year} Challenge`}
        maxWidth={400}
        className="cp-card"
      >
        <header className="cp-top">
          <span aria-hidden="true" />
          <div className="cp-top__title">
            <h2 className="cp-top__name text-title">{year} Challenge</h2>
            <Arrive
              ready={ready}
              as="span"
              className="cp-top__count text-caption"
              placeholder={<span>&nbsp;</span>}
            >
              <span>{countLine}</span>
            </Arrive>
          </div>
          <button type="button" className="cp-top__done" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="cm-scroll cp-body">
          <Arrive ready={ready} placeholder={summaryPlaceholder}>
            <section className="cp-summary" aria-label="Challenge progress">
              {hasGoal && (
                <GoalRing
                  current={progress.current}
                  target={progress.target}
                  year={year}
                  variant="compact"
                />
              )}
              <div className="cp-summary__text">
                <p className="cp-summary__count text-heading">
                  {hasGoal ? `${progress.current}/${progress.target}` : `${games.length} finished`}
                </p>
                <p className="cp-summary__sub text-caption">
                  {hasGoal
                    ? remaining === 0
                      ? 'Goal reached'
                      : `${remaining} to go`
                    : `Games finished in ${year}`}
                </p>
              </div>
            </section>
          </Arrive>

          <Arrive ready={ready} placeholder={gridPlaceholder}>
            {games.length === 0 ? (
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
              <div ref={gridRef} className="cp-grid" aria-label="Completed games">
                {games.map((game) => {
                  const id = game.igdbGameId
                  return (
                    <div
                      key={id}
                      className={[
                        'cp-poster',
                        removingGameId === id && 'cp-poster--removing',
                        restoringGameId === id && 'cp-poster--restoring',
                      ].filter(Boolean).join(' ')}
                    >
                      <div className="cp-cover" {...(isOwnProfile ? bind(game) : {})}>
                        <Pressable
                          as="div"
                          role="button"
                          tabIndex={0}
                          className="cp-cover__tap"
                          whileTap={{ scale: 1 }}
                          onClick={() => handleTap(game)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleTap(game)
                            }
                          }}
                          aria-label={game.title ? `Open ${game.title}` : 'Open game'}
                        >
                          <img
                            src={game.image || COVER_FALLBACK}
                            alt=""
                            className="cp-cover__img"
                            loading="lazy"
                            draggable={false}
                            onError={(e) => { e.target.src = COVER_FALLBACK }}
                          />
                        </Pressable>
                      </div>
                      {game.title ? <span className="cp-poster__title">{game.title}</span> : null}
                    </div>
                  )
                })}
              </div>
            )}
          </Arrive>
        </div>
      </CenteredModal>

      {isOwnProfile && (
        <ActionSheet
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
          layer="top"
          title={menuGame?.title || 'Game'}
          items={
            menuGame
              ? [
                  {
                    label: `Remove from ${year} Challenge`,
                    destructive: true,
                    onClick: () => {
                      void commitRemoval(menuGame)
                    },
                  },
                ]
              : []
          }
        />
      )}
    </>
  )
}

export default ChallengePopup
