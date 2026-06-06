-- ============================================================
-- reports table — user-generated content moderation
-- Sprint 8: Content reporting system
-- Run in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type    text        NOT NULL CHECK (content_type IN (
                                'review', 'comment', 'message', 'profile', 'list'
                              )),
  content_id      uuid        NOT NULL,
  reason          text        NOT NULL CHECK (reason IN (
                                'spam',
                                'harassment',
                                'hate_speech',
                                'sexual_content',
                                'violence',
                                'self_harm',
                                'misinformation',
                                'other'
                              )),
  details         text,       -- optional free-text from reporter (max 280 chars enforced client-side)
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewer_notes  text
);

CREATE INDEX IF NOT EXISTS reports_status_idx   ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_content_idx  ON reports(content_type, content_id);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports(reporter_id, content_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Reporters can only insert rows where they are the reporter.
CREATE POLICY reports_insert_self ON reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Reporters can read only their own submitted reports.
CREATE POLICY reports_select_own ON reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- Admin reads happen via service role from the Supabase dashboard.

-- ============================================================
-- flagged_content_view
-- Counts pending reports per (content_type, content_id).
-- Used by read services to filter out content that has hit the
-- auto-hide threshold (5+ distinct reporters).
-- ============================================================

CREATE OR REPLACE VIEW flagged_content_view AS
  SELECT
    content_type,
    content_id,
    COUNT(DISTINCT reporter_id) AS pending_report_count
  FROM reports
  WHERE status = 'pending'
  GROUP BY content_type, content_id;
