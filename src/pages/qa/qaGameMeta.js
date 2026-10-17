import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { coverUrlFromImageId, getGameById } from '../../services/igdb'
import { peekSWR } from '../../services/swrCache'
import { qaGameKey, qaQuestionKey } from '../../services/qaService'

function fromListItem(item) {
  if (!item?.game_title) return null
  return {
    title: item.game_title,
    coverImageId: item.game_cover_image_id || null,
    coverUrl: item.game_cover_image_id
      ? coverUrlFromImageId(item.game_cover_image_id, 'cover_big')
      : null,
  }
}

function peekCachedMeta(igdbId) {
  const id = String(igdbId)
  for (const filter of ['answered', 'unanswered']) {
    for (const sort of ['helpful', 'newest']) {
      const page = peekSWR(qaGameKey(id, filter, sort))
      const meta = fromListItem(page?.items?.[0])
      if (meta) return meta
    }
  }
  return null
}

/**
 * Resolve game title + cover for /qa/game/:igdbId from navigation state,
 * list payloads, question cache, or (last resort) IGDB.
 */
export function useQaGameMeta(igdbId, listItems, qaLoaded) {
  const { state } = useLocation()
  const stateGame = state?.game || state?.qaGame || null

  const fromState = useMemo(() => {
    if (!stateGame) return null
    const title = stateGame.game_title || stateGame.title || stateGame.name
    if (!title) return null
    const coverImageId =
      stateGame.game_cover_image_id ||
      stateGame.coverImageId ||
      stateGame.cover?.image_id ||
      null
    return {
      title: String(title).trim(),
      coverImageId: coverImageId ? String(coverImageId) : null,
      coverUrl: coverImageId ? coverUrlFromImageId(coverImageId, 'cover_big') : null,
    }
  }, [stateGame])

  const fromList = useMemo(() => fromListItem(listItems?.[0]), [listItems])

  const fromQuestionPeek = useMemo(() => {
    if (!igdbId) return null
    const qid = state?.fromQuestionId
    if (qid) {
      const payload = peekSWR(qaQuestionKey(qid))
      const q = payload?.question
      if (q && String(q.igdb_game_id) === String(igdbId)) {
        return {
          title: q.game_title,
          coverImageId: q.game_cover_image_id,
          coverUrl: q.game_cover_image_id
            ? coverUrlFromImageId(q.game_cover_image_id, 'cover_small')
            : null,
        }
      }
    }
    return peekCachedMeta(igdbId)
  }, [igdbId, state?.fromQuestionId])

  const merged = fromState || fromList || fromQuestionPeek

  const [igdbMeta, setIgdbMeta] = useState(null)

  useEffect(() => {
    if (!igdbId || merged?.title || !qaLoaded) return undefined
    let alive = true
    getGameById(igdbId)
      .then((game) => {
        if (!alive || !game?.title) return
        const coverId = game.cover?.image_id || null
        setIgdbMeta({
          title: game.title,
          coverImageId: coverId,
          coverUrl: coverId ? coverUrlFromImageId(coverId, 'cover_big') : game.image || null,
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [igdbId, merged?.title, qaLoaded])

  return merged || igdbMeta
}
