import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { LuPlus, LuPencilLine, LuListPlus, LuCircleCheck, LuChevronRight } from 'react-icons/lu'
import ActionSheet from './ActionSheet'
import CreateListModal from './CreateListModal'
import GamePickerSheet from './GamePickerSheet'
import Pressable from './Pressable'
import { createList, addGameToList } from '../services/listService'
import { showToast } from './Toast'
import './HomeFAB.css'

function FabRow({ Icon, label }) {
  return (
    <span className="home-fab-row">
      <Icon size={24} className="home-fab-row__icon" aria-hidden="true" />
      <span className="home-fab-row__label">{label}</span>
      <LuChevronRight size={16} className="home-fab-row__chevron" aria-hidden="true" />
    </span>
  )
}

function HomeFAB() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [createListOpen, setCreateListOpen] = useState(false)
  const [gamePickerOpen, setGamePickerOpen] = useState(false)
  const fabRef = useRef(null)
  const navigate = useNavigate()

  // pendingFocusRef is set true when the sheet closes via Cancel/ESC/backdrop.
  // item.onClick handlers that open another view cancel it before the effect runs.
  const pendingFocusRef = useRef(false)

  const handleSheetOpen = () => setSheetOpen(true)

  const handleSheetClose = () => {
    pendingFocusRef.current = true
    setSheetOpen(false)
  }

  // Return focus to FAB when sheet dismisses without opening another view.
  useEffect(() => {
    if (!sheetOpen && pendingFocusRef.current) {
      pendingFocusRef.current = false
      fabRef.current?.focus()
    }
  }, [sheetOpen])

  // Return focus to FAB when Create List modal closes.
  const prevCreateListOpenRef = useRef(false)
  useEffect(() => {
    if (prevCreateListOpenRef.current && !createListOpen) {
      fabRef.current?.focus()
    }
    prevCreateListOpenRef.current = createListOpen
  }, [createListOpen])

  const handleCreateList = async (listName, description, initialGames) => {
    const listId = await createList({ name: listName, description, isPublic: true })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  const handleWriteReview = () => {
    // Cancel focus-return because the picker sheet is opening instead
    pendingFocusRef.current = false
    setGamePickerOpen(true)
  }

  const handleGamePicked = (game) => {
    setGamePickerOpen(false)
    navigate(`/review/new?gameId=${game.id}`, { state: { game } })
  }

  const handleGamePickerCancel = () => {
    setGamePickerOpen(false)
    fabRef.current?.focus()
  }

  const sheetItems = [
    {
      label: <FabRow Icon={LuPencilLine} label="Write a review" />,
      onClick: handleWriteReview,
    },
    {
      label: <FabRow Icon={LuListPlus} label="Create a list" />,
      onClick: () => {
        // Cancel focus-return because a modal is opening instead
        pendingFocusRef.current = false
        setCreateListOpen(true)
      },
    },
    {
      label: <FabRow Icon={LuCircleCheck} label="Log a played game" />,
      onClick: () => navigate('/library?action=add'),
    },
  ]

  return createPortal(
    <>
      <Pressable
        ref={fabRef}
        className="home-fab"
        aria-label="Quick actions"
        onClick={handleSheetOpen}
      >
        <LuPlus size={24} strokeWidth={2.5} aria-hidden="true" />
      </Pressable>

      <ActionSheet
        isOpen={sheetOpen}
        onClose={handleSheetClose}
        title="What do you want to do?"
        items={sheetItems}
      />

      <CreateListModal
        isOpen={createListOpen}
        onClose={() => setCreateListOpen(false)}
        onCreate={handleCreateList}
      />

      <GamePickerSheet
        isOpen={gamePickerOpen}
        onSelect={handleGamePicked}
        onCancel={handleGamePickerCancel}
      />
    </>,
    document.body,
  )
}

export default HomeFAB
