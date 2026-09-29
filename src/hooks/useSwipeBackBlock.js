import { useEffect } from 'react'

/** Ref-counted guard — while active, SwipeBackWrapper ignores edge swipes. */
let blockCount = 0

export function isSwipeBackBlocked() {
  return blockCount > 0
}

function pushBlock() {
  blockCount += 1
}

function popBlock() {
  blockCount = Math.max(0, blockCount - 1)
}

/** Block native edge swipe-back for this subtree (e.g. list clear mode). */
export function useSwipeBackBlock(active = false) {
  useEffect(() => {
    if (!active) return undefined
    pushBlock()
    return () => popBlock()
  }, [active])
}
