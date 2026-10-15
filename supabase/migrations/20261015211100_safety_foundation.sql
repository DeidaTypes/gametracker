-- Safety foundation: enforce users.message_privacy on DM insert, and
-- create the reports table (supabase/reports.sql was never applied).
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   private.is_blocked_between (20260801010205)
--   public.users.message_privacy (20260930104300)
--   public.follows (follower_id, followee_id)
--
-- 'follows' matches the settings copy "People I follow": the recipient
-- must follow the sender. It is not "people who follow me."


-- ============================================================
-- A. Who can message me
-- ============================================================

create or replace function private.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        not private.is_blocked_between(p_sender, p_recipient)
        and case u.message_privacy
          when 'everyone' then true
          when 'follows' then exists (
            select 1
            from public.follows f
            where f.follower_id = p_recipient
              and f.followee_id = p_sender
          )
          else false
        end
      from public.users u
      where u.id = p_recipient
    ),
    false
  );
$$;

comment on function private.can_message(uuid, uuid) is
  'True when p_sender may DM p_recipient. everyone: always (unless blocked). follows: recipient follows sender ("People I follow"). nobody: never. Always false when private.is_blocked_between is true, or the recipient row is missing.';

-- The insert policy below is evaluated as the calling role, so that role
-- needs EXECUTE. The function stays out of the Data API (private schema)
-- and returns only a boolean.
revoke all on function private.can_message(uuid, uuid) from public;
grant execute on function private.can_message(uuid, uuid) to anon, authenticated, service_role;

create or replace function public.can_message_user(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.can_message(auth.uid(), p_target);
$$;

comment on function public.can_message_user(uuid) is
  'Whether the signed-in user may message p_target. Wraps private.can_message.';

revoke all on function public.can_message_user(uuid) from public;
revoke all on function public.can_message_user(uuid) from anon;
grant execute on function public.can_message_user(uuid) to authenticated, service_role;

drop policy if exists dm_insert_self on public.direct_messages;
create policy dm_insert_self on public.direct_messages
  for insert
  with check (
    auth.uid() = sender_id
    and private.can_message(auth.uid(), recipient_id)
  );


-- ============================================================
-- B. Reports
-- ============================================================

create table if not exists public.reports (
  id              uuid        primary key default gen_random_uuid(),
  reporter_id     uuid        not null references public.users(id) on delete cascade,
  content_type    text        not null,
  content_id      uuid        not null,
  reason          text        not null,
  details         text,
  status          text        not null default 'pending',
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewer_notes  text,
  constraint reports_content_type_check check (
    content_type in (
      'review', 'comment', 'message', 'profile', 'list', 'question', 'answer'
    )
  ),
  constraint reports_reason_check check (
    reason in (
      'spam',
      'harassment',
      'hate_speech',
      'sexual_content',
      'violence',
      'self_harm',
      'misinformation',
      'unmarked_spoiler',
      'other'
    )
  ),
  constraint reports_status_check check (
    status in ('pending', 'reviewed', 'actioned', 'dismissed')
  ),
  constraint reports_one_per_reporter unique (reporter_id, content_type, content_id)
);

comment on table public.reports is
  'User reports of UGC. Reporters insert and read their own rows. Admin review uses the service role in the dashboard. One row per reporter per piece of content.';

-- Widen checks when an older reports.sql (without question/answer or
-- unmarked_spoiler) was applied. Fresh creates already have these.
alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type in (
    'review', 'comment', 'message', 'profile', 'list', 'question', 'answer'
  )
);

alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (
  reason in (
    'spam',
    'harassment',
    'hate_speech',
    'sexual_content',
    'violence',
    'self_harm',
    'misinformation',
    'unmarked_spoiler',
    'other'
  )
);

alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (
  status in ('pending', 'reviewed', 'actioned', 'dismissed')
);

alter table public.reports drop constraint if exists reports_one_per_reporter;
alter table public.reports
  add constraint reports_one_per_reporter unique (reporter_id, content_type, content_id);

create index if not exists reports_status_idx
  on public.reports (status, created_at desc);
create index if not exists reports_content_idx
  on public.reports (content_type, content_id);

alter table public.reports enable row level security;

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select
  to authenticated
  using (auth.uid() = reporter_id);

-- No SELECT for other reporters, and no UPDATE/DELETE policies.
-- Default privileges grant the new table to anon; take that back.
revoke all on table public.reports from anon, authenticated, public;
grant select, insert on table public.reports to authenticated;

-- Counts only. security_invoker = false so the aggregate sees every
-- pending report; a caller-invoker view would hide other reporters' rows
-- behind reports_select_own and the counts would be wrong. Reporter ids
-- are not in the select list.
drop view if exists public.flagged_content_view;
create view public.flagged_content_view
with (security_invoker = false) as
  select
    content_type,
    content_id,
    count(distinct reporter_id) as report_count,
    count(distinct reporter_id) filter (where reason = 'unmarked_spoiler')
      as spoiler_report_count
  from public.reports
  where status = 'pending'
  group by content_type, content_id;

comment on view public.flagged_content_view is
  'Pending-report counts per piece of content. report_count is distinct reporters (auto-hide threshold is 5). spoiler_report_count is the subset with reason unmarked_spoiler. No reporter ids.';

revoke all on table public.flagged_content_view from anon, authenticated, public;
grant select on table public.flagged_content_view to authenticated, service_role;


-- ============================================================
-- C. Verification (commented — select and run after the statements above)
-- ============================================================
--
-- -- Functions landed in the right schemas.
-- select n.nspname, p.proname
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where p.proname in ('can_message', 'can_message_user')
-- order by 1, 2;
-- -- expect: private.can_message, public.can_message_user
--
-- -- Insert policy calls can_message.
-- select polname, pg_get_expr(polwithcheck, polrelid) as with_check
-- from pg_policy
-- where polrelid = 'public.direct_messages'::regclass
--   and polname = 'dm_insert_self';
--
-- -- Reports checks include Q&A types, unmarked_spoiler, and one-per-reporter.
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.reports'::regclass
-- order by conname;
--
-- -- View exposes counts only.
-- select column_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'flagged_content_view'
-- order by ordinal_position;
-- -- expect: content_type, content_id, report_count, spoiler_report_count
--
-- -- RPC is not granted to anon.
-- select grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name = 'can_message_user';
--
-- -- Signed in as account A, after B sets Who can message me:
-- --   Nobody            -> false
-- --   Everyone          -> true (unless one of you blocked the other)
-- --   People I follow   -> true only when B follows A
-- --     (follows.follower_id = B and follows.followee_id = A)
-- -- select public.can_message_user('<B user uuid>');
