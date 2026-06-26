-- =====================================================================
-- Sprint 9: Notifications — inbox + social events
-- =====================================================================
-- Creates:
--   1. notification_type enum
--   2. notifications table with RLS (own read/update)
--   3. Realtime publication entry
--   4. Four SECURITY DEFINER trigger functions for:
--      - follow: actor followed recipient
--      - reaction: actor reacted to recipient's review
--      - comment: actor commented on recipient's review
--      - friend_started: a followed user started a game in recipient's backlog
-- All triggers respect the blocked_users table (both directions).
-- =====================================================================


-- ----------------------------------------------------------------------
-- 1. Enum
-- ----------------------------------------------------------------------
CREATE TYPE public.notification_type AS ENUM (
  'follow',
  'reaction',
  'comment',
  'friend_started'
);


-- ----------------------------------------------------------------------
-- 2. Table + indexes + RLS
-- ----------------------------------------------------------------------
CREATE TABLE public.notifications (
  id                uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid                     NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_user_id     uuid                     NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type              public.notification_type NOT NULL,
  entity_id         text,
  read              boolean                  NOT NULL DEFAULT false,
  created_at        timestamptz              NOT NULL DEFAULT now(),
  CHECK (recipient_user_id != actor_user_id)
);

-- Primary read path: inbox newest-first, filtered by user.
CREATE INDEX notifications_recipient_created_idx
  ON public.notifications(recipient_user_id, created_at DESC);

-- Unread badge count path — partial index keeps it tiny.
CREATE INDEX notifications_unread_idx
  ON public.notifications(recipient_user_id, read)
  WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipient reads their own notifications.
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (recipient_user_id = auth.uid());

-- Recipient marks notifications as read (UPDATE SET read=true).
-- NOTE: Postgres RLS requires a SELECT policy before UPDATE can match rows;
-- both policies above satisfy that requirement.
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (recipient_user_id = auth.uid());


-- ----------------------------------------------------------------------
-- 3. Realtime publication
-- ----------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;


-- ----------------------------------------------------------------------
-- 4a. Trigger: follow → notify followee
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_notify_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Skip if either user has blocked the other.
  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = NEW.followee_id AND blocked_id = NEW.follower_id)
       OR (blocker_id = NEW.follower_id AND blocked_id = NEW.followee_id)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications(recipient_user_id, actor_user_id, type)
  VALUES (NEW.followee_id, NEW.follower_id, 'follow');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_follow
  AFTER INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notify_follow();


-- ----------------------------------------------------------------------
-- 4b. Trigger: reaction on a review → notify review owner
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_notify_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  -- Only fire for review-target reactions; other targets have no inbox item.
  IF NEW.target_type != 'review' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_owner_id
  FROM public.reviews
  WHERE id::text = NEW.target_id
  LIMIT 1;

  -- No review found, or actor is reacting to their own review — skip.
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = v_owner_id AND blocked_id = NEW.user_id)
       OR (blocker_id = NEW.user_id AND blocked_id = v_owner_id)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications(recipient_user_id, actor_user_id, type, entity_id)
  VALUES (v_owner_id, NEW.user_id, 'reaction', NEW.target_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_reaction
  AFTER INSERT ON public.reactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notify_reaction();


-- ----------------------------------------------------------------------
-- 4c. Trigger: comment on a review → notify review owner
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_notify_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT user_id INTO v_owner_id
  FROM public.reviews
  WHERE id = NEW.review_id
  LIMIT 1;

  -- No review found, or commenter is the review owner — skip.
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = v_owner_id AND blocked_id = NEW.user_id)
       OR (blocker_id = NEW.user_id AND blocked_id = v_owner_id)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications(recipient_user_id, actor_user_id, type, entity_id)
  VALUES (v_owner_id, NEW.user_id, 'comment', NEW.review_id::text);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_comment
  AFTER INSERT ON public.review_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notify_comment();


-- ----------------------------------------------------------------------
-- 4d. Trigger: friend starts a game that's in recipient's want-to-play
-- ----------------------------------------------------------------------
-- Fires on activity_events INSERT WHERE type='started'. Finds every user
-- who (a) follows the actor and (b) has the same game in their
-- game_trackers with status='want' — those users get a friend_started
-- notification. Blocked pairs are excluded.
CREATE OR REPLACE FUNCTION public.trg_fn_notify_friend_started()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec RECORD;
BEGIN
  IF NEW.type != 'started' THEN
    RETURN NEW;
  END IF;

  FOR v_rec IN
    SELECT DISTINCT gt.user_id AS recipient_id
    FROM public.game_trackers gt
    JOIN public.follows f
      ON f.follower_id = gt.user_id
     AND f.followee_id = NEW.actor_user_id
    WHERE gt.igdb_game_id::text = NEW.entity_id
      AND gt.status = 'want'
      AND gt.user_id != NEW.actor_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = gt.user_id AND b.blocked_id = NEW.actor_user_id)
           OR (b.blocker_id = NEW.actor_user_id AND b.blocked_id = gt.user_id)
      )
  LOOP
    INSERT INTO public.notifications(recipient_user_id, actor_user_id, type, entity_id)
    VALUES (v_rec.recipient_id, NEW.actor_user_id, 'friend_started', NEW.entity_id);
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_friend_started
  AFTER INSERT ON public.activity_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_notify_friend_started();
