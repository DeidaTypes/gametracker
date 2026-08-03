import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { Trophy } from 'lucide-react'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import { getFinishedGamesThisYear, getGoalProgress } from '../services/goalService'
import GoalRing from '../components/GoalRing'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import './ChallengeDetail.css'

function formatCompletedAt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Yearly-challenge detail for `/user/:username/challenge` and
 * `/user/id/:userId/challenge` — the destination behind the challenge
 * card on Profile Home.
 *
 * Lists the games the user actually finished during the challenge year,
 * newest first, from the same activities rows the ring counts. The list
 * length therefore always equals the ring's `current`.
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

  useEffect(() => {
    if (resolving || !userId) return undefined
    let cancelled = false
    setLoading(true)

    Promise.all([getGoalProgress(userId, year), getFinishedGamesThisYear(userId, year)])
      .then(([gp, rows]) => {
        if (cancelled) return
        setProgress(gp)
        setGames(rows)
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

  const showSkeleton = resolving || loading
  const displayName = user?.display_name || user?.username || ''
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
        <h1 className="challenge-detail__title">{year} Challenge</h1>
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
                  {/* Only ring a real goal — with no target set, GoalRing
                      renders its "set a goal" affordance, which isn't this
                      screen's job. */}
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

            <h2 className="challenge-detail__section-title">
              Completed
              {!showSkeleton && games.length > 0 && (
                <span className="challenge-detail__section-count">{games.length}</span>
              )}
            </h2>

            {showSkeleton ? (
              <ul className="challenge-detail__list" aria-busy="true">
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="challenge-detail__row challenge-detail__row--placeholder">
                    <Skeleton className="challenge-detail__cover-skeleton" />
                    <Skeleton variant="text" width="55%" height={16} />
                  </li>
                ))}
              </ul>
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
              <ul className="challenge-detail__list">
                {games.map((game) => (
                  <li key={game.igdbGameId} className="challenge-detail__item">
                    <button
                      type="button"
                      className="challenge-detail__row"
                      onClick={() =>
                        navigate(
                          `/game/${game.igdbGameId}`,
                          game.image ? { state: { coverImage: game.image } } : undefined
                        )
                      }
                      aria-label={`Open ${game.title || 'game'}`}
                    >
                      <span className="challenge-detail__cover">
                        {game.image ? (
                          <img src={game.image} alt="" loading="lazy" />
                        ) : (
                          <span className="challenge-detail__cover-fallback" aria-hidden="true">
                            {(game.title || '?').charAt(0)}
                          </span>
                        )}
                      </span>
                      <span className="challenge-detail__info">
                        <span className="challenge-detail__game">
                          {game.title || `Game #${game.igdbGameId}`}
                        </span>
                        <span className="challenge-detail__date">
                          Finished {formatCompletedAt(game.completedAt)}
                        </span>
                      </span>
                      <LuChevronRight
                        size={16}
                        className="challenge-detail__chevron"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ChallengeDetail
