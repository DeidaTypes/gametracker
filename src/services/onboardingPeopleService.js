import { supabase } from './supabase'
import { applyBlockFilter, filterBlockedRows, getBlockedIdsSync } from './blockService'
import { HALF_STAR_BUCKETS } from '../utils/ratingBuckets'

/**
 * Step 5 suggestions. Real rows only, in this order, de-duplicated, capped
 * at 4. Each source fails soft (empty). Never the viewer, never a blocked
 * account.
 *
 * favorite_games.id is the IGDB id the picker stored (userService
 * updateUserProfile writes `id: g.id`). Rows in the wild store that id as
 * either a JSON number or a numeric string, and jsonb @> is type-sensitive,
 * so each pick is probed once as a number and once as a string.
 *
 * supabase-js contains() turns a JS array into a Postgres array literal
 * (`cs.{...}`), which does not match a jsonb array. The probe is passed as
 * a JSON string so the filter is `cs.[{"id":N}]`.
 */

const FOUNDER_USERNAME = 'theantifail'
const MAX_PEOPLE = 4

// Ids PlatformStep writes onto users.platforms. Labels are the words on
// those tiles, which is what the reason says.
const PLATFORM_LABELS = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  nintendo: 'Nintendo',
  pc: 'PC',
  mobile: 'Mobile',
  retro: 'Retro',
}

// reviews.rating is 0.5–5.0 in half-star steps (reviewService). The top
// bucket is what "5 stars" means.
const TOP_RATING = HALF_STAR_BUCKETS[HALF_STAR_BUCKETS.length - 1]

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b)
}

/** Number when the id is a safe integer, otherwise the value as stored. */
function favoriteProbeId(id) {
  if (typeof id === 'number' && Number.isSafeInteger(id)) return id
  if (typeof id === 'string' && /^-?\d+$/.test(id)) {
    const n = Number(id)
    if (Number.isSafeInteger(n)) return n
  }
  return id
}

/**
 * Both JSON types that actually appear in favorite_games.id. A number
 * probe does not match a string id, and the reverse is also true.
 */
function containmentProbes(id) {
  const probes = []
  const push = (value) => {
    const key = `${typeof value}:${value}`
    if (probes.some((probe) => `${typeof probe}:${probe}` === key)) return
    probes.push(value)
  }
  if (typeof id === 'number' && Number.isSafeInteger(id)) {
    push(id)
    push(String(id))
  } else if (typeof id === 'string' && /^-?\d+$/.test(id)) {
    const n = Number(id)
    if (Number.isSafeInteger(n)) push(n)
    push(id)
  } else if (id != null && id !== '') {
    push(id)
  }
  return probes
}

function normalizePicks(favorites) {
  const out = []
  const seen = new Set()
  for (const g of Array.isArray(favorites) ? favorites : []) {
    if (g?.id == null || g.id === '') continue
    const id = favoriteProbeId(g.id)
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    const title = typeof g.title === 'string' ? g.title.trim() : ''
    out.push({ id, title })
  }
  return out.slice(0, MAX_PEOPLE)
}

function titleFrom(favs, id) {
  const match = (favs || []).find((g) => sameId(g?.id, id))
  return typeof match?.title === 'string' ? match.title.trim() : ''
}

function lovesReason(titles) {
  const names = titles.filter(Boolean).slice(0, 2)
  if (names.length === 0) return null
  if (names.length === 1) return `Also loves ${names[0]}`
  return `Also loves ${names[0]} and ${names[1]}`
}

function ratedReason(title) {
  const n = Number(TOP_RATING)
  const shown = Number.isInteger(n) ? String(n) : String(n)
  const unit = n === 1 ? 'star' : 'stars'
  return `Rated ${title} ${shown} ${unit} too`
}

function platformReason(labels) {
  const names = labels.filter(Boolean).slice(0, 2)
  if (names.length === 0) return null
  if (names.length === 1) return `Plays on ${names[0]}, like you`
  return `Plays on ${names[0]} and ${names[1]}, like you`
}

function toPerson(row, reason) {
  if (!row?.id || !reason) return null
  const username = typeof row.username === 'string' ? row.username.trim() : ''
  const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : ''
  if (!username && !displayName) return null
  return {
    id: row.id,
    username,
    displayName,
    avatarUrl: row.avatar_url || null,
    reason,
  }
}

function viewerPlatforms(platforms) {
  const out = []
  const seen = new Set()
  for (const id of Array.isArray(platforms) ? platforms : []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    const label = PLATFORM_LABELS[id]
    if (!label) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

async function founderPerson(picks, viewerId) {
  try {
    let q = supabase
      .from('public_profiles')
      .select('id, username, display_name, avatar_url, favorite_games')
      .ilike('username', FOUNDER_USERNAME)
    if (viewerId) q = q.neq('id', viewerId)
    q = await applyBlockFilter(q, 'id')
    const { data, error } = await q.maybeSingle()
    if (error) {
      console.error('[onboarding-people] founder lookup failed:', error.message)
      return null
    }
    if (!data?.id || data.id === viewerId) return null
    const favs = Array.isArray(data.favorite_games) ? data.favorite_games : []
    let sharedTitle = ''
    for (const pick of picks) {
      if (!favs.some((g) => sameId(g?.id, pick.id))) continue
      sharedTitle = pick.title || titleFrom(favs, pick.id)
      if (sharedTitle) break
    }
    const reason = sharedTitle
      ? `Made Checkpoint · also loves ${sharedTitle}`
      : 'Made Checkpoint'
    return toPerson(data, reason)
  } catch (err) {
    console.error('[onboarding-people] founder lookup failed:', err)
    return null
  }
}

async function profilesForProbe(probe, viewerId) {
  try {
    let q = supabase
      .from('public_profiles')
      .select('id, username, display_name, avatar_url, favorite_games')
      .contains('favorite_games', JSON.stringify([{ id: probe }]))
      .limit(16)
    if (viewerId) q = q.neq('id', viewerId)
    q = await applyBlockFilter(q, 'id')
    const { data, error } = await q
    if (error) {
      console.error('[onboarding-people] shared favorite failed:', error.message)
      return []
    }
    return filterBlockedRows(data || [], 'id')
  } catch (err) {
    console.error('[onboarding-people] shared favorite failed:', err)
    return []
  }
}

async function profilesSharingFavorite(pick, viewerId) {
  const groups = await Promise.all(
    containmentProbes(pick.id).map((probe) => profilesForProbe(probe, viewerId))
  )
  const byId = new Map()
  for (const rows of groups) {
    for (const row of rows) {
      if (row?.id) byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

async function sharedFavoritePeople(picks, viewerId) {
  if (picks.length === 0) return []
  const groups = await Promise.all(
    picks.map((pick, index) =>
      profilesSharingFavorite(pick, viewerId).then((rows) => ({ pick, index, rows }))
    )
  )
  const byId = new Map()
  for (const { pick, index, rows } of groups) {
    for (const row of rows) {
      if (!row?.id || row.id === viewerId) continue
      const favs = Array.isArray(row.favorite_games) ? row.favorite_games : []
      if (!favs.some((g) => sameId(g?.id, pick.id))) continue
      const title = pick.title || titleFrom(favs, pick.id)
      if (!title) continue
      let entry = byId.get(row.id)
      if (!entry) {
        entry = { row, titles: [], firstIndex: index }
        byId.set(row.id, entry)
      }
      if (!entry.titles.includes(title)) entry.titles.push(title)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.titles.length - a.titles.length || a.firstIndex - b.firstIndex)
    .map((entry) => toPerson(entry.row, lovesReason(entry.titles)))
    .filter(Boolean)
}

async function topRatedPeople(picks, viewerId) {
  const ids = picks
    .map((p) => p.id)
    .filter((id) => typeof id === 'number' && Number.isSafeInteger(id))
  if (ids.length === 0) return []
  try {
    let q = supabase
      .from('reviews')
      .select(
        'user_id, igdb_game_id, game_title, rating, created_at, users!reviews_user_id_fkey(username, display_name, avatar_url)'
      )
      .in('igdb_game_id', ids)
      .eq('rating', TOP_RATING)
      .order('created_at', { ascending: false })
      .limit(24)
    if (viewerId) q = q.neq('user_id', viewerId)
    q = await applyBlockFilter(q, 'user_id')
    const { data, error } = await q
    if (error) {
      console.error('[onboarding-people] top ratings failed:', error.message)
      return []
    }
    const people = []
    const seen = new Set()
    for (const row of filterBlockedRows(data || [], 'user_id')) {
      if (!row?.user_id || seen.has(row.user_id) || row.user_id === viewerId) continue
      if (Number(row.rating) !== TOP_RATING) continue
      const user = Array.isArray(row.users) ? row.users[0] : row.users
      if (!user) continue
      const pick = picks.find((p) => sameId(p.id, row.igdb_game_id))
      const title =
        pick?.title || (typeof row.game_title === 'string' ? row.game_title.trim() : '')
      if (!title) continue
      seen.add(row.user_id)
      const person = toPerson(
        {
          id: row.user_id,
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
        },
        ratedReason(title)
      )
      if (person) people.push(person)
    }
    return people
  } catch (err) {
    console.error('[onboarding-people] top ratings failed:', err)
    return []
  }
}

async function platformPeople(platforms, viewerId) {
  const mine = viewerPlatforms(platforms)
  if (mine.length === 0) return []
  try {
    let q = supabase
      .from('users')
      .select('id, platforms')
      .overlaps('platforms', mine.map((p) => p.id))
      .limit(24)
    if (viewerId) q = q.neq('id', viewerId)
    q = await applyBlockFilter(q, 'id')
    const { data, error } = await q
    if (error) {
      console.error('[onboarding-people] shared platforms failed:', error.message)
      return []
    }
    const rows = filterBlockedRows(data || [], 'id').filter(
      (row) => row?.id && row.id !== viewerId
    )
    if (rows.length === 0) return []

    let profilesQuery = supabase
      .from('public_profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', rows.map((row) => row.id))
    profilesQuery = await applyBlockFilter(profilesQuery, 'id')
    const { data: profiles, error: profileErr } = await profilesQuery
    if (profileErr) {
      console.error('[onboarding-people] shared platforms failed:', profileErr.message)
      return []
    }
    const byId = new Map(filterBlockedRows(profiles || [], 'id').map((p) => [p.id, p]))
    const people = []
    for (const row of rows) {
      const profile = byId.get(row.id)
      if (!profile) continue
      const have = new Set(Array.isArray(row.platforms) ? row.platforms : [])
      const shared = mine.filter((p) => have.has(p.id)).map((p) => p.label)
      const person = toPerson(profile, platformReason(shared))
      if (person) people.push(person)
    }
    return people
  } catch (err) {
    console.error('[onboarding-people] shared platforms failed:', err)
    return []
  }
}

/**
 * Up to 4 people to follow: the founder, then shared favorites (most in
 * common first), then 5-star reviews of a picked favorite (newest first),
 * then shared platforms. Real rows only.
 *
 * @param {{ viewerId?: string|null, favorites?: Array, platforms?: string[] }} args
 * @returns {Promise<Array<{ id: string, username: string, displayName: string, avatarUrl: string|null, reason: string }>>}
 */
export async function getOnboardingPeople({ viewerId, favorites, platforms } = {}) {
  try {
    const picks = normalizePicks(favorites)
    const viewer = viewerId || null
    const [founder, sharers, rated, platformMatches] = await Promise.all([
      founderPerson(picks, viewer),
      sharedFavoritePeople(picks, viewer),
      topRatedPeople(picks, viewer),
      platformPeople(platforms, viewer),
    ])
    const picked = []
    const seen = new Set()
    if (viewer) seen.add(viewer)
    const blocked = getBlockedIdsSync()?.all
    const take = (person) => {
      if (!person?.id || seen.has(person.id) || picked.length >= MAX_PEOPLE) return
      if (blocked?.has(person.id)) return
      seen.add(person.id)
      picked.push(person)
    }
    take(founder)
    for (const person of sharers) take(person)
    for (const person of rated) take(person)
    for (const person of platformMatches) take(person)
    return picked
  } catch (err) {
    console.error('[onboarding-people] getOnboardingPeople failed:', err)
    return []
  }
}
