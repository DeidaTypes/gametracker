import React from 'react'

export default function LibraryTabs({
  activeTab,
  gamesCount,
  listsCount,
  onTabChange,
  gamesTabId = 'lib-tab-games',
  listsTabId = 'lib-tab-lists',
  gamesPanelId = 'lib-panel-games',
  listsPanelId = 'lib-panel-lists',
}) {
  const isGamesTab = activeTab === 'games'

  return (
    <div className="lib-seg" role="tablist" aria-label="Library view">
      <button
        type="button"
        role="tab"
        id={gamesTabId}
        aria-selected={isGamesTab}
        aria-controls={gamesPanelId}
        className={`lib-segb${isGamesTab ? ' lib-segb--games-on' : ''}`}
        onClick={() => onTabChange('games')}
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
        onClick={() => onTabChange('lists')}
      >
        Lists
        <span className="lib-seg-n">{listsCount}</span>
      </button>
    </div>
  )
}
