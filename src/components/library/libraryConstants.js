import { STATUS_META } from '../StatusChip'

// The four status cells of the My Games dashboard, in render order.
// `listId` is the localStorage tracker bucket (see libraryService.DEFAULT_LISTS)
// and `key` is the status tag carried on each combined game as `_status`.
// Own-Library data assembly still owns those buckets; the other-user
// screen only uses `key` / `label`.
export const STATUS_CELLS = [
  { key: 'want', label: STATUS_META.want.label, listId: 'want-to-play' },
  { key: 'currently', label: 'Playing', listId: 'currently-playing' },
  { key: 'played', label: STATUS_META.played.label, listId: 'played' },
  { key: 'dropped', label: STATUS_META.dropped.label, listId: 'dropped' },
]

// Sort options — only sorts backed by a real field on every game.
export const LIBRARY_SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title A–Z' },
]

export const LIBRARY_PAGE_SIZE = 30
