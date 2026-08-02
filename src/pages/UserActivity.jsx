import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import ActivityFeed from '../components/ActivityFeed'
import './UserActivity.css'

/**
 * Full activity history for `/user/:username/activity` and
 * `/user/id/:userId/activity` — the destination behind the Recent
 * activity section's "See all".
 *
 * All of the loading, pagination, empty state and block filtering lives
 * in ActivityFeed, which already implements them; this page is the route
 * shell that resolves the user and gives the feed a header.
 */
function UserActivity() {
  const navigate = useNavigate()
  const { userId, user, resolving, notFound } = useProfileRouteUser()

  const displayName = user?.display_name || user?.username || ''

  return (
    <div className="user-activity">
      <header className="user-activity__header">
        <button
          type="button"
          className="user-activity__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="user-activity__title">Activity</h1>
        <span className="user-activity__spacer" aria-hidden="true" />
      </header>

      <div className="user-activity__body">
        {notFound ? (
          <p className="user-activity__empty">
            This user doesn&apos;t exist or has been removed.
          </p>
        ) : resolving ? (
          // ActivityFeed treats a null userId as "no activity", so hold it
          // back until the route param resolves rather than flashing the
          // empty state on the way in.
          <div className="user-activity__loading" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="user-activity__row-skeleton">
                <div className="skeleton user-activity__sk-dot" />
                <div className="skeleton user-activity__sk-line" />
              </div>
            ))}
          </div>
        ) : (
          <ActivityFeed
            userId={userId}
            avatarUrl={user?.avatar_url || null}
            displayName={displayName}
          />
        )}
      </div>
    </div>
  )
}

export default UserActivity
