import React, { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import EmptyState from '../components/EmptyState'
import InlineErrorBanner from '../components/InlineErrorBanner'
import { useConfirmSheet } from '../components/ConfirmSheet'
import { showToast } from '../components/Toast'
import { isFlagEnabled } from '../services/flagService'
import { getOpenReports, resolveReport } from '../services/moderationService'
import { formatActivityDate } from '../utils/formatActivityDate'
import { hapticSuccess } from '../utils/haptics'
import './Settings.css'
import './Moderation.css'

const REASON_LABELS = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech',
  sexual_content: 'Sexual content',
  violence: 'Violence or threats',
  self_harm: 'Self-harm or suicide',
  misinformation: 'Misinformation',
  unmarked_spoiler: 'Unmarked spoiler',
  other: 'Something else',
}

const KIND_LABELS = {
  review: 'Review',
  review_comment: 'Comment',
  list_comment: 'List comment',
  message: 'Message',
  profile: 'Profile',
  list: 'List',
  question: 'Question',
  answer: 'Answer',
}

const DONE_TOASTS = {
  dismiss: 'Report dismissed',
  remove_content: 'Content removed',
  suspend_user: 'User suspended',
}

function kindLabel(report) {
  return KIND_LABELS[report.target?.kind] || KIND_LABELS[report.content_type] || 'Content'
}

function personLabel(person) {
  if (!person) return 'Deleted account'
  if (person.deleted) return '[deleted user]'
  if (person.username) return `@${person.username}`
  return person.display_name || 'Unknown user'
}

function targetKey(report) {
  return `${report.content_type}:${report.content_id}`
}

function ReportPreview({ report }) {
  const target = report.target || {}
  if (!target.exists) {
    return <p className="mod-preview__empty text-caption">This content no longer exists.</p>
  }
  const preview = target.preview || (target.has_attachment ? 'Shared an attachment.' : '')
  return (
    <div className="mod-preview">
      {target.title && <p className="mod-preview__title text-body">{target.title}</p>}
      {preview && <p className="mod-preview__text text-caption">{preview}</p>}
      {target.removed && <p className="mod-preview__flag text-label">Already removed</p>}
    </div>
  )
}

function ReportCard({ report, busy, onAction }) {
  const target = report.target || {}
  const author = target.author || null
  const kind = kindLabel(report)
  const reason = REASON_LABELS[report.reason] || report.reason
  const others = Math.max(0, (report.open_reports_on_target || 1) - 1)
  const title = [
    reason,
    kind,
    formatActivityDate(report.created_at),
    others > 0 ? `+${others} more` : null,
  ].filter(Boolean).join(' · ')

  const canRemove = target.exists && !target.removed
  const canSuspend = target.exists && !!author && !author.suspended && !author.deleted

  return (
    <SettingsGroup title={title}>
      <div className="settings-row mod-row--preview">
        <ReportPreview report={report} />
      </div>
      {report.details && (
        <div className="settings-row mod-row--preview">
          <p className="mod-preview__note text-caption">&ldquo;{report.details}&rdquo;</p>
        </div>
      )}
      <SettingsRow label="Reported by" value={personLabel(report.reporter)} />
      {target.exists && (
        <SettingsRow
          label="Posted by"
          value={author?.suspended ? `${personLabel(author)} · Suspended` : personLabel(author)}
        />
      )}
      <SettingsRow label="Dismiss" onClick={() => onAction(report, 'dismiss')} disabled={busy} />
      {canRemove && (
        <SettingsRow
          label={report.content_type === 'profile' ? 'Clear profile' : 'Remove content'}
          onClick={() => onAction(report, 'remove_content')}
          disabled={busy}
          destructive
        />
      )}
      {canSuspend && (
        <SettingsRow
          label="Suspend user"
          onClick={() => onAction(report, 'suspend_user')}
          disabled={busy}
          destructive
        />
      )}
    </SettingsGroup>
  )
}

function ReportSkeleton() {
  return (
    <div className="settings-group" aria-hidden="true">
      <span className="skeleton mod-sk-title" />
      <div className="settings-group__rows">
        <div className="settings-row mod-row--preview">
          <span className="skeleton mod-sk-line" />
        </div>
        <div className="settings-row">
          <span className="skeleton mod-sk-line mod-sk-line--short" />
        </div>
      </div>
    </div>
  )
}

function confirmFor(report, action) {
  const kind = kindLabel(report).toLowerCase()
  if (action === 'remove_content') {
    return report.content_type === 'profile'
      ? {
          title: 'Clear this profile?',
          message: 'Their bio, photos and favorite notes are removed.',
          confirmLabel: 'Clear',
          cancelLabel: 'Cancel',
          destructive: true,
        }
      : {
          title: `Remove this ${kind}?`,
          message: 'Only its author will still see it.',
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          destructive: true,
        }
  }
  return {
    title: `Suspend ${personLabel(report.target?.author)}?`,
    message: `The ${kind} is removed and they can't post.`,
    confirmLabel: 'Suspend',
    cancelLabel: 'Cancel',
    destructive: true,
  }
}

function Moderation() {
  const [access, setAccess] = useState('checking')
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [confirm, confirmSheet] = useConfirmSheet()

  useEffect(() => {
    let alive = true
    isFlagEnabled('admin').then((on) => {
      if (alive) setAccess(on ? 'admin' : 'denied')
    })
    return () => {
      alive = false
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoadError(false)
    try {
      setReports(await getOpenReports())
    } catch (err) {
      console.error('[moderation] load failed:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (access === 'admin') refresh()
  }, [access, refresh])

  const handleAction = async (report, action) => {
    if (busyKey) return
    if (action !== 'dismiss' && !(await confirm(confirmFor(report, action)))) return
    const key = targetKey(report)
    setBusyKey(key)
    try {
      await resolveReport(report.id, action)
      hapticSuccess()
      setReports((prev) => prev.filter((r) => targetKey(r) !== key))
      showToast(DONE_TOASTS[action], 'success', 1800)
    } catch (err) {
      console.error('[moderation] resolve failed:', err)
      if (/report_already_resolved/.test(err?.message || '')) {
        setReports((prev) => prev.filter((r) => targetKey(r) !== key))
        showToast('Already handled', 'success', 1800)
      } else {
        showToast("Couldn't update the report. Try again.", 'error')
      }
    } finally {
      setBusyKey(null)
    }
  }

  let body
  if (access === 'checking' || (access === 'admin' && loading)) {
    body = (
      <>
        <ReportSkeleton />
        <ReportSkeleton />
      </>
    )
  } else if (access === 'denied') {
    body = (
      <div className="mod-empty">
        <EmptyState icon={ShieldCheck} title="Moderation isn't available on this account." />
      </div>
    )
  } else if (loadError) {
    body = (
      <InlineErrorBanner
        message="Couldn't load reports."
        onRetry={() => { setLoading(true); refresh() }}
      />
    )
  } else if (reports.length === 0) {
    body = (
      <div className="mod-empty">
        <EmptyState
          icon={ShieldCheck}
          title="No open reports."
          body="New reports show up here, newest first."
        />
      </div>
    )
  } else {
    body = (
      <div className="mod-list content-fade-in">
        {reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            busy={busyKey === targetKey(report)}
            onAction={handleAction}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Moderation" />
      <div className="settings-page__body">{body}</div>
      {confirmSheet}
    </div>
  )
}

export default Moderation
