import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HALF_STAR_BUCKETS,
  emptyHalfStarCounts,
  toHalfStarBucket,
} from './ratingBuckets.js'
import { getStarRatingFillPercent } from '../components/starRatingConfig.js'

describe('half-star rating buckets', () => {
  it('keeps 3.5 in the 3.5 bucket instead of snapping to 4', () => {
    assert.equal(toHalfStarBucket(3.5), 3.5)
    assert.notEqual(toHalfStarBucket(3.5), 4)
  })

  it('snaps onto 0.5 steps from 0.5 to 5', () => {
    assert.equal(toHalfStarBucket(0.5), 0.5)
    assert.equal(toHalfStarBucket(1), 1)
    assert.equal(toHalfStarBucket(4.5), 4.5)
    assert.equal(toHalfStarBucket(5), 5)
    assert.deepEqual(HALF_STAR_BUCKETS, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
  })

  it('exposes a 3.5 key in the empty histogram map', () => {
    const counts = emptyHalfStarCounts()
    assert.equal(counts[3.5], 0)
    assert.equal(counts[4], 0)
    assert.ok(!Object.prototype.hasOwnProperty.call(counts, 6))
  })
})

describe('StarRatingDisplay fill (do not Math.round before passing rating)', () => {
  it('renders 3.5 as a half-filled fourth star (70%), not a full 4 (80%)', () => {
    assert.equal(getStarRatingFillPercent(3.5), 70)
    assert.notEqual(getStarRatingFillPercent(3.5), getStarRatingFillPercent(4))
    assert.equal(getStarRatingFillPercent(Math.round(3.5)), 80)
  })
})
