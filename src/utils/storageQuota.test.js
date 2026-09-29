import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  claimStorageFullAnnouncement,
  setLocalStorageItem,
} from './storageQuota.js'

// Models the WKWebView bug this helper exists for: setItem keeps the old
// value allocated while it copies the new one in, so a shrinking rewrite
// throws QuotaExceededError even when the new value would fit alone.
function installWebKitStorage(quota) {
  const data = new Map()
  const used = (map) => {
    let n = 0
    for (const value of map.values()) n += value.length
    return n
  }
  const storage = {
    get length() {
      return data.size
    },
    key(i) {
      return [...data.keys()][i] ?? null
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    removeItem(key) {
      data.delete(key)
    },
    setItem(key, value) {
      const next = String(value)
      // Old value stays charged. New value is charged on top.
      const bytes = used(data) + next.length
      if (bytes > quota) {
        const err = new Error('The quota has been exceeded.')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      data.set(key, next)
    },
  }
  globalThis.localStorage = storage
  return data
}

afterEach(() => {
  delete globalThis.localStorage
})

describe('setLocalStorageItem', () => {
  it('replaces a large key when WebKit double-counts the old value', () => {
    const data = installWebKitStorage(100)
    data.set('gameLibrary', 'x'.repeat(80))

    const result = setLocalStorageItem('gameLibrary', 'y'.repeat(40))

    assert.equal(result.ok, true)
    assert.equal(result.quota, true)
    assert.equal(data.get('gameLibrary'), 'y'.repeat(40))
  })

  it('drops a disposable cache so the user key can be written', () => {
    const data = installWebKitStorage(100)
    data.set('search_cache_v3', 'c'.repeat(80))

    const result = setLocalStorageItem('gameLibrary', 'g'.repeat(50))

    assert.equal(result.ok, true)
    assert.equal(result.quota, true)
    assert.equal(data.has('search_cache_v3'), false)
    assert.equal(data.get('gameLibrary'), 'g'.repeat(50))
  })

  it('drops an already-migrated reviews blob', () => {
    const data = installWebKitStorage(100)
    data.set('gameReviews_migratedToSupabase', 'user-1')
    data.set('gameReviews', 'r'.repeat(70))

    const result = setLocalStorageItem('gameLibrary', 'g'.repeat(50))

    assert.equal(result.ok, true)
    assert.equal(data.has('gameReviews'), false)
    assert.equal(data.get('gameLibrary'), 'g'.repeat(50))
  })

  it('keeps an unmigrated reviews blob and restores the previous value', () => {
    const data = installWebKitStorage(100)
    data.set('gameReviews', 'r'.repeat(70))
    data.set('gameLibrary', 'old')

    const result = setLocalStorageItem('gameLibrary', 'g'.repeat(50))

    assert.equal(result.ok, false)
    assert.equal(result.quota, true)
    assert.equal(data.get('gameReviews'), 'r'.repeat(70))
    assert.equal(data.get('gameLibrary'), 'old')
  })

  it('does not treat a non-quota failure as quota and does not remove the key', () => {
    const data = new Map([['gameLibrary', 'safe']])
    globalThis.localStorage = {
      getItem(key) {
        return data.has(key) ? data.get(key) : null
      },
      removeItem(key) {
        data.delete(key)
      },
      setItem() {
        const err = new Error('The operation is insecure.')
        err.name = 'SecurityError'
        err.code = 18
        throw err
      },
    }

    const result = setLocalStorageItem('gameLibrary', 'next')

    assert.deepEqual(result, { ok: false, quota: false })
    assert.equal(data.get('gameLibrary'), 'safe')
  })
})

describe('claimStorageFullAnnouncement', () => {
  it('is true once per page load', () => {
    assert.equal(claimStorageFullAnnouncement(), true)
    assert.equal(claimStorageFullAnnouncement(), false)
  })
})
