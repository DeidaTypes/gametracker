import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { Trophy } from 'lucide-react'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import { getFinishedGamesThisYear, getGoalProgress } from '../services/goalService'
import GoalRing from '../components/GoalRing'
import SharedCover from '../components/SharedCover'
import Pressable from '../components/Pressable'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './ChallengeDetail.css'

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
              <div className="challenge-detail__grid" aria-label="Completed games">
                {games.map((game) => (
                  <Pressable
                    key={game.igdbGameId}
                    className="challenge-detail__poster"
                    onClick={() =>
                      navigate(
                        `/game/${game.igdbGameId}`,
                        game.image ? { state: { coverImage: game.image } } : undefined
                      )
                    }
                    aria-label={game.title ? `Open ${game.title}` : 'Open game'}
                  >
                    <div className="challenge-detail__cover">
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
                    </div>
                    {game.title ? (
                      <span className="challenge-detail__poster-title">{game.title}</span>
                    ) : null}
                  </Pressable>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ChallengeDetail
