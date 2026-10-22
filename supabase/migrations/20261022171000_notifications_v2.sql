-- Notifications v2: server-side rows for Q&A, mentions, review likes, list
-- comments and admin reports, plus per-user push preferences for N-2.
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   public.notifications, notification_type, trg_fn_notify_*   (20260626161400)
--   private.is_blocked_between, private.actor_visible_to        (20260801010205)
--   private.list_visible_to                                     (20260803000400)
--   users.deleted_at                                            (20260915161157)
--   public.reports                                              (20261015211100)
--   qa_questions / qa_answers / qa_stuck, public.app_flags      (20261015213000)
--   removed_at on reviews / review_comments / list_comments / lists,
--   app_flags 'admin' row                                       (20261022143000)
--
-- WHAT THIS FILE RELIES ON (checked in the repo on 2026-10-22)
--
--   * Every existing notification row is already written by a SECURITY
--     DEFINER trigger (follow, reaction, comment, friend_started). No client
--     code inserts into notifications, and the table has no INSERT policy, so
--     clients already cannot insert. Section 2 makes that a privilege fence as
--     well, and narrows UPDATE to the read flag.
--   * The table already has actor_user_id and entity_id. Only payload is new.
--   * 'reaction' fires on emoji reactions with target_type = 'review', which
--     no UI writes today. Review likes are public.review_likes and have never
--     notified anyone; review_like below covers them.
--   * Lists have no likes, only saves, and list_saves is owner-only by design
--     (20260803000000 section 3: who saved a list is private). list_like is
--     therefore NOT added. Lists notify on comments only.
--   * Admins are app_flags key = 'admin' -> allow_user_ids (enabled is
--     constrained to false).
--
-- RULES EVERY NEW TRIGGER FOLLOWS
--   * Never notify yourself; skip deleted recipients (private.notify).
--   * Blocks in either direction suppress the row.
--   * Social types (review_like, list_comment, mention on reviews / lists /
--     activity) also require private.actor_visible_to(actor, recipient), so a
--     followers-only or private actor does not surface to people outside
--     that audience. Q&A types check blocks only: the Q&A board is public
--     regardless of activity_privacy (20261015213000 section 6).
--   * admin_report ignores blocks on purpose: blocking an admin must not hide
--     reports from moderation. The row carries the report id, content type and
--     reason code only.
--   * Likes and best picks collapse: the same actor on the same thing within
--     24 hours does not add a row. "Stuck" notices collapse per question.
--   * A notification failure never blocks the write that caused it
--     (private.notify swallows its own errors with a WARNING).
--   * payload holds ids and short title snapshots (<= 80 chars) only. Never
--     review, comment, answer or report text.


-- ============================================================
-- 0. Enum values
-- ============================================================
-- Outside the transaction: a value added by ALTER TYPE cannot be used until
-- it commits. Nothing below uses them at create time (plpgsql resolves the
-- literals when the trigger first fires). IF NOT EXISTS makes re-runs safe.

alter type public.notification_type add value if not exists 'review_like';
alter type public.notification_type add value if not exists 'list_comment';
alter type public.notification_type add value if not exists 'mention';
alter type public.notification_type add value if not exists 'qa_answer';
alter type public.notification_type add value if not exists 'qa_best';
alter type public.notification_type add value if not exists 'qa_stuck_answered';
alter type public.notification_type add value if not exists 'admin_report';


begin;

-- ============================================================
-- 1. payload column
-- ============================================================

alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;

comment on column public.notifications.payload is
  'Ids and short title snapshots needed to render and route the row (e.g. review_id, question_id, answer_id, list_id, comment_id, game_title, list_title). Never message, review, comment or report text.';


-- ============================================================
-- 2. Privileges: rows are written by triggers only
-- ============================================================
-- No INSERT/DELETE policy exists, so RLS already rejects client writes. This
-- adds the privilege fence and limits UPDATE to the read flag, so a recipient
-- cannot rewrite type / actor / payload on their own rows.

revoke insert, update, delete, truncate, references, trigger
  on public.notifications from anon, authenticated;
grant update (read) on public.notifications to authenticated;


-- ============================================================
-- 3. Helpers
-- ============================================================

-- The single insert path. p_dedupe: skip when an equal row exists inside the
-- window. p_any_actor: compare on (recipient, type, entity) only, so
-- different actors collapse too.
create or replace function private.notify(
  p_recipient  uuid,
  p_actor      uuid,
  p_type       public.notification_type,
  p_entity_id  text,
  p_payload    jsonb    default '{}'::jsonb,
  p_dedupe     interval default null,
  p_any_actor  boolean  default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient is null or p_actor is null or p_recipient = p_actor then
    return;
  end if;

  begin
    if not exists (
      select 1 from public.users u
       where u.id = p_recipient and u.deleted_at is null
    ) then
      return;
    end if;

    if p_dedupe is not null then
      -- Serialises concurrent like/unlike/like so the check below is reliable.
      perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',
        'notif', p_recipient,
        case when p_any_actor then '*' else p_actor::text end,
        p_type, p_entity_id), 0));

      if exists (
        select 1 from public.notifications n
         where n.recipient_user_id = p_recipient
           and n.type = p_type
           and n.entity_id is not distinct from p_entity_id
           and (p_any_actor or n.actor_user_id = p_actor)
           and n.created_at > now() - p_dedupe
      ) then
        return;
      end if;
    end if;

    insert into public.notifications
      (recipient_user_id, actor_user_id, type, entity_id, payload)
    values
      (p_recipient, p_actor, p_type, p_entity_id, coalesce(p_payload, '{}'::jsonb));
  exception when others then
    raise warning 'private.notify(%): % (%)', p_type, sqlerrm, sqlstate;
  end;
end;
$$;

create or replace function private.review_payload(p_review_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
             'review_id',    r.id,
             'igdb_game_id', r.igdb_game_id,
             'game_title',   left(r.game_title, 80),
             'game_image',   r.game_image))
      from public.reviews r
     where r.id = p_review_id
  ), jsonb_build_object('review_id', p_review_id));
$$;

create or replace function private.list_payload(p_list_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
             'list_id',         l.id,
             'list_title',      left(l.name, 80),
             'cover_image_url', l.cover_image_url))
      from public.lists l
     where l.id = p_list_id
  ), jsonb_build_object('list_id', p_list_id));
$$;

create or replace function private.qa_payload(p_question_id uuid, p_answer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
             'question_id',         q.id,
             'answer_id',           p_answer_id,
             'igdb_game_id',        q.igdb_game_id,
             'question_title',      left(q.title, 80),
             'game_title',          left(q.game_title, 80),
             'game_cover_image_id', q.game_cover_image_id))
      from public.qa_questions q
     where q.id = p_question_id
  ), jsonb_strip_nulls(jsonb_build_object('question_id', p_question_id, 'answer_id', p_answer_id)));
$$;

-- Real, live users named as @handle in p_text, excluding the author. Handles
-- are stored lowercase (users.username_format), so the match is exact on
-- lower(). The leading class stops "a@b.com" from matching. Capped at 10
-- distinct handles per row so one comment cannot fan out to everyone.
create or replace function private.mentioned_user_ids(p_text text, p_actor uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
    from (
      select distinct lower(m.arr[2]) as handle
        from regexp_matches(coalesce(p_text, ''),
                            '(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})', 'g') as m(arr)
       limit 10
    ) h
    join public.users u on u.username = h.handle
   where u.deleted_at is null
     and u.id is distinct from p_actor;
$$;


-- ============================================================
-- 4. Q&A
-- ============================================================

-- Answer -> the asker (qa_answer) and everyone stuck on the question except
-- the answerer and the asker (qa_stuck_answered, one per question per 24h).
create or replace function private.notify_qa_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asker   uuid;
  v_removed timestamptz;
  v_payload jsonb;
  v_stuck   uuid;
begin
  if new.user_id is null or new.removed_at is not null then
    return new;
  end if;

  select q.user_id, q.removed_at into v_asker, v_removed
    from public.qa_questions q where q.id = new.question_id;
  if not found or v_removed is not null then
    return new;
  end if;

  v_payload := private.qa_payload(new.question_id, new.id);

  if v_asker is not null and not private.is_blocked_between(v_asker, new.user_id) then
    perform private.notify(v_asker, new.user_id, 'qa_answer', new.id::text, v_payload);
  end if;

  for v_stuck in
    select s.user_id
      from public.qa_stuck s
     where s.question_id = new.question_id
       and s.user_id <> new.user_id
       and s.user_id is distinct from v_asker
       and not private.is_blocked_between(s.user_id, new.user_id)
       and (v_asker is null or not private.is_blocked_between(s.user_id, v_asker))
  loop
    perform private.notify(v_stuck, new.user_id, 'qa_stuck_answered',
                           new.question_id::text, v_payload, interval '24 hours', true);
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_qa_answer on public.qa_answers;
create trigger notify_qa_answer
  after insert on public.qa_answers
  for each row execute function private.notify_qa_answer();

-- Best pick -> the answerer. Unpicking and re-picking the same answer inside
-- 24h does not notify twice.
create or replace function private.notify_qa_best()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_answerer uuid;
begin
  if new.best_answer_id is null
     or new.best_answer_id is not distinct from old.best_answer_id
     or new.user_id is null
     or new.removed_at is not null then
    return new;
  end if;

  select a.user_id into v_answerer
    from public.qa_answers a
   where a.id = new.best_answer_id and a.removed_at is null;

  if v_answerer is null or private.is_blocked_between(v_answerer, new.user_id) then
    return new;
  end if;

  perform private.notify(v_answerer, new.user_id, 'qa_best', new.best_answer_id::text,
                         private.qa_payload(new.id, new.best_answer_id), interval '24 hours');
  return new;
end;
$$;

drop trigger if exists notify_qa_best on public.qa_questions;
create trigger notify_qa_best
  after update of best_answer_id on public.qa_questions
  for each row execute function private.notify_qa_best();


-- ============================================================
-- 5. Review likes and list comments
-- ============================================================

create or replace function private.notify_review_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select r.user_id into v_owner
    from public.reviews r
   where r.id = new.review_id and r.removed_at is null;

  if v_owner is null or not private.actor_visible_to(new.user_id, v_owner) then
    return new;
  end if;

  perform private.notify(v_owner, new.user_id, 'review_like', new.review_id::text,
                         private.review_payload(new.review_id), interval '24 hours');
  return new;
end;
$$;

drop trigger if exists notify_review_like on public.review_likes;
create trigger notify_review_like
  after insert on public.review_likes
  for each row execute function private.notify_review_like();

create or replace function private.notify_list_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select l.user_id into v_owner
    from public.lists l
   where l.id = new.list_id and l.removed_at is null;

  if v_owner is null or not private.actor_visible_to(new.user_id, v_owner) then
    return new;
  end if;

  perform private.notify(v_owner, new.user_id, 'list_comment', new.list_id::text,
                         private.list_payload(new.list_id) || jsonb_build_object('comment_id', new.id));
  return new;
end;
$$;

drop trigger if exists notify_list_comment on public.list_comments;
create trigger notify_list_comment
  after insert on public.list_comments
  for each row execute function private.notify_list_comment();


-- ============================================================
-- 6. Mentions (review / activity comments, list comments, Q&A answers)
-- ============================================================
-- Inserts only; editing a mention into an existing comment does not notify.
-- The person already notified directly for the same row (review owner, list
-- owner, asker) is skipped so they do not get two rows for one comment.

create or replace function private.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := new.user_id;
  v_direct     uuid;          -- already notified for this row by another trigger
  v_review_id  uuid;
  v_event_id   uuid;
  v_event_by   uuid;
  v_list_id    uuid;
  v_asker      uuid;
  v_payload    jsonb;
  v_uid        uuid;
begin
  if v_actor is null or new.removed_at is not null
     or position('@' in coalesce(new.body, '')) = 0 then
    return new;
  end if;

  if tg_table_name = 'review_comments' then
    if new.review_id is not null then
      select r.id, r.user_id into v_review_id, v_direct
        from public.reviews r
       where r.id = new.review_id and r.removed_at is null;
      if v_review_id is null then return new; end if;
      v_payload := private.review_payload(v_review_id)
                   || jsonb_build_object('source', 'review_comment', 'comment_id', new.id);
    else
      select ae.id, ae.actor_user_id into v_event_id, v_event_by
        from public.activity_events ae
       where ae.id = new.activity_event_id;
      if v_event_id is null then return new; end if;
      v_payload := jsonb_build_object('source', 'activity_comment',
                                      'activity_event_id', v_event_id, 'comment_id', new.id);
    end if;

  elsif tg_table_name = 'list_comments' then
    select l.id, l.user_id into v_list_id, v_direct
      from public.lists l
     where l.id = new.list_id and l.removed_at is null;
    if v_list_id is null then return new; end if;
    v_payload := private.list_payload(v_list_id)
                 || jsonb_build_object('source', 'list_comment', 'comment_id', new.id);

  elsif tg_table_name = 'qa_answers' then
    select q.user_id into v_asker
      from public.qa_questions q
     where q.id = new.question_id and q.removed_at is null;
    if not found then return new; end if;
    v_direct  := v_asker;
    v_payload := private.qa_payload(new.question_id, new.id)
                 || jsonb_build_object('source', 'qa_answer');

  else
    return new;
  end if;

  for v_uid in select m.id from private.mentioned_user_ids(new.body, v_actor) as m(id) loop
    continue when v_uid is not distinct from v_direct;

    if tg_table_name = 'qa_answers' then
      continue when private.is_blocked_between(v_uid, v_actor);
      continue when v_asker is not null and private.is_blocked_between(v_uid, v_asker);
    else
      continue when not private.actor_visible_to(v_actor, v_uid);
      continue when v_review_id is not null
                and not private.actor_visible_to(v_direct, v_uid);
      continue when v_event_id is not null
                and not private.actor_visible_to(v_event_by, v_uid);
      continue when v_list_id is not null
                and not private.list_visible_to(v_list_id, v_uid);
    end if;

    perform private.notify(v_uid, v_actor, 'mention', new.id::text, v_payload);
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_mentions on public.review_comments;
create trigger notify_mentions
  after insert on public.review_comments
  for each row execute function private.notify_mentions();

drop trigger if exists notify_mentions on public.list_comments;
create trigger notify_mentions
  after insert on public.list_comments
  for each row execute function private.notify_mentions();

drop trigger if exists notify_mentions on public.qa_answers;
create trigger notify_mentions
  after insert on public.qa_answers
  for each row execute function private.notify_mentions();


-- ============================================================
-- 7. Reports -> every admin
-- ============================================================

create or replace function private.notify_admin_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
begin
  for v_admin in
    select distinct a.id
      from public.app_flags f
      cross join lateral unnest(f.allow_user_ids) as a(id)
     where f.key = 'admin'
  loop
    perform private.notify(v_admin, new.reporter_id, 'admin_report', new.id::text,
                           jsonb_build_object('report_id', new.id,
                                              'content_type', new.content_type,
                                              'reason', new.reason));
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_admin_report on public.reports;
create trigger notify_admin_report
  after insert on public.reports
  for each row execute function private.notify_admin_report();


-- ============================================================
-- 8. Existing triggers: same rules, now with a payload
-- ============================================================
-- follow and friend_started are unchanged. comment and reaction keep their
-- block rule and gain the review snapshot (for the cover in the inbox), the
-- shared self/deleted checks, and skip removed reviews. Activity comments
-- (review_id null) still notify nobody, as before.

create or replace function public.trg_fn_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if new.review_id is null then
    return new;
  end if;

  select r.user_id into v_owner
    from public.reviews r
   where r.id = new.review_id and r.removed_at is null;

  if v_owner is null or private.is_blocked_between(v_owner, new.user_id) then
    return new;
  end if;

  perform private.notify(v_owner, new.user_id, 'comment', new.review_id::text,
                         private.review_payload(new.review_id) || jsonb_build_object('comment_id', new.id));
  return new;
end;
$$;

create or replace function public.trg_fn_notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner     uuid;
  v_review_id uuid;
begin
  if new.target_type <> 'review' then
    return new;
  end if;

  select r.id, r.user_id into v_review_id, v_owner
    from public.reviews r
   where r.id::text = new.target_id and r.removed_at is null
   limit 1;

  if v_owner is null or private.is_blocked_between(v_owner, new.user_id) then
    return new;
  end if;

  perform private.notify(v_owner, new.user_id, 'reaction', new.target_id,
                         private.review_payload(v_review_id), interval '24 hours');
  return new;
end;
$$;


-- ============================================================
-- 9. Push preferences (read by N-2; in-app rows ignore them)
-- ============================================================
-- No row = everything on. Columns are push switches only: every in-app row
-- is still created regardless.

create table if not exists public.user_notification_prefs (
  user_id                uuid        primary key references public.users (id) on delete cascade,
  push_follows           boolean     not null default true,
  push_likes             boolean     not null default true,
  push_comments_mentions boolean     not null default true,
  push_qa                boolean     not null default true,
  push_friends_activity  boolean     not null default true,
  push_admin             boolean     not null default true,
  updated_at             timestamptz not null default now()
);

comment on table public.user_notification_prefs is
  'Per-user PUSH switches. In-app notifications are always created; N-2 reads these (via private.push_enabled) before sending a push.';

alter table public.user_notification_prefs enable row level security;

revoke all on public.user_notification_prefs from anon, authenticated;
grant select on public.user_notification_prefs to authenticated;
grant insert (user_id, push_follows, push_likes, push_comments_mentions,
              push_qa, push_friends_activity, push_admin)
  on public.user_notification_prefs to authenticated;
grant update (push_follows, push_likes, push_comments_mentions,
              push_qa, push_friends_activity, push_admin)
  on public.user_notification_prefs to authenticated;

drop policy if exists notification_prefs_select_own on public.user_notification_prefs;
create policy notification_prefs_select_own on public.user_notification_prefs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notification_prefs_insert_own on public.user_notification_prefs;
create policy notification_prefs_insert_own on public.user_notification_prefs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notification_prefs_update_own on public.user_notification_prefs;
create policy notification_prefs_update_own on public.user_notification_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function private.notification_prefs_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_prefs_touch on public.user_notification_prefs;
create trigger notification_prefs_touch
  before insert or update on public.user_notification_prefs
  for each row execute function private.notification_prefs_touch();

-- One answer for N-2: may this user get a push for this type? admin_report
-- also requires the user to still be an admin.
create or replace function private.push_enabled(p_user uuid, p_type public.notification_type)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.user_notification_prefs%rowtype;
  t text := p_type::text;
begin
  select * into p from public.user_notification_prefs where user_id = p_user;

  return case
    when t = 'follow'
      then coalesce(p.push_follows, true)
    when t in ('reaction', 'review_like')
      then coalesce(p.push_likes, true)
    when t in ('comment', 'list_comment', 'mention')
      then coalesce(p.push_comments_mentions, true)
    when t in ('qa_answer', 'qa_best', 'qa_stuck_answered')
      then coalesce(p.push_qa, true)
    when t = 'friend_started'
      then coalesce(p.push_friends_activity, true)
    when t = 'admin_report'
      then coalesce(p.push_admin, true)
           and exists (select 1 from public.app_flags f
                        where f.key = 'admin' and p_user = any (f.allow_user_ids))
    else true
  end;
end;
$$;


-- ============================================================
-- 10. Function grants
-- ============================================================

revoke all on function private.notify(uuid, uuid, public.notification_type, text, jsonb, interval, boolean) from public, anon, authenticated;
revoke all on function private.review_payload(uuid)                 from public, anon, authenticated;
revoke all on function private.list_payload(uuid)                   from public, anon, authenticated;
revoke all on function private.qa_payload(uuid, uuid)               from public, anon, authenticated;
revoke all on function private.mentioned_user_ids(text, uuid)       from public, anon, authenticated;
revoke all on function private.notify_qa_answer()                   from public, anon, authenticated;
revoke all on function private.notify_qa_best()                     from public, anon, authenticated;
revoke all on function private.notify_review_like()                 from public, anon, authenticated;
revoke all on function private.notify_list_comment()                from public, anon, authenticated;
revoke all on function private.notify_mentions()                    from public, anon, authenticated;
revoke all on function private.notify_admin_report()                from public, anon, authenticated;
revoke all on function private.notification_prefs_touch()           from public, anon, authenticated;
revoke all on function private.push_enabled(uuid, public.notification_type) from public, anon, authenticated;
revoke execute on function public.trg_fn_notify_comment()  from public, anon, authenticated;
revoke execute on function public.trg_fn_notify_reaction() from public, anon, authenticated;
grant execute on function private.push_enabled(uuid, public.notification_type) to service_role;


notify pgrst, 'reload schema';

commit;


-- ============================================================
-- VERIFY (read-only; run after the block above)
-- ============================================================

-- 1. Enum: the original four plus seven new values, and no list_like.
select e.enumlabel
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
 where t.typname = 'notification_type'
 order by e.enumsortorder;
-- expect: follow, reaction, comment, friend_started, review_like, list_comment,
-- mention, qa_answer, qa_best, qa_stuck_answered, admin_report

-- 2. payload column.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'notifications'
 order by ordinal_position;
-- expect payload | jsonb | NO | '{}'::jsonb (actor_user_id and entity_id already present)

-- 3. Notification triggers in place.
select c.relname as table_name, t.tgname, p.proname as function_name
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc  p on p.oid = t.tgfoid
 where not t.tgisinternal
   and (t.tgname like 'notify_%' or t.tgname like 'trg_notify_%')
 order by 1, 2;
-- expect: activity_events/trg_notify_friend_started, follows/trg_notify_follow,
-- list_comments/notify_list_comment + notify_mentions,
-- qa_answers/notify_mentions + notify_qa_answer, qa_questions/notify_qa_best,
-- reactions/trg_notify_reaction, reports/notify_admin_report,
-- review_comments/notify_mentions + trg_notify_comment, review_likes/notify_review_like

-- 4. Clients cannot write notifications; they can only flip read.
select grantee, privilege_type
  from information_schema.table_privileges
 where table_schema = 'public' and table_name = 'notifications'
   and grantee in ('anon', 'authenticated')
 order by 1, 2;
-- expect: authenticated SELECT only (no INSERT / UPDATE / DELETE at table level)
select grantee, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'notifications'
   and grantee = 'authenticated' and privilege_type = 'UPDATE';
-- expect exactly one row: read
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'notifications' order by 1;
-- expect notifications_select_own (SELECT), notifications_update_own (UPDATE); no INSERT

-- 5. Prefs table, own-row policies, push_enabled default.
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'user_notification_prefs' order by 1;
-- expect 3 rows: insert_own, select_own, update_own
select private.push_enabled('6c88ae0e-29c7-44bf-9d42-72a67962bd17', 'admin_report') as ry_admin_push,
       private.push_enabled(gen_random_uuid(), 'admin_report')                      as stranger_admin_push,
       private.push_enabled(gen_random_uuid(), 'qa_answer')                         as default_qa_push;
-- expect true / false / true

-- 6. Mention parser (no writes): real handles only, emails ignored.
select u.username
  from private.mentioned_user_ids(
         '@' || (select username from public.users where username is not null
                  and deleted_at is null order by created_at limit 1)
         || ' check this, mail me at x@example.com, @not_a_real_handle_zz',
         null) as m(id)
  join public.users u on u.id = m.id;
-- expect exactly one row: the oldest user's handle

-- 7. Private helpers are not callable by clients.
select routine_schema, routine_name, grantee
  from information_schema.routine_privileges
 where routine_schema = 'private'
   and routine_name in ('notify', 'review_payload', 'list_payload', 'qa_payload',
                        'mentioned_user_ids', 'notify_qa_answer', 'notify_qa_best',
                        'notify_review_like', 'notify_list_comment', 'notify_mentions',
                        'notify_admin_report', 'push_enabled')
   and grantee in ('anon', 'authenticated', 'PUBLIC');
-- expect 0 rows
