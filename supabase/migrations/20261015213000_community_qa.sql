-- Community Q&A -- schema, RLS, helpers, read RPCs, feature flag.
--
-- MANUAL RUN in the Supabase SQL Editor. Not yet applied. Design:
-- docs/design/checkpoint_community_qa_v5.html. Data model for UI prompts:
-- docs/qa_data_model.md.
--
-- Idempotent: tables use IF NOT EXISTS, policies are dropped and recreated,
-- functions are CREATE OR REPLACE, the flag seed is ON CONFLICT DO NOTHING.
-- Safe to re-run; re-running does NOT alter a table that already exists.
--
-- Depends on (all verified against the live project):
--   public.users (id, created_at, deleted_at)       public.game_trackers
--   public.blocked_users                            private.is_blocked_between(uuid, uuid)
-- Optional, handled by section 11 (self-skipping):
--   public.reports, created by 20261015211100_safety_foundation.sql (QA-0).
--   Checked against the live project on 2026-10-15: reports and
--   flagged_content_view did NOT exist yet. Everything report-dependent sits
--   in section 11 plus the two stub helpers in section 4, so this file runs
--   cleanly either way. Without reports the board works with no auto-hide.
--   Once QA-0 is applied, re-run section 11 alone (or this whole file) to
--   switch auto-hide on. Recommended order: QA-0 first, then this file.
--
-- WHAT IS DEFINER AND WHY. Every read RPC and the row-shaping helper
-- (qa_item, qa_credibility) are SECURITY INVOKER so RLS applies to the
-- viewer. The DEFINER helpers are each tiny and exist for exactly one of:
--   * a count/aggregate over rows the viewer cannot read (votes, stuck, trackers)
--   * a check that would recurse through RLS (qa_question_has_answers)
--   * a column the viewer has no grant on (users.deleted_at)
--   * reading reports, which only the reporter can read
-- None of them returns a row a viewer could not already see, except the
-- removed-content stubs (id + created_at only), which the design needs.

begin;

-- ============================================================
-- 0. Preflight
-- ============================================================
do $$
begin
  if to_regclass('public.users') is null
     or to_regclass('public.game_trackers') is null
     or to_regclass('public.blocked_users') is null then
    raise exception 'community_qa: users, game_trackers and blocked_users must exist first';
  end if;
  if to_regprocedure('private.is_blocked_between(uuid,uuid)') is null then
    raise exception 'community_qa: private.is_blocked_between(uuid,uuid) is missing (see 20260801010205_rls_high_severity_fixes.sql)';
  end if;
end $$;

create schema if not exists private;


-- ============================================================
-- 1. Feature flag
-- ============================================================
-- Clients may read key/enabled but NOT allow_user_ids (that would publish the
-- allowlist), so the per-user answer comes from flag_enabled(), which is
-- DEFINER. Nobody writes from the client; flip it in the SQL Editor:
--   update public.app_flags set enabled = true where key = 'qa';
--   update public.app_flags set allow_user_ids = array['<uuid>']::uuid[] where key = 'qa';

create table if not exists public.app_flags (
  key            text primary key,
  enabled        boolean not null default false,
  allow_user_ids uuid[]  not null default '{}'
);

alter table public.app_flags enable row level security;

revoke all on public.app_flags from anon, authenticated;
grant select (key, enabled) on public.app_flags to authenticated;

drop policy if exists app_flags_select on public.app_flags;
create policy app_flags_select on public.app_flags
  for select to authenticated using (true);

insert into public.app_flags (key, enabled, allow_user_ids)
values ('qa', false, '{}')
on conflict (key) do nothing;

create or replace function public.flag_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select f.enabled or coalesce(auth.uid() = any (f.allow_user_ids), false)
       from public.app_flags f
      where f.key = p_key),
    false
  );
$$;


-- ============================================================
-- 2. Tables
-- ============================================================
-- Games have no FK: igdb_game_id + copied title/cover, same denormalization
-- as reviews and trackers. Author FKs are ON DELETE SET NULL on a nullable
-- column so an answer always outlives its author. (delete-account never
-- hard-deletes users -- it scrubs them -- so in practice user_id stays set and
-- the author renders as deleted via users.deleted_at. SET NULL is the backstop.)

create table if not exists public.qa_questions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid,
  igdb_game_id        bigint not null
                        constraint qa_questions_igdb_game_id_check check (igdb_game_id > 0),
  game_title          text   not null
                        constraint qa_questions_game_title_check check (char_length(game_title) between 1 and 200),
  game_cover_image_id text
                        constraint qa_questions_game_cover_check check (char_length(game_cover_image_id) <= 100),
  platform            text
                        constraint qa_questions_platform_check check (char_length(platform) <= 40),
  topic               text   not null
                        constraint qa_questions_topic_check check (topic in
                          ('boss','build','item','location','puzzle','quest','story','strategy','tech')),
  title               text   not null
                        constraint qa_questions_title_check check (char_length(title) between 10 and 120),
  body                text   not null default ''
                        constraint qa_questions_body_check check (char_length(body) <= 2000),
  location            text
                        constraint qa_questions_location_check check (char_length(location) <= 40),
  is_spoiler          boolean not null default false,
  best_answer_id      uuid,                       -- FK added below, after qa_answers exists
  best_picked_at      timestamptz,
  edited_at           timestamptz,
  removed_at          timestamptz,
  removed_reason      text,
  created_at          timestamptz not null default now(),
  search_tsv          tsvector generated always as (
                        setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english'::regconfig, coalesce(body,  '')), 'B')
                      ) stored,
  constraint qa_questions_user_id_fkey
    foreign key (user_id) references public.users (id) on delete set null
);

create table if not exists public.qa_answers (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null,
  user_id          uuid,
  body             text not null
                     constraint qa_answers_body_check check (char_length(body) between 1 and 3000),
  is_spoiler       boolean not null default false,
  reply_to_user_id uuid,
  edited_at        timestamptz,
  removed_at       timestamptz,
  removed_reason   text,
  created_at       timestamptz not null default now(),
  constraint qa_answers_question_id_fkey
    foreign key (question_id) references public.qa_questions (id) on delete cascade,
  constraint qa_answers_user_id_fkey
    foreign key (user_id) references public.users (id) on delete set null,
  constraint qa_answers_reply_to_user_id_fkey
    foreign key (reply_to_user_id) references public.users (id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'qa_questions_best_answer_id_fkey'
       and conrelid = 'public.qa_questions'::regclass
  ) then
    alter table public.qa_questions
      add constraint qa_questions_best_answer_id_fkey
      foreign key (best_answer_id) references public.qa_answers (id)
      on delete set null
      deferrable initially immediate;
  end if;
end $$;

-- PK (answer_id, user_id) is what makes a double vote impossible.
create table if not exists public.qa_helpful_votes (
  answer_id  uuid not null references public.qa_answers (id) on delete cascade,
  user_id    uuid not null references public.users (id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (answer_id, user_id)
);

create table if not exists public.qa_stuck (
  question_id uuid not null references public.qa_questions (id) on delete cascade,
  user_id     uuid not null references public.users (id)        on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id)
);

create table if not exists public.qa_inbox_seen (
  user_id uuid primary key references public.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

create index if not exists qa_questions_game_created_idx on public.qa_questions (igdb_game_id, created_at desc);
create index if not exists qa_questions_user_created_idx on public.qa_questions (user_id, created_at desc);
create index if not exists qa_questions_created_idx      on public.qa_questions (created_at desc);
create index if not exists qa_questions_search_idx       on public.qa_questions using gin (search_tsv);
-- Without this, every answer delete (ON DELETE SET NULL on best_answer_id) seq-scans questions.
create index if not exists qa_questions_best_answer_idx  on public.qa_questions (best_answer_id) where best_answer_id is not null;

create index if not exists qa_answers_question_created_idx on public.qa_answers (question_id, created_at);
create index if not exists qa_answers_user_created_idx     on public.qa_answers (user_id, created_at desc);

-- "last 7 days" popularity scan
create index if not exists qa_helpful_votes_created_idx on public.qa_helpful_votes (created_at);
create index if not exists qa_stuck_created_idx         on public.qa_stuck (created_at);


-- ============================================================
-- 3. Table privileges
-- ============================================================
-- This project's default privileges hand ALL on every new table to anon and
-- authenticated, so privileges are set explicitly. Column grants are the hard
-- fence for "removed_at / removed_reason are never writable by clients"; the
-- triggers in section 5 are the second fence.

revoke all on public.qa_questions, public.qa_answers, public.qa_helpful_votes,
              public.qa_stuck, public.qa_inbox_seen
  from anon, authenticated;

grant select on public.qa_questions, public.qa_answers, public.qa_helpful_votes,
                public.qa_stuck, public.qa_inbox_seen to authenticated;

grant insert (id, user_id, igdb_game_id, game_title, game_cover_image_id, platform,
              topic, title, body, location, is_spoiler)
  on public.qa_questions to authenticated;
grant update (title, body, location, topic, platform, is_spoiler, best_answer_id, best_picked_at)
  on public.qa_questions to authenticated;
grant delete on public.qa_questions to authenticated;

grant insert (id, question_id, user_id, body, is_spoiler, reply_to_user_id)
  on public.qa_answers to authenticated;
grant update (body, is_spoiler) on public.qa_answers to authenticated;
grant delete on public.qa_answers to authenticated;

grant insert (answer_id, user_id) on public.qa_helpful_votes to authenticated;
grant delete on public.qa_helpful_votes to authenticated;

grant insert (question_id, user_id) on public.qa_stuck to authenticated;
grant delete on public.qa_stuck to authenticated;

grant insert (user_id, seen_at) on public.qa_inbox_seen to authenticated;
grant update (seen_at)          on public.qa_inbox_seen to authenticated;

alter table public.qa_questions     enable row level security;
alter table public.qa_answers       enable row level security;
alter table public.qa_helpful_votes enable row level security;
alter table public.qa_stuck         enable row level security;
alter table public.qa_inbox_seen    enable row level security;


-- ============================================================
-- 4. Private helpers
-- ============================================================

create or replace function private.qa_trim(p text)
returns text
language sql
immutable
as $$ select regexp_replace(p, '^\s+|\s+$', '', 'g') $$;

-- ---- reports hooks (stubs; section 11 replaces the bodies) ----
-- DEFINER because reports is readable only by the reporter. Distinct pending
-- reporters, so one person reporting twice counts once.

create or replace function private.qa_reports_hidden(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select false $$;

create or replace function private.qa_reports_spoilered(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select false $$;

-- Hidden for THIS viewer: hidden by reports, unless the viewer wrote it.
create or replace function private.qa_report_hidden(p_type text, p_id uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_owner is distinct from auth.uid()
     and private.qa_reports_hidden(p_type, p_id)
$$;

-- ---- limits ----
-- Account under 7 days: 3 questions / 15 answers per rolling 24h; else 10 / 50.
-- VOLATILE + advisory lock on purpose: a STABLE version counts from the
-- statement snapshot, so one multi-row INSERT would sail past the cap, and two
-- concurrent requests would each see the same count. Volatile sees the rows the
-- same statement already inserted; the lock serialises a user's concurrent
-- inserts until commit. Returns false for any uid other than the caller.
-- Known gap: deleting a post frees a slot (deleted rows are not counted).
create or replace function private.qa_within_limit(p_uid uuid, p_kind text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_new boolean;
  v_cap int;
  v_n   int;
begin
  if p_uid is null or p_uid is distinct from auth.uid() then
    return false;
  end if;

  select coalesce(u.created_at, '-infinity'::timestamptz) > now() - interval '7 days'
    into v_new
    from public.users u
   where u.id = p_uid;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qa_limit:' || p_kind || ':' || p_uid::text, 0));

  if p_kind = 'question' then
    v_cap := case when v_new then 3 else 10 end;
    select count(*) into v_n from public.qa_questions
     where user_id = p_uid and created_at > now() - interval '24 hours';
  elsif p_kind = 'answer' then
    v_cap := case when v_new then 15 else 50 end;
    select count(*) into v_n from public.qa_answers
     where user_id = p_uid and created_at > now() - interval '24 hours';
  else
    return false;
  end if;

  return v_n < v_cap;
end;
$$;

-- ---- small DEFINER readers ----

-- Must bypass RLS: "no answers exist (any author)" includes answers the asker
-- cannot see (blocked, removed). Also avoids a policy-recursion error: the
-- qa_answers SELECT policy reads qa_questions, so a qa_questions DELETE policy
-- that read qa_answers directly would loop.
create or replace function private.qa_question_has_answers(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.qa_answers a where a.question_id = p_question_id) $$;

-- users.deleted_at has no client grant by design (see 20260915161157).
create or replace function private.qa_user_deleted(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select u.deleted_at is not null from public.users u where u.id = p_user_id), false)
$$;

-- Votes are readable only as your own rows (so voter identities do not leak),
-- therefore counts come from here.
create or replace function private.qa_helpful_count(p_answer_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select count(*)::int from public.qa_helpful_votes v where v.answer_id = p_answer_id $$;

create or replace function private.qa_stuck_count(p_question_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select count(*)::int from public.qa_stuck s where s.question_id = p_question_id $$;

-- Most helpful non-removed, non-report-hidden answer. Ties: oldest first.
create or replace function private.qa_top_answer(p_question_id uuid)
returns table (answer_id uuid, helpful_count int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, count(v.user_id)::int as n
    from public.qa_answers a
    left join public.qa_helpful_votes v on v.answer_id = a.id
   where a.question_id = p_question_id
     and a.removed_at is null
     and not private.qa_reports_hidden('answer', a.id)
   group by a.id, a.created_at
   order by n desc, a.created_at asc
   limit 1
$$;

-- THE status rule, written once.
--   'best'           the asker picked an answer (and it has not been removed)
--   'community_pick' question older than 7 days AND its top answer has >= 3
--                    helpful votes from users whose tracker for this game is
--                    'played'. DEFINER so those tracker rows are counted
--                    without being exposed to the caller.
--   'open'           everything else
-- Returns null when the question does not exist.
-- Deviation from the literal spec, on purpose: a best_answer_id pointing at an
-- answer a moderator removed does not count as answered.
create or replace function private.qa_status(p_question_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_best    uuid;
  v_created timestamptz;
  v_game    bigint;
  v_top_id  uuid;
  v_top_n   int;
  v_played  int;
begin
  select q.best_answer_id, q.created_at, q.igdb_game_id
    into v_best, v_created, v_game
    from public.qa_questions q
   where q.id = p_question_id;
  if not found then
    return null;
  end if;

  if v_best is not null and exists (
       select 1 from public.qa_answers a where a.id = v_best and a.removed_at is null) then
    return 'best';
  end if;

  if v_created < now() - interval '7 days' then
    select t.answer_id, t.helpful_count into v_top_id, v_top_n
      from private.qa_top_answer(p_question_id) t;

    if v_top_id is not null and v_top_n >= 3 then
      select count(distinct v.user_id) into v_played
        from public.qa_helpful_votes v
        join public.game_trackers g
          on g.user_id = v.user_id
         and g.igdb_game_id = v_game
         and g.status = 'played'
       where v.answer_id = v_top_id;

      if v_played >= 3 then
        return 'community_pick';
      end if;
    end if;
  end if;

  return 'open';
end;
$$;

-- The answer the list preview and "best answer" card are built from.
create or replace function private.qa_pick_answer_id(p_question_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case private.qa_status(p_question_id)
           when 'best' then (select q.best_answer_id from public.qa_questions q where q.id = p_question_id)
           when 'community_pick' then (select t.answer_id from private.qa_top_answer(p_question_id) t)
         end
$$;

-- true only when the question is removed AND the caller is not blocked with its
-- author. Lets qa_question say "removed" instead of "not found" (design C6b)
-- without confirming anything about a blocked user's content.
create or replace function private.qa_question_removed(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.qa_questions q
     where q.id = p_question_id
       and q.removed_at is not null
       and (q.user_id is null or not private.is_blocked_between(auth.uid(), q.user_id))
  )
$$;

-- Stubs for moderator-removed answers on a question the caller can see: id and
-- timestamp only, never the body or author.
create or replace function private.qa_removed_answers(p_question_id uuid)
returns table (id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.created_at
    from public.qa_answers a
    join public.qa_questions q on q.id = a.question_id
   where a.question_id = p_question_id
     and a.removed_at is not null
     and q.removed_at is null
     and (q.user_id is null or not private.is_blocked_between(auth.uid(), q.user_id))
     and (a.user_id is null or not private.is_blocked_between(auth.uid(), a.user_id))
$$;

-- helpful + stuck rows created since p_since, per question. Aggregate only.
create or replace function private.qa_recent_engagement(p_since timestamptz)
returns table (question_id uuid, score int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.question_id, sum(e.n)::int
    from (
      select a.question_id, count(*) as n
        from public.qa_helpful_votes v
        join public.qa_answers a on a.id = v.answer_id
       where v.created_at >= p_since
       group by a.question_id
      union all
      select s.question_id, count(*)
        from public.qa_stuck s
       where s.created_at >= p_since
       group by s.question_id
    ) e
   group by e.question_id
$$;

-- !! SECURITY INVOKER, deliberately. The pill is read from game_trackers AS THE
-- VIEWER, so trackers_select_visible (actor_visible_to) decides. A private-
-- activity user's row is invisible to a non-follower, so no row -> null -> no
-- pill. Never make this DEFINER. 'dropped' and 'want_to_play' give no pill.
create or replace function private.qa_credibility(p_user_id uuid, p_igdb_game_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', t.status, 'hours', round(coalesce(t.hours_played, 0), 1))
    from public.game_trackers t
   where t.user_id = p_user_id
     and t.igdb_game_id = p_igdb_game_id
     and t.status in ('played', 'playing')
   order by (t.status = 'played') desc, t.updated_at desc nulls last
   limit 1
$$;

-- The one list-row shape every list screen uses. SECURITY INVOKER: RLS decides
-- whether the viewer sees the question and which answers count. Returns NULL
-- for a question the viewer should not see (missing, removed, blocked, hidden).
create or replace function private.qa_item(p_id uuid, p_with_asker boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id',                  q.id,
           'title',               q.title,
           'igdb_game_id',        q.igdb_game_id,
           'game_title',          q.game_title,
           'game_cover_image_id', q.game_cover_image_id,
           'platform',            q.platform,
           'topic',               q.topic,
           'is_spoiler',          qs.v,
           'created_at',          q.created_at,
           'status',              st.s,
           'answer_count',        ac.n,
           'helpful_on_best',     case when pa.id is null then null
                                       else private.qa_helpful_count(pa.id) end,
           'best_preview',        case when pa.id is null or qs.v
                                         or pa.is_spoiler
                                         or private.qa_reports_spoilered('answer', pa.id)
                                       then null
                                       else left(regexp_replace(pa.body, '\s+', ' ', 'g'), 80) end,
           'unanswered_label',    case when st.s = 'open'
                                       then case when ac.n = 0 then 'no_answers' else 'waiting' end
                                  end
         )
         || case when p_with_asker
                 then jsonb_build_object('asker_username', au.username)
                 else '{}'::jsonb end
    from public.qa_questions q
   cross join lateral (select q.is_spoiler or private.qa_reports_spoilered('question', q.id) as v) qs
   cross join lateral (select private.qa_status(q.id) as s) st
   cross join lateral (
           select count(*)::int as n
             from public.qa_answers a
            where a.question_id = q.id
              and a.removed_at is null
              and not private.qa_report_hidden('answer', a.id, a.user_id)
         ) ac
    left join public.qa_answers pa
           on pa.id = private.qa_pick_answer_id(q.id)
          and pa.removed_at is null
          and not private.qa_report_hidden('answer', pa.id, pa.user_id)
    left join public.users au
           on au.id = q.user_id
          and not private.qa_user_deleted(q.user_id)
   where q.id = p_id
     and q.removed_at is null
     and not private.qa_report_hidden('question', q.id, q.user_id)
$$;


-- ============================================================
-- 5. Triggers
-- ============================================================
-- Trigger functions are SECURITY INVOKER so current_user is the caller.
-- 'authenticated' / 'anon' = a client; anything else (postgres in the SQL
-- Editor, service_role via the RI cascade or an Edge Function) is trusted.

create or replace function private.qa_questions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client boolean := current_user in ('authenticated', 'anon');
begin
  new.title    := private.qa_trim(new.title);
  new.body     := coalesce(private.qa_trim(new.body), '');
  new.location := nullif(private.qa_trim(new.location), '');
  new.platform := nullif(private.qa_trim(new.platform), '');

  if tg_op = 'INSERT' then
    if v_client then
      new.best_answer_id := null;
      new.best_picked_at := null;
      new.edited_at      := null;
      new.removed_at     := null;
      new.removed_reason := null;
      new.created_at     := now();   -- created_at drives the 7-day community-pick rule
    end if;
    if new.topic = 'story' then
      new.is_spoiler := true;        -- the asker can turn it off later by editing
    end if;
    return new;
  end if;

  -- UPDATE
  if v_client and (
       new.id                  is distinct from old.id
    or new.user_id             is distinct from old.user_id
    or new.igdb_game_id        is distinct from old.igdb_game_id
    or new.game_title          is distinct from old.game_title
    or new.game_cover_image_id is distinct from old.game_cover_image_id
    or new.created_at          is distinct from old.created_at
    or new.edited_at           is distinct from old.edited_at
    or new.removed_at          is distinct from old.removed_at
    or new.removed_reason      is distinct from old.removed_reason
  ) then
    raise exception 'qa_questions: only title, body, location, topic, platform, is_spoiler and best_answer_id can be changed'
      using errcode = '42501';
  end if;

  -- Content edits show "Edited". Spoiler / best-answer toggles are controls,
  -- not content, so they do not.
  if (new.title, new.body, new.location, new.topic, new.platform)
     is distinct from (old.title, old.body, old.location, old.topic, old.platform) then
    new.edited_at := now();
  end if;

  if new.best_answer_id is distinct from old.best_answer_id then
    if new.best_answer_id is not null then
      if not exists (
           select 1 from public.qa_answers a
            where a.id = new.best_answer_id
              and a.question_id = new.id
              and a.removed_at is null) then
        raise exception 'best_answer_id must be an answer to this question'
          using errcode = '23514';
      end if;
      new.best_picked_at := now();
    else
      new.best_picked_at := null;   -- also the ON DELETE SET NULL path
    end if;
  elsif v_client then
    new.best_picked_at := old.best_picked_at;   -- not settable on its own
  end if;

  return new;
end;
$$;

drop trigger if exists qa_questions_guard on public.qa_questions;
create trigger qa_questions_guard
  before insert or update on public.qa_questions
  for each row execute function private.qa_questions_guard();

create or replace function private.qa_answers_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client boolean := current_user in ('authenticated', 'anon');
begin
  new.body := private.qa_trim(new.body);

  if tg_op = 'INSERT' then
    if v_client then
      new.edited_at      := null;
      new.removed_at     := null;
      new.removed_reason := null;
      new.created_at     := now();
    end if;
    -- A reply targets someone who answered this question. Without this a client
    -- could attach any user id and have "@name" rendered under their answer.
    if new.reply_to_user_id is not null and not exists (
         select 1 from public.qa_answers a
          where a.question_id = new.question_id
            and a.user_id = new.reply_to_user_id
            and a.removed_at is null) then
      raise exception 'reply_to_user_id must be the author of an answer on this question'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_client and (
       new.id               is distinct from old.id
    or new.question_id      is distinct from old.question_id
    or new.user_id          is distinct from old.user_id
    or new.reply_to_user_id is distinct from old.reply_to_user_id
    or new.created_at       is distinct from old.created_at
    or new.edited_at        is distinct from old.edited_at
    or new.removed_at       is distinct from old.removed_at
    or new.removed_reason   is distinct from old.removed_reason
  ) then
    raise exception 'qa_answers: only body and is_spoiler can be changed'
      using errcode = '42501';
  end if;

  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists qa_answers_guard on public.qa_answers;
create trigger qa_answers_guard
  before insert or update on public.qa_answers
  for each row execute function private.qa_answers_guard();

-- Race guard for "delete is rejected once it has answers". The RLS policy
-- checks that with the statement's snapshot, so an answer that commits a
-- moment after the DELETE started would be cascade-deleted. The FK check on
-- that answer's insert holds a KEY SHARE lock on the question; the FOR UPDATE
-- below waits for it, and the check after it runs on a fresh snapshot.
-- Clients only: the RI cascade, service role and the SQL Editor are unaffected.
-- (Not exercisable from a single session; reviewed, not load-tested.)
create or replace function private.qa_questions_delete_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    perform 1 from public.qa_questions q where q.id = old.id for update;
    -- the DEFINER helper, not a bare select: under RLS the caller cannot see
    -- answers from blocked or removed authors, and those count too.
    if private.qa_question_has_answers(old.id) then
      raise exception 'a question with answers cannot be deleted'
        using errcode = '23503';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists qa_questions_delete_guard on public.qa_questions;
create trigger qa_questions_delete_guard
  before delete on public.qa_questions
  for each row execute function private.qa_questions_delete_guard();


-- ============================================================
-- 6. RLS policies
-- ============================================================
-- Q&A is a public board: any signed-in user reads it, whatever the author's
-- activity_privacy. The only read exclusions are blocked pairs (both
-- directions) and moderator-removed rows. Authors always see their own rows.
-- Report auto-hide is NOT in RLS (it needs reports, which only the reporter can
-- read); it lives in the RPCs. Read through the RPCs, not the tables.

-- ---- qa_questions ----
drop policy if exists qa_questions_select on public.qa_questions;
create policy qa_questions_select on public.qa_questions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      removed_at is null
      and (user_id is null or not private.is_blocked_between(auth.uid(), user_id))
    )
  );

drop policy if exists qa_questions_insert on public.qa_questions;
create policy qa_questions_insert on public.qa_questions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.flag_enabled('qa')
    and private.qa_within_limit(auth.uid(), 'question')
  );

-- removed_at is null: a removed question is frozen for its author.
drop policy if exists qa_questions_update on public.qa_questions;
create policy qa_questions_update on public.qa_questions
  for update to authenticated
  using (user_id = auth.uid() and removed_at is null)
  with check (user_id = auth.uid());

drop policy if exists qa_questions_delete on public.qa_questions;
create policy qa_questions_delete on public.qa_questions
  for delete to authenticated
  using (
    user_id = auth.uid()
    and removed_at is null
    and not private.qa_question_has_answers(id)
  );

-- ---- qa_answers ----
drop policy if exists qa_answers_select on public.qa_answers;
create policy qa_answers_select on public.qa_answers
  for select to authenticated
  using (
    (
      user_id = auth.uid()
      or (
        removed_at is null
        and (user_id is null or not private.is_blocked_between(auth.uid(), user_id))
      )
    )
    -- parent must be visible to the viewer (this applies qa_questions RLS)
    and exists (select 1 from public.qa_questions q where q.id = qa_answers.question_id)
  );

drop policy if exists qa_answers_insert on public.qa_answers;
create policy qa_answers_insert on public.qa_answers
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.flag_enabled('qa')
    and private.qa_within_limit(auth.uid(), 'answer')
    and exists (
      select 1 from public.qa_questions q
       where q.id = question_id
         and q.removed_at is null
         and (q.user_id is null or not private.is_blocked_between(auth.uid(), q.user_id))
    )
  );

-- removed_at is null: a removed answer cannot be edited or deleted away.
drop policy if exists qa_answers_update on public.qa_answers;
create policy qa_answers_update on public.qa_answers
  for update to authenticated
  using (user_id = auth.uid() and removed_at is null)
  with check (user_id = auth.uid());

drop policy if exists qa_answers_delete on public.qa_answers;
create policy qa_answers_delete on public.qa_answers
  for delete to authenticated
  using (user_id = auth.uid() and removed_at is null);

-- ---- qa_helpful_votes ----
-- DEVIATION from "SELECT: authenticated": own rows only. With a wide-open
-- SELECT anyone could list who voted on what, including private-activity
-- users. Nothing in the app needs that: counts come from
-- private.qa_helpful_count and the RPCs. To restore the spec's behaviour,
-- change the using() below to `true`.
drop policy if exists qa_helpful_votes_select on public.qa_helpful_votes;
create policy qa_helpful_votes_select on public.qa_helpful_votes
  for select to authenticated
  using (user_id = auth.uid());

-- The subquery runs under qa_answers RLS, so the answer must also be visible:
-- not removed, parent visible, author not blocked.
drop policy if exists qa_helpful_votes_insert on public.qa_helpful_votes;
create policy qa_helpful_votes_insert on public.qa_helpful_votes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.qa_answers a
       where a.id = answer_id
         and a.removed_at is null
         and a.user_id is distinct from auth.uid()
         and (a.user_id is null or not private.is_blocked_between(auth.uid(), a.user_id))
    )
  );

drop policy if exists qa_helpful_votes_delete on public.qa_helpful_votes;
create policy qa_helpful_votes_delete on public.qa_helpful_votes
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- qa_stuck ---- (same own-rows-only SELECT deviation as votes)
drop policy if exists qa_stuck_select on public.qa_stuck;
create policy qa_stuck_select on public.qa_stuck
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists qa_stuck_insert on public.qa_stuck;
create policy qa_stuck_insert on public.qa_stuck
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.qa_questions q
       where q.id = question_id
         and q.removed_at is null
         and q.user_id is distinct from auth.uid()
    )
  );

drop policy if exists qa_stuck_delete on public.qa_stuck;
create policy qa_stuck_delete on public.qa_stuck
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- qa_inbox_seen ----
drop policy if exists qa_inbox_seen_select on public.qa_inbox_seen;
create policy qa_inbox_seen_select on public.qa_inbox_seen
  for select to authenticated using (user_id = auth.uid());

drop policy if exists qa_inbox_seen_insert on public.qa_inbox_seen;
create policy qa_inbox_seen_insert on public.qa_inbox_seen
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists qa_inbox_seen_update on public.qa_inbox_seen;
create policy qa_inbox_seen_update on public.qa_inbox_seen
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ============================================================
-- 7. Read RPCs  (SECURITY INVOKER; each returns ONE jsonb)
-- ============================================================
-- Shared list-item shape (private.qa_item): id, title, igdb_game_id,
-- game_title, game_cover_image_id, platform, topic, is_spoiler, created_at,
-- status ('best'|'community_pick'|'open'), answer_count, helpful_on_best,
-- best_preview, unanswered_label ('no_answers'|'waiting'|null).

-- ---- 7.1 qa_home ----
create or replace function public.qa_home()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_most       jsonb;
  v_week       jsonb;
  v_help       jsonb;
  v_help_count int;
  v_new        jsonb;
  v_seen       timestamptz;
  v_inbox      boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Most asked: top 4 games by questions asked in the last 30 days. "Qualifies"
  -- = at least one visible question in the window; fewer than 4 games -> [].
  select coalesce(jsonb_agg(g.j order by g.rn), '[]'::jsonb)
    into v_most
    from (
      select row_number() over (order by count(*) desc, max(q.created_at) desc, q.igdb_game_id) as rn,
             jsonb_build_object(
               'igdb_game_id',        q.igdb_game_id,
               'game_title',          (array_agg(q.game_title order by q.created_at desc))[1],
               'game_cover_image_id', (array_agg(q.game_cover_image_id order by q.created_at desc)
                                         filter (where q.game_cover_image_id is not null))[1],
               'question_count',      count(*)::int
             ) as j
        from public.qa_questions q
       where q.removed_at is null
         and q.created_at >= now() - interval '30 days'
         and not private.qa_report_hidden('question', q.id, q.user_id)
       group by q.igdb_game_id
    ) g
   where g.rn <= 4;
  if jsonb_array_length(v_most) < 4 then
    v_most := '[]'::jsonb;
  end if;

  -- Popular this week: answered questions ranked by helpful votes + stuck taps
  -- in the last 7 days. Zero-score questions are NOT filtered out (so a quiet
  -- week still has a list, newest first); week_score is on each item so the UI
  -- can drop zeros if it prefers.
  select coalesce(jsonb_agg(r.j order by r.ord), '[]'::jsonb)
    into v_week
    from (
      select c.ord, private.qa_item(c.id) || jsonb_build_object('week_score', c.score) as j
        from (
          select q.id,
                 coalesce(e.score, 0) as score,
                 row_number() over (order by coalesce(e.score, 0) desc, q.created_at desc) as ord
            from public.qa_questions q
            left join private.qa_recent_engagement(now() - interval '7 days') e
                   on e.question_id = q.id
           where q.removed_at is null
             and not private.qa_report_hidden('question', q.id, q.user_id)
             and exists (select 1 from public.qa_answers a where a.question_id = q.id)
             and private.qa_status(q.id) <> 'open'
           order by ord
           limit 20
        ) c
    ) r
   where r.j is not null;

  -- You can help: open questions on games the viewer has marked Played.
  -- Excludes the viewer's own questions and ones they already answered.
  select coalesce(jsonb_agg(private.qa_item(c.id) order by c.created_at desc) filter (where c.rn <= 10),
                  '[]'::jsonb),
         coalesce(max(c.total), 0)::int
    into v_help, v_help_count
    from (
      select q.id, q.created_at,
             row_number() over (order by q.created_at desc) as rn,
             count(*) over () as total
        from public.qa_questions q
       where q.igdb_game_id in (
               select t.igdb_game_id from public.game_trackers t
                where t.user_id = v_uid and t.status = 'played')
         and q.removed_at is null
         and q.user_id is distinct from v_uid
         and not private.qa_report_hidden('question', q.id, q.user_id)
         and not exists (select 1 from public.qa_answers a
                          where a.question_id = q.id and a.user_id = v_uid)
         and private.qa_status(q.id) = 'open'
    ) c;

  -- Newest open questions. Not de-duplicated against can_help; the UI should
  -- drop ids it already shows under "You can help".
  select coalesce(jsonb_agg(private.qa_item(c.id) order by c.created_at desc), '[]'::jsonb)
    into v_new
    from (
      select q.id, q.created_at
        from public.qa_questions q
       where q.removed_at is null
         and not private.qa_report_hidden('question', q.id, q.user_id)
         and private.qa_status(q.id) = 'open'
       order by q.created_at desc
       limit 20
    ) c;

  -- Inbox dot: answers by others on my questions, after I last opened it.
  select s.seen_at into v_seen from public.qa_inbox_seen s where s.user_id = v_uid;
  select exists (
           select 1
             from public.qa_answers a
             join public.qa_questions q on q.id = a.question_id
            where q.user_id = v_uid
              and q.removed_at is null
              and a.user_id is distinct from v_uid
              and a.removed_at is null
              and not private.qa_report_hidden('answer', a.id, a.user_id)
              and (v_seen is null or a.created_at > v_seen)
         )
    into v_inbox;

  return jsonb_build_object(
    'most_asked',      v_most,
    'answered_week',   v_week,
    'can_help',        v_help,
    'can_help_count',  v_help_count,
    'newest_open',     v_new,
    'inbox_has_new',   v_inbox
  );
end;
$$;

-- ---- 7.2 qa_game ----
-- 'helpful' sort is a single page (p_before is ignored); 'newest' paginates:
-- pass the previous page's next_before as p_before. p_limit is clamped to 1-100.
create or replace function public.qa_game(
  p_igdb_game_id bigint,
  p_filter       text default 'answered',
  p_sort         text default 'helpful',
  p_limit        int  default 30,
  p_before       timestamptz default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_header jsonb;
  v_items  jsonb;
  v_more   boolean;
  v_next   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_filter not in ('answered', 'unanswered') then
    raise exception 'p_filter must be answered or unanswered' using errcode = '22023';
  end if;
  if p_sort not in ('helpful', 'newest') then
    raise exception 'p_sort must be helpful or newest' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'question_count',   count(*)::int,
           'answered_count',   (count(*) filter (where s.st <> 'open'))::int,
           'unanswered_count', (count(*) filter (where s.st = 'open'))::int,
           'answered_pct',     case when count(*) = 0 then null
                                    else round(100.0 * count(*) filter (where s.st <> 'open') / count(*))::int end
         )
    into v_header
    from (
      select private.qa_status(q.id) as st
        from public.qa_questions q
       where q.igdb_game_id = p_igdb_game_id
         and q.removed_at is null
         and not private.qa_report_hidden('question', q.id, q.user_id)
    ) s;

  with qs as (
    select q.id, q.created_at, private.qa_status(q.id) as st
      from public.qa_questions q
     where q.igdb_game_id = p_igdb_game_id
       and q.removed_at is null
       and not private.qa_report_hidden('question', q.id, q.user_id)
  ),
  filtered as (
    select qs.id, qs.created_at
      from qs
     where case when p_filter = 'answered' then qs.st <> 'open' else qs.st = 'open' end
       and (p_sort <> 'newest' or p_before is null or qs.created_at < p_before)
  ),
  ranked as (
    select f.id, f.created_at,
           row_number() over (
             order by
               case when p_sort = 'helpful' then
                 coalesce(private.qa_helpful_count(private.qa_pick_answer_id(f.id)),
                          (select t.helpful_count from private.qa_top_answer(f.id) t), 0)
               end desc nulls last,
               f.created_at desc, f.id
           ) as rn
      from filtered f
  )
  select coalesce(jsonb_agg(private.qa_item(r.id, true) order by r.rn) filter (where r.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         case when p_sort = 'newest' and count(*) > v_limit
              then (max(r.created_at) filter (where r.rn = v_limit)) end
    into v_items, v_more, v_next
    from ranked r;

  return jsonb_build_object(
    'header',      v_header,
    'items',       v_items,
    'has_more',    v_more and p_sort = 'newest',
    'next_before', v_next
  );
end;
$$;

-- ---- 7.3 qa_question ----
-- state: 'ok' | 'removed' | 'not_found'. 'not_found' covers deleted, never
-- existed, blocked, and report-hidden-from-you alike.
create or replace function public.qa_question(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_q       record;
  v_asker   record;
  v_deleted boolean;
  v_status  text;
  v_pick    uuid;
  v_answers jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if private.qa_question_removed(p_id) then
    return jsonb_build_object('state', 'removed');
  end if;

  select q.id, q.user_id, q.igdb_game_id, q.game_title, q.game_cover_image_id, q.platform,
         q.topic, q.title, q.body, q.location, q.best_answer_id, q.best_picked_at,
         q.edited_at, q.created_at,
         (q.is_spoiler or private.qa_reports_spoilered('question', q.id)) as is_spoiler
    into v_q
    from public.qa_questions q
   where q.id = p_id
     and q.removed_at is null
     and not private.qa_report_hidden('question', q.id, q.user_id);
  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  v_deleted := v_q.user_id is null or private.qa_user_deleted(v_q.user_id);
  if not v_deleted then
    select u.id, u.username, u.display_name, u.avatar_url
      into v_asker from public.users u where u.id = v_q.user_id;
  end if;

  v_status := private.qa_status(v_q.id);
  v_pick   := private.qa_pick_answer_id(v_q.id);

  select coalesce(jsonb_agg(x.j order by x.is_best desc, x.helpful desc, x.created_at asc, x.id), '[]'::jsonb)
    into v_answers
    from (
      select a.id, a.created_at,
             (a.id = v_q.best_answer_id) as is_best,
             hc.n as helpful,
             jsonb_build_object(
               'id',                a.id,
               'removed',           false,
               'body',              a.body,
               'is_spoiler',        (a.is_spoiler or private.qa_reports_spoilered('answer', a.id)),
               'created_at',        a.created_at,
               'edited_at',         a.edited_at,
               'is_best',           (a.id = v_q.best_answer_id),
               'is_community_pick', (v_status = 'community_pick' and a.id = v_pick),
               'is_own',            (a.user_id = v_uid),
               'author_deleted',    (a.user_id is null or private.qa_user_deleted(a.user_id)),
               'author',            case when a.user_id is null or private.qa_user_deleted(a.user_id) or au.id is null
                                         then null
                                         else jsonb_build_object('id', au.id, 'username', au.username,
                                                                 'display_name', au.display_name,
                                                                 'avatar_url', au.avatar_url) end,
               'credibility',       case when a.user_id is null or private.qa_user_deleted(a.user_id)
                                         then null
                                         else private.qa_credibility(a.user_id, v_q.igdb_game_id) end,
               'reply_to_user_id',  a.reply_to_user_id,
               'reply_to_username', case when a.reply_to_user_id is null or private.qa_user_deleted(a.reply_to_user_id)
                                         then null else ru.username end,
               'helpful_count',     hc.n,
               'viewer_helpful',    exists (select 1 from public.qa_helpful_votes v
                                             where v.answer_id = a.id and v.user_id = v_uid)
             ) as j
        from public.qa_answers a
        left join public.users au on au.id = a.user_id
        left join public.users ru on ru.id = a.reply_to_user_id
       cross join lateral (select private.qa_helpful_count(a.id) as n) hc
       where a.question_id = v_q.id
         and a.removed_at is null
         and not private.qa_report_hidden('answer', a.id, a.user_id)
      union all
      select r.id, r.created_at, false, 0,
             jsonb_build_object('id', r.id, 'removed', true, 'created_at', r.created_at)
        from private.qa_removed_answers(v_q.id) r
    ) x;

  return jsonb_build_object(
    'state', 'ok',
    'question', jsonb_build_object(
      'id',                  v_q.id,
      'title',               v_q.title,
      'body',                v_q.body,
      'location',            v_q.location,
      'topic',               v_q.topic,
      'platform',            v_q.platform,
      'igdb_game_id',        v_q.igdb_game_id,
      'game_title',          v_q.game_title,
      'game_cover_image_id', v_q.game_cover_image_id,
      'is_spoiler',          v_q.is_spoiler,
      'created_at',          v_q.created_at,
      'edited_at',           v_q.edited_at,
      'best_answer_id',      v_q.best_answer_id,
      'best_picked_at',      v_q.best_picked_at,
      'is_own',              (v_q.user_id = v_uid),
      'asker_deleted',       v_deleted,
      'asker',               case when v_deleted or v_asker.id is null then null
                                  else jsonb_build_object('id', v_asker.id, 'username', v_asker.username,
                                                          'display_name', v_asker.display_name,
                                                          'avatar_url', v_asker.avatar_url) end,
      'asker_credibility',   case when v_deleted then null
                                  else private.qa_credibility(v_q.user_id, v_q.igdb_game_id) end
    ),
    'status',         v_status,
    'pick_answer_id', v_pick,
    'stuck', jsonb_build_object(
      'count',        private.qa_stuck_count(v_q.id),
      'viewer_stuck', exists (select 1 from public.qa_stuck s
                               where s.question_id = v_q.id and s.user_id = v_uid)
    ),
    'answers',          v_answers,
    'viewer_is_asker',  (v_q.user_id = v_uid)
  );
end;
$$;

-- ---- 7.4 qa_search ----
-- websearch_to_tsquery over everything but the last word, which is matched as
-- a prefix ("nameless kin" finds "Nameless King"). Returns a bare jsonb array
-- of list items, best match first; group by game_title client-side.
create or replace function public.qa_search(
  p_query        text,
  p_igdb_game_id bigint default null,
  p_limit        int    default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_q     text := left(coalesce(btrim(p_query), ''), 200);
  v_limit int  := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_last  text;
  v_head  text;
  v_tsq   tsquery;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_q = '' then
    return '[]'::jsonb;
  end if;

  v_last := (regexp_match(v_q, '(\S+)$'))[1];
  if v_last ~ '^[[:alnum:]]+$' and lower(v_last) <> 'or' then
    v_head := btrim(left(v_q, length(v_q) - length(v_last)));
    v_tsq  := to_tsquery('english', v_last || ':*');
    if v_head <> '' then
      v_tsq := websearch_to_tsquery('english', v_head) && v_tsq;
    end if;
  else
    v_tsq := websearch_to_tsquery('english', v_q);
  end if;

  if numnode(v_tsq) = 0 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(private.qa_item(r.id) order by r.ord), '[]'::jsonb)
    into v_items
    from (
      select q.id,
             row_number() over (order by ts_rank_cd(q.search_tsv, v_tsq) desc, q.created_at desc) as ord
        from public.qa_questions q
       where q.search_tsv @@ v_tsq
         and (p_igdb_game_id is null or q.igdb_game_id = p_igdb_game_id)
         and q.removed_at is null
         and not private.qa_report_hidden('question', q.id, q.user_id)
       order by ord
       limit v_limit
    ) r;

  return v_items;
end;
$$;

-- ---- 7.5 qa_similar ("Is this your question?") ----
-- >= 3 words else []. Matches are OR-ed (a draft rarely repeats every word of
-- the original) but need at least min(2, terms) shared word-stems. Same game
-- first, then most shared stems, then rank. Bare jsonb array, max 3.
create or replace function public.qa_similar(p_title text, p_igdb_game_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_title text := left(coalesce(btrim(p_title), ''), 200);
  v_terms text[];
  v_or    tsquery;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(array_length(regexp_split_to_array(v_title, '\s+'), 1), 0) < 3 then
    return '[]'::jsonb;
  end if;

  v_terms := tsvector_to_array(to_tsvector('english', v_title));
  if v_terms is null or cardinality(v_terms) = 0 then
    return '[]'::jsonb;
  end if;
  -- stems are already stemmed, so match them with the 'simple' config
  v_or := to_tsquery('simple', (select string_agg(quote_literal(t), ' | ') from unnest(v_terms) t));

  select coalesce(jsonb_agg(private.qa_item(r.id) order by r.ord), '[]'::jsonb)
    into v_items
    from (
      select q.id,
             row_number() over (
               order by (q.igdb_game_id is not distinct from p_igdb_game_id) desc,
                        m.shared desc,
                        ts_rank_cd(q.search_tsv, v_or) desc,
                        q.created_at desc
             ) as ord
        from public.qa_questions q
       cross join lateral (
               select count(*) as shared
                 from unnest(tsvector_to_array(q.search_tsv)) l
                where l = any (v_terms)
             ) m
       where q.search_tsv @@ v_or
         and m.shared >= least(2, cardinality(v_terms))
         and q.removed_at is null
         and not private.qa_report_hidden('question', q.id, q.user_id)
       order by ord
       limit 3
    ) r;

  return v_items;
end;
$$;

-- ---- 7.6 qa_mine / qa_mark_inbox_seen ----
-- qa_mine does NOT mark seen. Call qa_mark_inbox_seen() separately, after
-- qa_mine has returned. Each list is capped at 100, newest first. Removed
-- questions are left out.
create or replace function public.qa_mine()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_seen     timestamptz;
  v_asked    jsonb;
  v_answered jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select s.seen_at into v_seen from public.qa_inbox_seen s where s.user_id = v_uid;

  select coalesce(jsonb_agg(c.j order by c.created_at desc), '[]'::jsonb)
    into v_asked
    from (
      select q.created_at,
             private.qa_item(q.id) || jsonb_build_object('new_answer_count', n.c) as j
        from (
          select q0.id, q0.created_at
            from public.qa_questions q0
           where q0.user_id = v_uid and q0.removed_at is null
           order by q0.created_at desc
           limit 100
        ) q
        cross join lateral (
                select count(*)::int as c
                  from public.qa_answers a
                 where a.question_id = q.id
                   and a.user_id is distinct from v_uid
                   and a.removed_at is null
                   and not private.qa_report_hidden('answer', a.id, a.user_id)
                   and (v_seen is null or a.created_at > v_seen)
              ) n
    ) c
   where c.j is not null;

  select coalesce(jsonb_agg(c.j order by c.created_at desc), '[]'::jsonb)
    into v_answered
    from (
      select a.created_at,
             jsonb_build_object(
               'answer', jsonb_build_object(
                 'id',            a.id,
                 'body',          a.body,
                 'is_spoiler',    (a.is_spoiler or private.qa_reports_spoilered('answer', a.id)),
                 'created_at',    a.created_at,
                 'edited_at',     a.edited_at,
                 'helpful_count', private.qa_helpful_count(a.id),
                 'is_best',       (a.id = q.best_answer_id)
               ),
               'question', private.qa_item(q.id)
             ) as j
        from public.qa_answers a
        join public.qa_questions q on q.id = a.question_id and q.removed_at is null
       where a.user_id = v_uid
         and a.removed_at is null
       order by a.created_at desc
       limit 100
    ) c
   where c.j -> 'question' is not null and c.j -> 'question' <> 'null'::jsonb;

  return jsonb_build_object('asked', v_asked, 'answered', v_answered);
end;
$$;

create or replace function public.qa_mark_inbox_seen()
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seen timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.qa_inbox_seen (user_id, seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at
  returning seen_at into v_seen;
  return v_seen;
end;
$$;


-- ============================================================
-- 8. Function grants
-- ============================================================
-- This project's default privileges grant EXECUTE on new functions to anon and
-- PUBLIC, so revoke first. Public RPCs: authenticated only. private.qa_*
-- helpers: authenticated (RLS policies and invoker RPCs call them as the
-- caller) + service_role; the private schema is not exposed by PostgREST.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname like 'qa\_%')
        or (n.nspname = 'public'  and (p.proname like 'qa\_%' or p.proname = 'flag_enabled'))
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;


-- ============================================================
-- 9. Content types
-- ============================================================
-- reports.content_type / reports.reason are the only content-type enumerations
-- that need 'question' and 'answer' (and 'unmarked_spoiler'). QA-0
-- (20261015211100_safety_foundation.sql) creates them with those values, so
-- this file does not touch the reports constraints; section 11 only warns if an
-- older reports table is still in place. reaction_target_type is left alone
-- (Q&A uses helpful votes, not reactions) and so is notification_type (Phase 3).


-- ============================================================
-- 10. Reload PostgREST
-- ============================================================
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 11. REPORTS AUTO-HIDE  (self-skipping -- re-runnable on its own)
-- ============================================================
-- Needs public.reports from QA-0. If it is missing this prints a NOTICE and
-- does nothing; apply QA-0, then run THIS section alone (from the "do" below
-- to the VERIFY block). It replaces the two stub helpers from section 4:
--   >= 2 distinct pending 'unmarked_spoiler' reporters -> RPCs return is_spoiler = true
--   >= 3 distinct pending reporters of any kind        -> RPCs omit it for everyone but its author
-- Both count exactly what flagged_content_view.report_count and
-- .spoiler_report_count count (distinct reporters, status = 'pending'), read
-- from reports directly so they do not depend on the view's column names.
-- "Until reviewed" falls out of status = 'pending': mark the reports reviewed /
-- dismissed / actioned and the item reappears; to take it down for good, set
-- removed_at (see docs/qa_data_model.md). The existing 5-report auto-hide for
-- reviews/comments/lists is untouched.

do $qa_reports$
begin
  if to_regclass('public.reports') is null then
    raise notice 'community_qa section 11 skipped: public.reports does not exist. Apply 20261015211100_safety_foundation.sql, then re-run this section.';
    return;
  end if;

  if not exists (
       select 1 from pg_constraint
        where conrelid = 'public.reports'::regclass
          and pg_get_constraintdef(oid) like '%question%')
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.reports'::regclass
          and pg_get_constraintdef(oid) like '%unmarked_spoiler%') then
    raise warning 'community_qa: public.reports still has the old content_type / reason checks (no question, answer or unmarked_spoiler). Re-apply 20261015211100_safety_foundation.sql; until then Q&A reports will be rejected.';
  end if;

  execute $fn$
    create or replace function private.qa_reports_hidden(p_type text, p_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $body$
      select count(distinct r.reporter_id) >= 3
        from public.reports r
       where r.content_type = p_type
         and r.content_id = p_id
         and r.status = 'pending'
    $body$
  $fn$;

  execute $fn$
    create or replace function private.qa_reports_spoilered(p_type text, p_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $body$
      select count(distinct r.reporter_id) >= 2
        from public.reports r
       where r.content_type = p_type
         and r.content_id = p_id
         and r.status = 'pending'
         and r.reason = 'unmarked_spoiler'
    $body$
  $fn$;

  notify pgrst, 'reload schema';
end
$qa_reports$;


-- ============================================================
-- VERIFY  (all commented out; run ONE block at a time in the SQL Editor)
-- ============================================================
-- Each block is its own transaction and ends in ROLLBACK, so nothing is left
-- behind. A block that is meant to fail does so on its LAST statement.
--
-- Replace everywhere:  <A> and <B>  two real user ids (A should have a
-- played/playing tracker for <GAME>);  <GAME>  any igdb id.
-- Both users must be older than 7 days unless the block says otherwise.
--
-- "Act as user X" = switch role and set the JWT claim for this transaction:
--     set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":"<X>","role":"authenticated"}', true);
-- "reset role;" goes back to admin mid-block.
--
-- ---- 1. flag OFF blocks inserts --------------------------------------------
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title)
--     values ('<A>', <GAME>, 'Test Game', 'boss', 'How do I beat the first boss?');
--   -- EXPECT: ERROR  new row violates row-level security policy
-- rollback;
--
-- ---- 2. flag ON allows it; a 'story' question starts as a spoiler ----------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title)
--     values ('<A>', <GAME>, 'Test Game', 'story', 'Who is the final boss really?') returning is_spoiler;
--   -- EXPECT: 1 row, is_spoiler = true
-- rollback;
--
-- ---- 3. allowlist works while the flag is off ------------------------------
-- begin;
--   update app_flags set allow_user_ids = array['<A>']::uuid[] where key = 'qa';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   select public.flag_enabled('qa');
--   -- EXPECT: true.  Repeat acting as <B>: false.
-- rollback;
--
-- ---- 4. cannot post as someone else ----------------------------------------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title)
--     values ('<B>', <GAME>, 'Test Game', 'boss', 'Posting as somebody else');
--   -- EXPECT: ERROR  new row violates row-level security policy
-- rollback;
--
-- ---- 5. clients cannot write removed_at ------------------------------------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title, removed_at)
--     values ('<A>', <GAME>, 'Test Game', 'boss', 'Trying to set removed_at', now());
--   -- EXPECT: ERROR  permission denied for table qa_questions  (column grant)
-- rollback;
--
-- ---- 6. blocked pair, B's view (A blocks B) --------------------------------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   insert into blocked_users (blocker_id, blocked_id) values ('<A>', '<B>');
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title) values
--     ('00000000-0000-0000-0000-0000000000a1', '<A>', <GAME>, 'Test Game', 'boss', 'Question written by user A'),
--     ('00000000-0000-0000-0000-0000000000b1', '<B>', <GAME>, 'Test Game', 'boss', 'Question written by user B');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
--   select (select count(*) from qa_questions where id = '00000000-0000-0000-0000-0000000000a1') as sees_a_table,
--          (select qa_question('00000000-0000-0000-0000-0000000000a1') ->> 'state')              as sees_a_rpc,
--          (select jsonb_array_length(qa_search('Question written')))                           as search_hits;
--   -- EXPECT: sees_a_table 0, sees_a_rpc not_found, search_hits 1 (only B's own)
-- rollback;
--
-- ---- 7. blocked pair, A's view (other direction) ---------------------------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   insert into blocked_users (blocker_id, blocked_id) values ('<A>', '<B>');
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title) values
--     ('00000000-0000-0000-0000-0000000000b1', '<B>', <GAME>, 'Test Game', 'boss', 'Question written by user B');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   select (select count(*) from qa_questions where id = '00000000-0000-0000-0000-0000000000b1') as sees_b_table,
--          (select qa_question('00000000-0000-0000-0000-0000000000b1') ->> 'state')              as sees_b_rpc;
--   -- EXPECT: sees_b_table 0, sees_b_rpc not_found
-- rollback;
--
-- ---- 8. private-activity user: a non-follower sees NO hours ----------------
-- begin;
--   update users set activity_privacy = 'me' where id = '<A>';   -- rolled back below
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a2', '<A>', <GAME>, 'Test Game', 'boss', 'Private user asks a question');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);   -- B does not follow A
--   select qa_question('00000000-0000-0000-0000-0000000000a2') -> 'question' -> 'asker_credibility' as hours_seen_by_b;
--   -- EXPECT: null (the question itself is still readable; only the pill is gone)
-- rollback;
--
-- ---- 9. ...but the private user sees their own hours -----------------------
-- begin;
--   update users set activity_privacy = 'me' where id = '<A>';
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a2', '<A>', <GAME>, 'Test Game', 'boss', 'Private user asks a question');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   select qa_question('00000000-0000-0000-0000-0000000000a2') -> 'question' -> 'asker_credibility' as hours_seen_by_a;
--   -- EXPECT: {"hours": ..., "status": "played" or "playing"}
-- rollback;
--
-- ---- 10. double helpful vote is rejected -----------------------------------
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a3', '<A>', <GAME>, 'Test Game', 'boss', 'Question for the vote test');
--   insert into qa_answers (id, question_id, user_id, body)
--     values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3', '<A>', 'A answers own question');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);
--   insert into qa_helpful_votes (answer_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '<B>');
--   insert into qa_helpful_votes (answer_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '<B>');
--   -- EXPECT: the first succeeds, the second ERRORs  duplicate key value violates unique constraint "qa_helpful_votes_pkey"
-- rollback;
--
-- ---- 11. you cannot mark your own answer helpful ---------------------------
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a3', '<A>', <GAME>, 'Test Game', 'boss', 'Question for the vote test');
--   insert into qa_answers (id, question_id, user_id, body)
--     values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3', '<A>', 'A answers own question');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_helpful_votes (answer_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '<A>');
--   -- EXPECT: ERROR  new row violates row-level security policy
-- rollback;
--
-- ---- 12. deleting a question that has answers is rejected ------------------
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a4', '<A>', <GAME>, 'Test Game', 'boss', 'Question that will get an answer');
--   insert into qa_answers (question_id, user_id, body)
--     values ('00000000-0000-0000-0000-0000000000a4', '<B>', 'B answers');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   delete from qa_questions where id = '00000000-0000-0000-0000-0000000000a4' returning id;
--   -- EXPECT: 0 rows (nothing deleted). With the answer removed first, 1 row.
-- rollback;
--
-- ---- 13. limits: a new account (< 7 days) gets 3 questions a day -----------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   update users set created_at = now() - interval '1 day' where id = '<A>';   -- rolled back below
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title)
--     select '<A>', <GAME>, 'T', 'boss', 'New account question number ' || g from generate_series(1, 4) g;
--   -- EXPECT: ERROR  new row violates row-level security policy  (one statement, 4 rows: still capped at 3, nothing inserted)
-- rollback;
--
-- ---- 14. limits: an established account gets 10 ----------------------------
-- begin;
--   update app_flags set enabled = true where key = 'qa';
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   insert into qa_questions (user_id, igdb_game_id, game_title, topic, title)
--     select '<A>', <GAME>, 'T', 'boss', 'Established account question ' || g from generate_series(1, 11) g;
--   -- EXPECT: ERROR (11 > 10). Change 11 to 10 and it succeeds.
-- rollback;
--
-- ---- 15. best_answer_id must belong to THIS question -----------------------
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title) values
--     ('00000000-0000-0000-0000-0000000000a5', '<A>', <GAME>, 'T', 'boss', 'Question one for best-answer test'),
--     ('00000000-0000-0000-0000-0000000000a6', '<A>', <GAME>, 'T', 'boss', 'Question two for best-answer test');
--   insert into qa_answers (id, question_id, user_id, body) values
--     ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a5', '<B>', 'answer to question one'),
--     ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000a6', '<B>', 'answer to question two');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   update qa_questions set best_answer_id = '00000000-0000-0000-0000-0000000000c6'
--    where id = '00000000-0000-0000-0000-0000000000a5';
--   -- EXPECT: ERROR  best_answer_id must be an answer to this question
-- rollback;
--
-- ---- 16. picking a best answer sets best_picked_at; unpicking clears it ----
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a5', '<A>', <GAME>, 'T', 'boss', 'Question one for best-answer test');
--   insert into qa_answers (id, question_id, user_id, body)
--     values ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000a5', '<B>', 'answer to question one');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   update qa_questions set best_answer_id = '00000000-0000-0000-0000-0000000000c5'
--    where id = '00000000-0000-0000-0000-0000000000a5' returning best_picked_at is not null as picked, edited_at;
--   -- EXPECT: picked = true, edited_at = null.  Then set best_answer_id = null: best_picked_at = null.
-- rollback;
--
-- ---- 17. clients cannot move created_at (it drives the 7-day rule) ---------
-- begin;
--   insert into qa_questions (id, user_id, igdb_game_id, game_title, topic, title)
--     values ('00000000-0000-0000-0000-0000000000a7', '<A>', <GAME>, 'T', 'boss', 'Question for the created_at test');
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true);
--   update qa_questions set created_at = now() - interval '30 days' where id = '00000000-0000-0000-0000-0000000000a7';
--   -- EXPECT: ERROR  permission denied for table qa_questions
-- rollback;
--
-- ---- 18. community pick (status rule) --------------------------------------
-- Read-only spot check on real data. For any question id:
--   select private.qa_status('<question id>');   -- 'best' | 'community_pick' | 'open'
-- Expect 'open' under 7 days old; 'best' once best_answer_id is set;
-- 'community_pick' only when it is > 7 days old and its top answer has >= 3
-- helpful votes from users whose tracker for that game is 'played'.
--
-- ---- 19. report auto-hide (only after section 11 ran against QA-0 reports) -
-- With three users C, D, E:   insert into reports (reporter_id, content_type, content_id, reason)
--   values ('<C>','answer','<answer id>','unmarked_spoiler'), ('<D>','answer','<answer id>','unmarked_spoiler');
--   select qa_question('<question id>') -> 'answers';   -- that answer now has is_spoiler = true
-- A third report (any reason) from E: the answer disappears for everyone but its author.
-- Set those reports' status to 'dismissed' and it comes back.
