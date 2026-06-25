-- =====================================================================
-- Sprint 6 P2 — Direct messages
-- Sprint 6 P3 — Share-to-DM cards (attachment column)
--
-- Run this in the Supabase SQL editor BEFORE shipping the /messages
-- inbox + /messages/:username thread page. The messageService relies
-- on the table, indexes, and RLS policies below.
--
-- One row per message. The thread between two users is reconstructed
-- by querying for rows where (sender_id, recipient_id) matches either
-- direction of the pair — see the dm_thread_idx ordered tuple below
-- which uses LEAST/GREATEST so the index can serve both sides of any
-- conversation with a single ordered scan.
--
-- attachment JSONB shape (nullable — plain-text messages have NULL):
--   {
--     "type":      "game" | "review" | "list",
--     "id":        string,
--     "title":     string,
--     "cover_url": string | null,
--     "subtitle":  string | null,
--     "url_path":  string
--   }
-- =====================================================================

CREATE TABLE IF NOT EXISTS direct_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          text CHECK (length(body) BETWEEN 1 AND 4000),
  attachment    jsonb DEFAULT NULL,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id != recipient_id),
  CONSTRAINT dm_body_or_attachment CHECK (body IS NOT NULL OR attachment IS NOT NULL)
);

-- Sprint 6 P3 migration (run on existing databases that already have
-- the Sprint 6 P2 table with body NOT NULL and no attachment column):
--
--   ALTER TABLE direct_messages ALTER COLUMN body DROP NOT NULL;
--   ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment jsonb DEFAULT NULL;
--   ALTER TABLE direct_messages ADD CONSTRAINT dm_body_or_attachment
--     CHECK (body IS NOT NULL OR attachment IS NOT NULL);


-- Inbox-side query: "newest message addressed to me, grouped by partner."
CREATE INDEX IF NOT EXISTS dm_recipient_idx
  ON direct_messages(recipient_id, created_at DESC);

-- Thread query: "every message between user A and user B, oldest first."
-- LEAST/GREATEST normalises the ordered pair so a single index entry
-- covers both A→B and B→A, letting Postgres serve the thread page from
-- one ordered scan regardless of who started the conversation.
CREATE INDEX IF NOT EXISTS dm_thread_idx ON direct_messages (
  LEAST(sender_id, recipient_id),
  GREATEST(sender_id, recipient_id),
  created_at
);

ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- Only the sender or the recipient can read a message.
DROP POLICY IF EXISTS dm_select_participant ON direct_messages;
CREATE POLICY dm_select_participant ON direct_messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Only the authenticated user may insert, and only as the sender.
DROP POLICY IF EXISTS dm_insert_self ON direct_messages;
CREATE POLICY dm_insert_self ON direct_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Only the recipient can mark a message as read. The mark-as-read
-- update flips read_at from NULL to now() — the application layer is
-- responsible for restricting the update payload.
DROP POLICY IF EXISTS dm_update_recipient ON direct_messages;
CREATE POLICY dm_update_recipient ON direct_messages
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Add the table to the realtime publication so the inbox and thread
-- pages can subscribe to live INSERTs (and UPDATEs, for read receipts).
-- Wrapped in a DO block so re-runs don't error when the table is
-- already part of the publication.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
