import { supabase } from './supabase'

/**
 * Player Level reads. XP is written only by the database
 * (private.award_xp). Nothing in here inserts, updates, or totals an award
 * the server did not already record.
 *
 * Failures log and return null / 0 / []. A missed read must never block
 * the screen or the notice that triggered it.
 */

const RECENT_WINDOW_MS = 2 * 60 * 1000

function logXp(method, err) {
  const message = err?.message || err
  console.error(`[xp] ${method} failed:`, message)
}

async function ownUserId() {
  try {
    const { data: { user } = {}, error } = await supabase.auth.getUser()
    if (error || !user?.id) return null
    return user.id
  } catch (err) {
    logXp('ownUserId', err)
    return null
  }
}

function localMidnightIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

/**
 * Anyone's level. xp_total and level are readable by visitors.
 * @returns {Promise<{ xpTotal: number, level: number } | null>}
 */
export async function getUserLevel(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('users')
      .select('xp_total, level')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      logXp('getUserLevel', error)
      return null
    }
    if (!data) return null
    return {
      xpTotal: Number(data.xp_total) || 0,
      level: Number(data.level) || 1,
    }
  } catch (err) {
    logXp('getUserLevel', err)
    return null
  }
}

/**
 * The signed-in player's level, including the highest level the app has
 * already shown. levelSeen null means the account existed before levels
 * shipped.
 * @returns {Promise<{ xpTotal: number, level: number, levelSeen: number | null } | null>}
 */
export async function getMyLevelState() {
  try {
    const userId = await ownUserId()
    if (!userId) return null
    const { data, error } = await supabase
      .from('users')
      .select('xp_total, level, level_seen')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      logXp('getMyLevelState', error)
      return null
    }
    if (!data) return null
    return {
      xpTotal: Number(data.xp_total) || 0,
      level: Number(data.level) || 1,
      levelSeen: data.level_seen == null ? null : Number(data.level_seen),
    }
  } catch (err) {
    logXp('getMyLevelState', err)
    return null
  }
}

/** Sum of the signed-in player's XP since local midnight. */
export async function getMyXpToday() {
  try {
    const userId = await ownUserId()
    if (!userId) return 0
    const { data, error } = await supabase
      .from('xp_events')
      .select('amount')
      .eq('user_id', userId)
      .gte('created_at', localMidnightIso())
    if (error) {
      logXp('getMyXpToday', error)
      return 0
    }
    let sum = 0
    for (const row of data || []) sum += Number(row.amount) || 0
    return sum
  } catch (err) {
    logXp('getMyXpToday', err)
    return 0
  }
}

/**
 * The signed-in player's newest XP rows.
 * @returns {Promise<Array<{ source: string, ref: string, amount: number, createdAt: string }>>}
 */
export async function getMyRecentXp(limit = 30) {
  try {
    const userId = await ownUserId()
    if (!userId) return []
    const n = Math.max(1, Math.floor(Number(limit) || 30))
    const { data, error } = await supabase
      .from('xp_events')
      .select('source, ref, amount, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(n)
    if (error) {
      logXp('getMyRecentXp', error)
      return []
    }
    return (data || []).map((row) => ({
      source: row.source,
      ref: row.ref,
      amount: Number(row.amount) || 0,
      createdAt: row.created_at,
    }))
  } catch (err) {
    logXp('getMyRecentXp', err)
    return []
  }
}

/**
 * Sum of the signed-in player's awards matching any { source, ref } key
 * and created in the last 2 minutes. An edit of something awarded earlier
 * sums to 0, so the notice stays quiet.
 * @param {Array<{ source: string, ref: string }>} keys
 * @returns {Promise<number>}
 */
export async function getXpAwarded(keys) {
  try {
    const list = (Array.isArray(keys) ? keys : []).filter(
      (key) => key && key.source && key.ref != null && key.ref !== ''
    )
    if (list.length === 0) return 0
    const userId = await ownUserId()
    if (!userId) return 0
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
    const { data, error } = await supabase
      .from('xp_events')
      .select('source, ref, amount')
      .eq('user_id', userId)
      .gte('created_at', since)
    if (error) {
      logXp('getXpAwarded', error)
      return 0
    }
    const wanted = new Set(list.map((key) => `${key.source}\0${String(key.ref)}`))
    let sum = 0
    for (const row of data || []) {
      if (wanted.has(`${row.source}\0${row.ref}`)) sum += Number(row.amount) || 0
    }
    return sum
  } catch (err) {
    logXp('getXpAwarded', err)
    return 0
  }
}

/**
 * Tell the server which level the app has shown. Logs and never throws.
 * The RPC clamps to the player's real level.
 */
export async function acknowledgeLevel(level) {
  try {
    const { error } = await supabase.rpc('acknowledge_my_level', { p_level: level })
    if (error) logXp('acknowledgeLevel', error)
  } catch (err) {
    logXp('acknowledgeLevel', err)
  }
}
