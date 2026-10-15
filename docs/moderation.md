# GameTracker — Content Moderation Guide

_Alpha moderation: manual daily queue review by the developer._

---

## Overview

Users can report reviews, comments, direct messages, profiles, lists, questions, and answers.  
Reports are stored in the `reports` table in Supabase with status `pending`, `reviewed`, `actioned`, or `dismissed`.

**Auto-hide threshold:** If a single piece of content receives **5 or more pending reports** from distinct reporters, it is automatically filtered out of all feeds. It remains in the database but is no longer served to other users until manually reviewed.

---

## Accessing the Reports Queue

### Supabase Dashboard (recommended for alpha)

1. Open the [Supabase Dashboard](https://app.supabase.com) and navigate to your project.
2. Go to **Table Editor** → `reports`, or use the **SQL Editor**.

### List all pending reports

```sql
SELECT
  r.id,
  r.content_type,
  r.content_id,
  r.reason,
  r.details,
  r.created_at,
  u.username AS reporter_username
FROM reports r
LEFT JOIN users u ON u.id = r.reporter_id
WHERE r.status = 'pending'
ORDER BY r.created_at;
```

### Find content with 5+ pending reports (auto-hidden items)

```sql
SELECT *
FROM flagged_content_view
WHERE report_count >= 5
ORDER BY report_count DESC;
```

### View a specific report's content

```sql
-- Replace 'review' and the UUID with the actual type and id
SELECT *
FROM reviews
WHERE id = '<content_id>';
```

---

## Actions You Can Take

For each report (or batch of reports about the same content), update the `status` field:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet reviewed — default on creation |
| `reviewed` | You looked at it, no immediate action needed |
| `actioned` | You deleted/hid the content or took another enforcement step |
| `dismissed` | No policy violation found; report rejected |

### Mark a report as reviewed

```sql
UPDATE reports
SET status = 'reviewed', reviewed_at = now(), reviewer_notes = 'Looked at, borderline but ok'
WHERE id = '<report_id>';
```

### Mark all reports for a content item as actioned

```sql
UPDATE reports
SET status = 'actioned', reviewed_at = now(), reviewer_notes = 'Content removed'
WHERE content_id = '<content_id>';
```

### Dismiss a report (no violation)

```sql
UPDATE reports
SET status = 'dismissed', reviewed_at = now(), reviewer_notes = 'No policy violation'
WHERE id = '<report_id>';
```

---

## Deleting Reported Content

Supabase RLS **does not** let the anon/service key delete another user's content via the standard client. Use the **service role** key (available in Settings → API) or the Supabase dashboard **Table Editor** to manually delete rows from:

- `reviews` — review content
- `comments` — comment content
- `direct_messages` — DM content
- `users` — profile (suspend via support workflow, not raw delete)
- `custom_lists` — list content

After deleting content, update the associated reports to `actioned`.

### Community Q&A (questions and answers)

Q&A content is **removed, not deleted**, so the rest of the thread keeps its place. Set `removed_at` (SQL Editor or service role; clients cannot write it):

```sql
UPDATE qa_questions SET removed_at = now(), removed_reason = 'spam' WHERE id = '<question_id>';
UPDATE qa_answers   SET removed_at = now(), removed_reason = 'spam' WHERE id = '<answer_id>';
-- undo: SET removed_at = NULL
```

Others stop seeing a removed question entirely and see a one-line "removed" stub for a removed answer; the author still sees their own. Then mark the reports `actioned`.

Q&A auto-hide uses lower thresholds than the 5-report rule above, counted from `pending` reports by distinct reporters:

- **2** `unmarked_spoiler` reports → the item is shown behind a spoiler blur.
- **3** reports of any kind → the item is hidden from everyone except its author until you review it.

Marking those reports `reviewed`, `dismissed` or `actioned` lifts the auto-hide. Full detail: `docs/qa_data_model.md`.

---

## Commitment

- Review pending reports **at least daily** during alpha.
- If a report queue grows beyond 50 pending items, prioritise by `created_at ASC` (oldest first) and by `content_type = 'profile'` (highest severity).

---

## Future Work (not in this sprint)

- In-app admin moderation UI
- Automated action on threshold violations beyond auto-hide
- Email notifications to reporters when their report is resolved
- Moderation audit log
