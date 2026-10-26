import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Checkpoint Plus — "Export my data".
 *
 * Builds one JSON file (everything) and one CSV (the same records flattened,
 * one row each, told apart by the `record` column) from the signed-in user's
 * OWN rows only: every query filters on user_id, and nothing from other
 * users (no author embeds, no saved lists, no followers) is read.
 *
 * On iOS the two files are written to the cache directory and handed to the
 * system share sheet via @capacitor/share (Save to Files, AirDrop, Mail…).
 * Share only accepts file:// URLs, which is why @capacitor/filesystem is used
 * to write them. On the web they download.
 */

const PAGE_SIZE = 1000

const STATUS_LABELS = Object.freeze({
  want_to_play: 'Backlog (Want to Play)',
  playing: 'Currently Playing',
  played: 'Played',
  dropped: 'Dropped',
})

const CSV_COLUMNS = [
  'record',
  'game_id',
  'game_title',
  'status',
  'rating',
  'hours',
  'date_added',
  'date_updated',
  'title',
  'text',
  'mood',
  'spoiler',
  'list_name',
  'list_public',
  'position',
]

/** Every row of a query, page by page, ordered by id so pages never overlap. */
async function fetchAll(label, buildQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[export] ${label} failed:`, error.message)
      throw new Error(`Could not read your ${label}.`)
    }
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function idOf(value) {
  return value == null ? null : String(value)
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Read the signed-in user's own data.
 * @returns {Promise<object>} the JSON export document
 */
export async function buildExportData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) throw new Error('Sign in to export your data.')
  const userId = user.id

  const [trackers, reviews, journal, lists] = await Promise.all([
    fetchAll('library', () =>
      supabase.from('game_trackers').select('*').eq('user_id', userId)
    ),
    fetchAll('reviews', () =>
      supabase
        .from('reviews')
        .select(
          'id, igdb_game_id, game_title, rating, body, liked, has_spoilers, hours_played, vibe_stamp, life_context, created_at, updated_at'
        )
        .eq('user_id', userId)
    ),
    fetchAll('journal entries', () =>
      supabase
        .from('journal_entries')
        .select('id, igdb_game_id, game_title, title, body, is_spoiler, mood, hours_played, created_at')
        .eq('user_id', userId)
    ),
    fetchAll('lists', () =>
      supabase
        .from('lists')
        .select(
          'id, name, description, is_public, created_at, updated_at, list_games(igdb_game_id, game_title, position, added_at)'
        )
        .eq('user_id', userId)
    ),
  ])

  const ratingByGame = new Map()
  for (const r of reviews) {
    if (r.rating != null) ratingByGame.set(idOf(r.igdb_game_id), r.rating)
  }

  return {
    app: 'Checkpoint',
    exportedAt: new Date().toISOString(),
    library: trackers.map((t) => ({
      gameId: idOf(t.igdb_game_id),
      gameTitle: t.game_title || '',
      status: STATUS_LABELS[t.status] || t.status || '',
      rating: numberOrNull(ratingByGame.get(idOf(t.igdb_game_id))),
      hoursPlayed: numberOrNull(t.hours_played),
      dateAdded: t.created_at || null,
      dateUpdated: t.updated_at || null,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      gameId: idOf(r.igdb_game_id),
      gameTitle: r.game_title || '',
      rating: numberOrNull(r.rating),
      text: r.body || '',
      liked: r.liked === true,
      containsSpoilers: r.has_spoilers === true,
      hoursPlayed: numberOrNull(r.hours_played),
      vibeStamp: r.vibe_stamp || null,
      lifeContext: r.life_context || null,
      dateWritten: r.created_at || null,
      dateUpdated: r.updated_at || null,
    })),
    journal: journal.map((j) => ({
      id: j.id,
      gameId: idOf(j.igdb_game_id),
      gameTitle: j.game_title || '',
      title: j.title || '',
      text: j.body || '',
      mood: j.mood || null,
      containsSpoilers: j.is_spoiler === true,
      hoursPlayed: numberOrNull(j.hours_played),
      dateWritten: j.created_at || null,
    })),
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name || '',
      description: l.description || '',
      isPublic: l.is_public !== false,
      dateCreated: l.created_at || null,
      dateUpdated: l.updated_at || null,
      games: (l.list_games || [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((g) => ({
          gameId: idOf(g.igdb_game_id),
          gameTitle: g.game_title || '',
          position: g.position ?? null,
          dateAdded: g.added_at || null,
        })),
    })),
  }
}

/* ============================================================
   CSV
   ============================================================ */

/**
 * One CSV cell. Free text that starts with = + - @ is prefixed with an
 * apostrophe so a spreadsheet never runs it as a formula; numbers are left
 * alone.
 */
function cell(value) {
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(data) {
  const rows = []
  const push = (record, fields) => {
    rows.push(CSV_COLUMNS.map((col) => (col === 'record' ? record : cell(fields[col]))).join(','))
  }

  for (const g of data.library) {
    push('library', {
      game_id: g.gameId,
      game_title: g.gameTitle,
      status: g.status,
      rating: g.rating,
      hours: g.hoursPlayed,
      date_added: g.dateAdded,
      date_updated: g.dateUpdated,
    })
  }
  for (const r of data.reviews) {
    push('review', {
      game_id: r.gameId,
      game_title: r.gameTitle,
      rating: r.rating,
      hours: r.hoursPlayed,
      date_added: r.dateWritten,
      date_updated: r.dateUpdated,
      text: r.text,
      spoiler: r.containsSpoilers,
    })
  }
  for (const j of data.journal) {
    push('journal', {
      game_id: j.gameId,
      game_title: j.gameTitle,
      hours: j.hoursPlayed,
      date_added: j.dateWritten,
      title: j.title,
      text: j.text,
      mood: j.mood,
      spoiler: j.containsSpoilers,
    })
  }
  for (const l of data.lists) {
    push('list', {
      date_added: l.dateCreated,
      date_updated: l.dateUpdated,
      text: l.description,
      list_name: l.name,
      list_public: l.isPublic,
    })
    for (const g of l.games) {
      push('list_game', {
        game_id: g.gameId,
        game_title: g.gameTitle,
        date_added: g.dateAdded,
        list_name: l.name,
        position: g.position,
      })
    }
  }

  // BOM so Excel and Numbers read the file as UTF-8.
  return `\uFEFF${CSV_COLUMNS.join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`
}

/* ============================================================
   Delivery
   ============================================================ */

function isShareCancel(err) {
  return /cancel/i.test(String(err?.message || err))
}

async function shareNative(files) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const written = []
  try {
    const uris = []
    for (const file of files) {
      const path = `exports/${file.name}`
      const { uri } = await Filesystem.writeFile({
        path,
        data: file.text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      })
      written.push(path)
      uris.push(uri)
    }
    await Share.share({
      title: 'Checkpoint data export',
      files: uris,
      dialogTitle: 'Export my data',
    })
    return { status: 'shared' }
  } catch (err) {
    if (isShareCancel(err)) return { status: 'cancelled' }
    throw err
  } finally {
    for (const path of written) {
      Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {})
    }
  }
}

function downloadInBrowser(files) {
  for (const file of files) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return { status: 'downloaded' }
}

/**
 * Build the export and hand it to the user.
 * @returns {Promise<{ status: 'shared' | 'cancelled' | 'downloaded' }>}
 */
export async function exportMyData() {
  const data = await buildExportData()
  const stamp = data.exportedAt.slice(0, 10)
  const files = [
    {
      name: `checkpoint-export-${stamp}.json`,
      mime: 'application/json',
      text: JSON.stringify(data, null, 2),
    },
    {
      name: `checkpoint-export-${stamp}.csv`,
      mime: 'text/csv;charset=utf-8',
      text: toCsv(data),
    },
  ]
  return Capacitor.isNativePlatform() ? shareNative(files) : downloadInBrowser(files)
}
