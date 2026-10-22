import React from 'react'
import { hapticImpact } from '../../utils/haptics'

export default function LibraryTabs({
  activeTab,
  gamesCount,
  listsCount,
  onTabChange,
  gamesTabId = 'lib-tab-games',
  listsTabId = 'lib-tab-lists',
  gamesPanelId = 'lib-panel-games',
  listsPanelId = 'lib-panel-lists',
  haptic = true,
}) {
  const isGamesTab = activeTab === 'games'

  // One Light tap, only when the tab actually changes. `haptic={false}` is for
  // inert placeholders (the loading skeleton) whose tabs change nothing.
  const select = (tab) => {
    if (haptic && tab !== activeTab) hapticImpact('Light')
    onTabChange(tab)
  }

  return (
    <div className="lib-seg" role="tablist" aria-label="Library view">
      <button
        type="button"
        role="tab"
        id={gamesTabId}
        aria-selected={isGamesTab}
        aria-controls={gamesPanelId}
        className={`lib-segb${isGamesTab ? ' lib-segb--games-on' : ''}`}
        onClick={() => select('games')}
      >
        My Games
        <span className="lib-seg-n">{gamesCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        id={listsTabId}
        aria-selected={!isGamesTab}
        aria-controls={listsPanelId}
        className={`lib-segb${!isGamesTab ? ' lib-segb--lists-on' : ''}`}
        onClick={() => select('lists')}
      >
        Lists
        <span className="lib-seg-n">{listsCount}</span>
      </button>
    </div>
  )
}
