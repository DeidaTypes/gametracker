-- =====================================================================
-- Pulse — activity_events foundation
-- Sprint: presence + activity foundation
-- =====================================================================
-- Run this once in the Supabase SQL editor. Idempotent: re-running is
-- safe (every CREATE / ALTER is guarded with IF NOT EXISTS or a
-- DO-block that checks information_schema first).
--
-- This migration owns four things:
--   1. `activity_privacy_level` enum + conversion of the existing
--      `users.activity_privacy` text+CHECK column to the new enum.
--   2. `users.presence_opt_in` boolean column (default false). Presence
--      is opt-in; the realtime presence channel only joins for users
--      who have explicitly enabled it.
--   3. `activity_event_type` enum and `activity_events` table that
--      every later Pulse-driven UI feature reads from. Columns and
--      types match the spec exactly:
--        (actor_user_id, type, entity_id, metadata jsonb, created_at)
--   4. RLS that honors the per-actor `activity_privacy` setting:
--        everyone  → any authenticated reader
--        followers → only readers in the `follows` graph
--        me        → only the actor themself
--      Writes are restricted to the actor (auth.uid()) only.
--
-- After the table exists we add it to the `supabase_realtime` publication
-- so the `useCircleActivity` hook can subscribe to postgres_changes
-- INSERTs (near-real-time fan-out without push/APNs in scope).
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. activity_privacy_level enum
-- ----------------------------------------------------------------------
-- The existing schema (see supabase/user_settings_columns.sql) defines
-- activity_privacy as `text CHECK (activity_privacy IN
-- ('everyone','followers','me'))`. Converting to a real enum gives us
-- stronger guarantees and lets RLS join against a stable type.
--
-- The DO-block:
--   a) creates the enum if missing,
--   b) drops the old CHECK constraint (variable name set by Postgres),
--   c) ALTER COLUMN TYPE … USING (cast) — preserves existing values,
--   d) ensures the column is NOT NULL with default 'everyone',
--   e) if the column never existed, adds it with the right type.

DO $$ BEGIN
  CREATE TYPE activity_privacy_level AS ENUM ('everyone', 'followers', 'me');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  has_col boolean;
  is_text boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'activity_privacy'
  ) INTO has_col;

  IF has_col THEN
    SELECT (data_type = 'text') INTO is_text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'activity_privacy';

    -- Drop legacy CHECK if it exists (name from user_settings_columns.sql).
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_activity_privacy_check;

    IF is_text THEN
      ALTER TABLE users
        ALTER COLUMN activity_privacy DROP DEFAULT;

      ALTER TABLE users
        ALTER COLUMN activity_privacy TYPE activity_privacy_level
        USING (
          CASE COALESCE(activity_privacy, 'everyone')
            WHEN 'everyone'  THEN 'everyone'::activity_privacy_level
            WHEN 'followers' THEN 'followers'::activity_privacy_level
            WHEN 'me'        THEN 'me'::activity_privacy_level
            ELSE 'everyone'::activity_privacy_level
          END
        );
    END IF;

    UPDATE users SET activity_privacy = 'everyone'::activity_privacy_level
      WHERE activity_privacy IS NULL;

    ALTER TABLE users
      ALTER COLUMN activity_privacy SET DEFAULT 'everyone'::activity_privacy_level;
    ALTER TABLE users
      ALTER COLUMN activity_privacy SET NOT NULL;
  ELSE
    ALTER TABLE users
      ADD COLUMN activity_privacy activity_privacy_level NOT NULL
      DEFAULT 'everyone'::activity_privacy_level;
  END IF;
END $$;


-- ----------------------------------------------------------------------
-- 2. presence_opt_in column on users
-- ----------------------------------------------------------------------
-- Presence is opt-in. The realtime presence channel joins only when this
-- flag is true. Default false so existing users stay invisible until
-- they explicitly turn the toggle on in Settings.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS presence_opt_in boolean NOT NULL DEFAULT false;


-- ----------------------------------------------------------------------
-- 3. activity_event_type enum + activity_events table
-- ----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE activity_event_type AS ENUM (
    'played',
    'rated',
    'reviewed',
    'favorited',
    'listed',
    'started',
    'completed',
    'dropped',
    'goal_hit'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS activity_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          activity_event_type NOT NULL,
  -- `entity_id` is intentionally `text` so a single column can carry
  -- either an IGDB game id (numeric string) or a UUID (list id, review
  -- id, goal milestone) without polymorphic FK gymnastics. The shape is
  -- always nullable because not every event refers to a single entity.
  entity_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Hot path: actor's own timeline + global recent feed.
CREATE INDEX IF NOT EXISTS activity_events_actor_created_idx
  ON activity_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_created_idx
  ON activity_events (created_at DESC);


-- ----------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------
-- Read policy honors the actor's `activity_privacy` setting:
--   everyone  → any authenticated user can read
--   followers → reader must follow the actor
--   me        → only the actor reads their own
-- Author can always read their own rows.
--
-- Insert / delete: actor only (auth.uid() = actor_user_id). No UPDATE
-- policy — events are append-only by design; correct mistakes by
-- inserting a corrective event rather than mutating history.

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_events_insert_self ON activity_events;
CREATE POLICY activity_events_insert_self ON activity_events
  FOR INSERT
  WITH CHECK (auth.uid() = actor_user_id);

DROP POLICY IF EXISTS activity_events_delete_self ON activity_events;
CREATE POLICY activity_events_delete_self ON activity_events
  FOR DELETE
  USING (auth.uid() = actor_user_id);

DROP POLICY IF EXISTS activity_events_select_visible ON activity_events;
CREATE POLICY activity_events_select_visible ON activity_events
  FOR SELECT
  USING (
    -- Author always sees their own rows.
    auth.uid() = actor_user_id
    OR EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = activity_events.actor_user_id
        AND (
          u.activity_privacy = 'everyone'::activity_privacy_level
          OR (
            u.activity_privacy = 'followers'::activity_privacy_level
            AND EXISTS (
              SELECT 1
              FROM follows f
              WHERE f.follower_id = auth.uid()
                AND f.followee_id = activity_events.actor_user_id
            )
          )
        )
    )
  );


-- ----------------------------------------------------------------------
-- 5. Realtime publication
-- ----------------------------------------------------------------------
-- Adding the table to `supabase_realtime` is what lets the client-side
-- `useCircleActivity` hook subscribe to INSERT events via
-- postgres_changes. The DO-block is required because ALTER PUBLICATION
-- … ADD TABLE doesn't support IF NOT EXISTS in current Postgres.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_events;
  END IF;
END $$;
