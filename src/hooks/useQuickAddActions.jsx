import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CreateListModal from '../components/CreateListModal'
import GamePickerSheet from '../components/GamePickerSheet'
import LogSheet from '../components/home/LogSheet'
import { createList, addGameToList } from '../services/listService'
import { logSession } from '../services/sessionService'
import { showToast } from '../components/Toast'
import { openReviewComposer as openReviewBox } from '../components/composer/ComposerHost'
import { hapticSuccess } from '../utils/haptics'

/**
 * Shared quick-add flows for HomeFAB and WebSidebar — same sheets, same
 * service calls, same toasts. `onInvoke` runs first (e.g. close radial/menu).
 */
export function useQuickAddActions({ onInvoke } = {}) {
  const navigate = useNavigate()
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logSheetGame, setLogSheetGame] = useState(null)
  const [logGamePickerOpen, setLogGamePickerOpen] = useState(false)
  const [createListOpen, setCreateListOpen] = useState(false)
  const [gamePickerOpen, setGamePickerOpen] = useState(false)

  function submitLoggedSession({ game, hours, notes, mood }) {
    logSession({
      gameId: game.id,
      hours,
      notes,
      mood,
      gameTitle: game.title,
      gameImage: game.image,
    }).then((result) => {
      if (result) {
        hapticSuccess()
        showToast(`Logged ${hours}h`, 'success', null, null, null, {
          image: game.image || null,
          sub: game.title,
          tone: 'saved',
          xp: [
            { source: 'session', ref: String(result.sessionRow.id) },
            ...(result.journalEntry?.id
              ? [{ source: 'journal', ref: String(result.journalEntry.id) }]
              : []),
          ],
        })
      } else {
        showToast("Couldn't log your session", 'error', 5000, {
          label: 'Retry',
          onClick: () => submitLoggedSession({ game, hours, notes, mood }),
        }, null, { sub: game.title })
      }
    })
  }

  const handleLog = () => {
    onInvoke?.()
    setLogSheetGame(null)
    setLogGamePickerOpen(true)
  }

  const handleLogGamePicked = (picked) => {
    setLogGamePickerOpen(false)
    setLogSheetGame(picked)
    setLogSheetOpen(true)
  }

  const handleReview = () => {
    onInvoke?.()
    setGamePickerOpen(true)
  }

  const handleList = () => {
    onInvoke?.()
    setCreateListOpen(true)
  }

  const handleMessage = () => {
    onInvoke?.()
    navigate('/messages')
  }

  const handleCreateList = async (listName, description, initialGames, isPublic = true) => {
    const listId = await createList({ name: listName, description, isPublic })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast('List created', 'success', null, null, null, {
      sub: listName,
      tone: 'list',
      xp: [{ source: 'list', ref: String(listId) }],
    })
    navigate(`/list/${listId}`)
  }

  const handleGamePicked = (game) => {
    setGamePickerOpen(false)
    openReviewBox({ game })
  }

  const runQuickAction = (id) => {
    const handlers = {
      log: handleLog,
      review: handleReview,
      list: handleList,
      message: handleMessage,
    }
    handlers[id]?.()
  }

  const quickAddPortals = (
    <>
      <LogSheet
        isOpen={logSheetOpen}
        onClose={() => {
          setLogSheetOpen(false)
          setLogSheetGame(null)
        }}
        game={logSheetGame}
        onLogIt={submitLoggedSession}
      />

      <GamePickerSheet
        isOpen={logGamePickerOpen}
        onSelect={handleLogGamePicked}
        onCancel={() => setLogGamePickerOpen(false)}
      />

      <CreateListModal
        isOpen={createListOpen}
        onClose={() => setCreateListOpen(false)}
        onCreate={handleCreateList}
      />

      <GamePickerSheet
        isOpen={gamePickerOpen}
        onSelect={handleGamePicked}
        onCancel={() => setGamePickerOpen(false)}
      />
    </>
  )

  return { runQuickAction, quickAddPortals }
}

export default useQuickAddActions