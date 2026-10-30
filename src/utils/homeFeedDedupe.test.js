import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collapseRepeatMoments,
  isDuplicateCompletionOrReview,
  isRepeatMoment,
  momentKey,
} from './homeFeedDedupe.js'

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

// Synthetic pulse items. Same card shape getHomeFeed produces
// (author.id + game.id + createdAt). Not live rows.
const PERSON = 'person-a'
const OTHER = 'person-b'
const XCOM = 'xcom-2'
const PORTAL = 'portal-2'

function moment(id, type, createdAt, { authorId = PERSON, gameId = XCOM } = {}) {
  return {
    id,
    type,
    author: { id: authorId },
    game: { id: gameId },
    createdAt,
  }
}

describe('collapseRepeatMoments', () => {
  it('collapses six XCOM starts to the newest one', () => {
    const starts = [
      moment('sep29', 'started', '2026-09-29T16:00:00Z'),
      moment('sep27', 'started', '2026-09-27T16:00:00Z'),
      moment('sep25a', 'started', '2026-09-25T18:00:00Z'),
      moment('sep25b', 'started', '2026-09-25T15:00:00Z'),
      moment('sep25c', 'started', '2026-09-25T12:00:00Z'),
      moment('sep25d', 'started', '2026-09-25T09:00:00Z'),
    ]
    const out = collapseRepeatMoments(starts)
    assert.deepEqual(out.map((it) => it.id), ['sep29'])
  })

  it('hides a start older than a finish by the same person for the same game', () => {
    const items = [
      moment('finish', 'finished', '2026-09-09T18:00:00Z'),
      moment('start', 'started', '2026-09-04T12:00:00Z'),
    ]
    assert.deepEqual(collapseRepeatMoments(items).map((it) => it.id), ['finish'])
  })

  it('hides a start older than a written review of the same game', () => {
    const items = [
      moment('review', 'reviewed', '2026-09-29T18:00:00Z'),
      moment('start', 'started', '2026-09-25T12:00:00Z'),
    ]
    assert.deepEqual(collapseRepeatMoments(items).map((it) => it.id), ['review'])
  })

  it('keeps a start that is newer than a finish of the same game', () => {
    const items = [
      moment('start', 'started', '2026-09-29T18:00:00Z'),
      moment('finish', 'finished', '2026-09-09T12:00:00Z'),
    ]
    assert.deepEqual(
      collapseRepeatMoments(items).map((it) => it.id),
      ['start', 'finish']
    )
  })

  it('leaves different people and different games untouched', () => {
    const items = [
      moment('a', 'started', '2026-09-29T18:00:00Z', { authorId: PERSON, gameId: XCOM }),
      moment('b', 'started', '2026-09-28T18:00:00Z', { authorId: OTHER, gameId: XCOM }),
      moment('c', 'started', '2026-09-27T18:00:00Z', { authorId: PERSON, gameId: PORTAL }),
      moment('d', 'finished', '2026-09-26T18:00:00Z', { authorId: OTHER, gameId: PORTAL }),
    ]
    assert.deepEqual(
      collapseRepeatMoments(items).map((it) => it.id),
      ['a', 'b', 'c', 'd']
    )
  })

  it('keeps the newest finish and lets rows without a moment key pass through, in order', () => {
    const listed = { id: 'listed', type: 'listed', createdAt: '2026-09-28T12:00:00Z' }
    const noAuthor = {
      id: 'no-author',
      type: 'started',
      author: {},
      game: { id: XCOM },
      createdAt: '2026-09-01T12:00:00Z',
    }
    const items = [
      moment('finish-new', 'finished', '2026-09-29T18:00:00Z'),
      listed,
      moment('finish-old', 'finished', '2026-09-09T12:00:00Z'),
      noAuthor,
    ]
    const out = collapseRepeatMoments(items)
    assert.deepEqual(out.map((it) => it.id), ['finish-new', 'listed', 'no-author'])
    assert.equal(momentKey(listed), null)
    assert.equal(momentKey(noAuthor), null)
  })

  it('matches a numeric review game id to a string event game id', () => {
    const items = [
      moment('review', 'reviewed', '2026-09-29T18:00:00Z', { gameId: 72 }),
      moment('start', 'started', '2026-09-25T12:00:00Z', { gameId: '72' }),
    ]
    assert.deepEqual(collapseRepeatMoments(items).map((it) => it.id), ['review'])
  })
})

describe('isRepeatMoment', () => {
  it('flags a later start that shares a moment with one already on screen', () => {
    const onScreen = [moment('sep29', 'started', '2026-09-29T16:00:00Z')]
    const candidate = moment('sep27', 'started', '2026-09-27T16:00:00Z')
    assert.equal(isRepeatMoment(candidate, onScreen), true)
  })

  it('flags a start when a finish or review of that game is already on screen', () => {
    const start = moment('start', 'started', '2026-09-04T12:00:00Z')
    assert.equal(
      isRepeatMoment(start, [moment('finish', 'finished', '2026-09-09T18:00:00Z')]),
      true
    )
    assert.equal(
      isRepeatMoment(start, [moment('review', 'reviewed', '2026-09-10T18:00:00Z')]),
      true
    )
  })

  it('does not flag a different person or a different game', () => {
    const onScreen = [moment('finish', 'finished', '2026-09-09T18:00:00Z')]
    assert.equal(
      isRepeatMoment(moment('other', 'started', '2026-09-04T12:00:00Z', { authorId: OTHER }), onScreen),
      false
    )
    assert.equal(
      isRepeatMoment(moment('other-game', 'started', '2026-09-04T12:00:00Z', { gameId: PORTAL }), onScreen),
      false
    )
  })
})
