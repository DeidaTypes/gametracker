import React from 'react'
import FollowsListPage from '../components/FollowsListPage'

/**
 * Sprint 6 — /user/:username/following
 *
 * Thin route wrapper. All header / tabs / list / pagination logic
 * lives in FollowsListPage so the followers + following pages stay
 * in sync.
 */
function UserFollowing() {
  return <FollowsListPage mode="following" />
}

export default UserFollowing
