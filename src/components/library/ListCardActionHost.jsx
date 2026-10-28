import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActionSheet from '../ActionSheet'
import CollaboratorSheet from '../CollaboratorSheet'
import DeleteConfirmModal from '../DeleteConfirmModal'
import DmShareSheet from '../DmShareSheet'
import { showToast } from '../Toast'
import {
  deleteList,
  getCollaborators,
  pinList,
  unpinList,
} from '../../services/listService'

export function isListCardOwner(list, currentUserId) {
  return !!(list?.isCustom && currentUserId && currentUserId === list.userId)
}

export function canShareListCard(list, currentUserId) {
  return !!(list?.isCustom && list?.isPublic && currentUserId)
}

/** Owner menu, visitor Share-only, or nothing. */
export function listCardMenuKind(list, currentUserId) {
  if (isListCardOwner(list, currentUserId)) return 'owner'
  if (canShareListCard(list, currentUserId)) return 'share'
  return null
}

function listShareAttachment(list) {
  const count = list?.gameCount ?? list?.games?.length ?? 0
  return {
    type: 'list',
    id: list.id,
    title: list.name || 'List',
    cover_url: list.coverImageUrl || list.games?.[0]?.image || null,
    subtitle: `${count} ${count === 1 ? 'game' : 'games'}`,
    url_path: `/list/${list.id}`,
  }
}

/**
 * Sheets that back the Library list-card long-press menu.
 * Reuses List Detail's Share / collaborators / pin / delete entry points.
 */
export default function ListCardActionHost({
  list,
  currentUserId,
  sheetOpen,
  onCloseSheet,
}) {
  const navigate = useNavigate()
  const [dmShareOpen, setDmShareOpen] = useState(false)
  const [showCollaboratorSheet, setShowCollaboratorSheet] = useState(false)
  const [collaborators, setCollaborators] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isOwner = isListCardOwner(list, currentUserId)
  const kind = listCardMenuKind(list, currentUserId)

  const handleEditDescription = useCallback(() => {
    if (!list?.id) return
    navigate(`/list/${list.id}`, { state: { editDescription: true } })
  }, [list, navigate])

  const handleShare = useCallback(() => {
    setDmShareOpen(true)
  }, [])

  const handlePinToggle = useCallback(async () => {
    if (!list?.id || !isOwner) return
    const wasPin = !!list.isPinned
    try {
      if (wasPin) {
        await unpinList(list.id)
        showToast('Unpinned', 'success', null, null, 'pin-off')
      } else {
        await pinList(list.id)
        showToast('Pinned to profile', 'success', null, null, 'pin', { tone: 'list' })
      }
    } catch (err) {
      if (err?.code === 'LIST_PINS_FULL') {
        showToast('You can only pin 5 lists', 'error', null, null, null, { sub: 'Unpin one first' })
      } else {
        showToast(wasPin ? "Couldn't unpin that list" : "Couldn't pin that list", 'error', null, null, null, {
          sub: 'Try again',
        })
      }
    }
  }, [list, isOwner])

  const handleManageCollaborators = useCallback(async () => {
    if (!list?.id || !isOwner) return
    setCollaborators([])
    setShowCollaboratorSheet(true)
    const rows = await getCollaborators(list.id)
    setCollaborators(rows)
  }, [list, isOwner])

  const handleDeleteConfirmed = useCallback(async () => {
    if (!list?.id || !isOwner) return
    setShowDeleteConfirm(false)
    const name = list.name
    try {
      await deleteList(list.id)
      showToast('List deleted', 'success', 3500, null, 'trash', { sub: name })
    } catch {
      showToast("Couldn't delete the list", 'error', null, null, null, { sub: 'Try again' })
    }
  }, [list, isOwner])

  const items = !list || !kind
    ? []
    : kind === 'share'
      ? [{ label: 'Share', onClick: handleShare }]
      : [
          {
            label: list.description?.trim() ? 'Edit description' : 'Add a description',
            onClick: handleEditDescription,
          },
          { label: 'Share', onClick: handleShare },
          {
            label: list.isPinned ? 'Unpin from profile' : 'Pin to profile',
            onClick: handlePinToggle,
          },
          {
            label: 'Manage collaborators',
            onClick: handleManageCollaborators,
          },
          {
            label: 'Delete list',
            destructive: true,
            onClick: () => setShowDeleteConfirm(true),
          },
        ]

  return (
    <>
      <ActionSheet
        isOpen={sheetOpen && items.length > 0}
        onClose={onCloseSheet}
        items={items}
      />

      <DmShareSheet
        isOpen={dmShareOpen}
        onClose={() => setDmShareOpen(false)}
        attachment={list ? listShareAttachment(list) : null}
      />

      <CollaboratorSheet
        isOpen={showCollaboratorSheet}
        onClose={() => setShowCollaboratorSheet(false)}
        listId={list?.id}
        isOwner={isOwner}
        currentUserId={currentUserId}
        collaborators={collaborators}
        onChanged={async () => {
          if (list?.id) {
            setCollaborators(await getCollaborators(list.id))
          }
          setShowCollaboratorSheet(false)
        }}
      />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        listName={list?.name ?? ''}
        gameCount={list?.gameCount ?? list?.games?.length ?? 0}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  )
}
