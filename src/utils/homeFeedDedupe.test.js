import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isDuplicateCompletionOrReview } from './homeFeedDedupe.js'

// Fixture data below mirrors REAL rows written live against the
// checkpoint Supabase project during manual QA of BUG 2 (Portal 2,
// igdb id 72, actor 6c88ae0e-29c7-44bf-9d42-72a67962bd17):
//   activity_events: id bb05eeeb-..., type 'completed',
//     created_at 2026-09-17 13:47:03.151077+00
//   reviews:         id e80d5831-..., body-having review,
//     created_at 2026-09-17 13:47:36.102578+00 (33s later)
// communityService.getHomeFeed's server-side _suppressNearbyCompletions
// already drops the completion from any SINGLE fetch that sees both
// rows together. What it can't fix is two SEPARATE fetches — the
// completion added to `items` by an earlier silentRefresh, then the
// review arriving via a later one that, on its own, no longer includes
// the (by-then-suppressed) completion. This is that exact race,
// replayed against the real ids/timestamps.
const ACTOR_ID = '6c88ae0e-29c7-44bf-9d42-72a67962bd17'
const GAME_ID = 72

const realCompletionOnScreen = {
  id: 'bb05eeeb-914e-42e1-ae20-97f977e6f704',
  type: 'finished',
  author: { id: ACTOR_ID },
  game: { id: GAME_ID },
  createdAt: '2026-09-17T13:47:03.151077+00:00',
}

const realFreshReview = {
  id: 'e80d5831-3671-4ae5-8f9f-f0c9880892b3',
  type: 'reviewed',
  author: { id: ACTOR_ID },
  game: { id: GAME_ID },
  createdAt: '2026-09-17T13:47:36.102578+00:00',
}

describe('isDuplicateCompletionOrReview (BUG 2 — live-data regression)', () => {
  it('flags a fresh review as a duplicate of an on-screen completion for the same actor+game (the actual Portal 2 QA race)', () => {
    assert.equal(isDuplicateCompletionOrReview(realFreshReview, [realCompletionOnScreen]), true)
  })

  it('is symmetric — a fresh completion is also flagged against an on-screen review', () => {
    assert.equal(isDuplicateCompletionOrReview(realCompletionOnScreen, [realFreshReview]), true)
  })

  it('never conflates a review/completion with a DIFFERENT game, even for the same actor', () => {
    const otherGame = { ...realFreshReview, game: { id: 999999 } }
    assert.equal(isDuplicateCompletionOrReview(otherGame, [realCompletionOnScreen]), false)
  })

  it('never conflates a review/completion with a DIFFERENT actor, even for the same game', () => {
    const otherActor = { ...realFreshReview, author: { id: 'someone-else' } }
    assert.equal(isDuplicateCompletionOrReview(otherActor, [realCompletionOnScreen]), false)
  })

  it('does not suppress once the two events are more than 24h apart', () => {
    const farLater = {
      ...realFreshReview,
      createdAt: '2026-09-19T13:47:36.102578+00:00', // +48h
    }
    assert.equal(isDuplicateCompletionOrReview(farLater, [realCompletionOnScreen]), false)
  })

  it('ignores item types outside the finished/reviewed pair (e.g. started, listed)', () => {
    const started = { ...realFreshReview, type: 'started' }
    assert.equal(isDuplicateCompletionOrReview(started, [realCompletionOnScreen]), false)
  })

  it('is a no-op against an empty on-screen list', () => {
    assert.equal(isDuplicateCompletionOrReview(realFreshReview, []), false)
  })
})
