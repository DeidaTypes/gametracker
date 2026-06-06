import { supabase } from './supabase'

/**
 * Report Service — Supabase-backed.
 *
 * Reports table schema (see supabase/reports.sql):
 *   reports (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     reporter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     content_type  text NOT NULL CHECK (content_type IN ('review','comment','message','profile','list')),
 *     content_id    uuid NOT NULL,
 *     reason        text NOT NULL CHECK (reason IN (...)),
 *     details       text,
 *     status        text NOT NULL DEFAULT 'pending',
 *     created_at    timestamptz NOT NULL DEFAULT now(),
 *     reviewed_at   timestamptz,
 *     reviewer_notes text
 *   )
 *
 * RLS:
 *   INSERT: reporter_id = auth.uid()
 *   SELECT: reporter_id = auth.uid()
 *
 * Auto-hide: content with 5+ pending reports from distinct reporters
 * is surfaced via flagged_content_view. Read services (reviews,
 * comments, lists) filter that view before returning results.
 */

const AUTO_HIDE_THRESHOLD = 5

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[reports] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/**
 * Submit a report for a piece of user-generated content.
 *
 * Returns { alreadyReported: true } when the reporter has already
 * filed a report for this exact content_id — no duplicate insert.
 *
 * Throws on unexpected database errors so callers can surface them.
 */
export async function submitReport({ contentType, contentId, reason, details }) {
  const reporterId = await getCurrentUserId()
  if (!reporterId) throw new Error('Not authenticated')

  // Deduplicate: check if this reporter already has a report for
  // this exact content_id (regardless of content_type, which is
  // unique per content_id anyway).
  const { data: existing, error: checkErr } = await supabase
    .from('reports')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('content_id', contentId)
    .maybeSingle()

  if (checkErr) {
    console.error('[reports] duplicate check failed:', checkErr.message)
    throw checkErr
  }

  if (existing) {
    return { alreadyReported: true }
  }

  const { error: insertErr } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    content_type: contentType,
    content_id: contentId,
    reason,
    details: details?.trim() || null,
  })

  if (insertErr) {
    console.error('[reports] insert failed:', insertErr.message)
    throw insertErr
  }

  return { alreadyReported: false }
}

/**
 * Returns true if the current user has already reported content_id.
 * Fails soft (returns false) so the UI doesn't block on a network error.
 */
export async function hasReported(contentId) {
  const reporterId = await getCurrentUserId()
  if (!reporterId) return false

  const { data, error } = await supabase
    .from('reports')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('content_id', contentId)
    .maybeSingle()

  if (error) {
    console.error('[reports] hasReported check failed:', error.message)
    return false
  }

  return !!data
}

/**
 * Fetch the set of flagged content_ids for a given content_type that
 * have hit the auto-hide threshold. Returns a Set<string>.
 *
 * Called by read services to filter feed rows before returning them.
 * Fails soft — returns an empty Set on error so the feed still loads.
 */
export async function getFlaggedContentIds(contentType) {
  const { data, error } = await supabase
    .from('flagged_content_view')
    .select('content_id')
    .eq('content_type', contentType)
    .gte('pending_report_count', AUTO_HIDE_THRESHOLD)

  if (error) {
    console.error('[reports] getFlaggedContentIds failed:', error.message)
    return new Set()
  }

  return new Set((data || []).map((row) => row.content_id))
}
