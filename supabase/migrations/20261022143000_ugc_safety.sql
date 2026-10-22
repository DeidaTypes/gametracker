-- UGC safety (App Store Guideline 1.2): terms consent, objectionable-text
-- filter, suspensions, and an admin moderation queue.
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   public.reports, public.flagged_content_view   (20261015211100)
--   public.app_flags, public.flag_enabled          (20261015213000)
--   qa_questions / qa_answers removed_at + guards  (20261015213000)
--   users.deleted_at                               (20260915161157)
--
-- Checked against the live project on 2026-10-22.
--
-- WHAT THIS FILE RELIES ON (live facts, not assumptions)
--
--   * anon/authenticated hold TABLE-level INSERT and UPDATE on public.users,
--     reviews, review_comments, list_comments, lists, journal_entries and
--     direct_messages. A new column on any of them is client-writable by
--     default, so suspended_at, terms_accepted_at and removed_at are fenced
--     by triggers (sections 4 and 6), not by grants.
--   * SELECT on public.users is column-level. The two new users columns get
--     no SELECT grant; the app reads its own values through my_account_status().
--   * Only qa_questions / qa_answers have a soft-remove (removed_at). Reviews,
--     comments, lists and DMs are removed today only by their owner deleting
--     the row, and reviews/lists cascade into other people's comments, likes
--     and saves on delete (see supabase/functions/delete-account/index.ts).
--     Section 6 adds the same removed_at soft-remove to those tables so a
--     moderator removal hides the content without cascading.
--   * Report auto-hide for reviews/comments/lists is client-side
--     (flagged_content_view, pending reports only). Resolving a report clears
--     "pending", so removal has to be enforced server-side, which removed_at is.


begin;

create schema if not exists private;


-- ============================================================
-- 1. Terms consent and suspension columns
-- ============================================================

alter table public.users
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists suspended_at      timestamptz;

comment on column public.users.terms_accepted_at is
  'When the user agreed to the Terms of Use and Privacy Policy. Set only by public.accept_terms(). No client SELECT grant; read via public.my_account_status().';
comment on column public.users.suspended_at is
  'Set by public.admin_resolve_report(..., ''suspend_user''). A suspended user cannot write user text (enforced by the ugc text triggers). No client SELECT grant.';


-- ============================================================
-- 2. Blocklist (private) and matcher
-- ============================================================
-- RY: REVIEW THIS LIST BEFORE LAUNCH. It is deliberately short and covers
-- slurs and severe abuse only. Terms are lowercase letters/digits separated by
-- single spaces. Matching is case-insensitive on whole words, with an optional
-- plural "s"/"es", and is also run on a copy with common digit/symbol swaps
-- undone (0->o 1->i 3->e 4->a 5->s 7->t @->a $->s).
--
-- Left out on purpose because of false positives in normal gaming talk:
-- "chink" (chink in the armor), "coon" (Maine Coon), "fag" (UK slang),
-- "retard" (common but not a slur-level term in every reading).
-- "kill yourself" is included; it can appear as hyperbole ("you'll want to
-- kill yourself on this boss"). Remove it if that turns out to be noisy.
--
-- Add a term:    insert into private.blocked_terms (term) values ('...');
-- Remove a term: delete from private.blocked_terms where term = '...';

create table if not exists private.blocked_terms (
  term       text primary key
               constraint blocked_terms_format check (term ~ '^[a-z0-9]+( [a-z0-9]+)*$'),
  added_at   timestamptz not null default now()
);

revoke all on table private.blocked_terms from public, anon, authenticated;

insert into private.blocked_terms (term) values
  ('nigger'),
  ('nigga'),
  ('sandnigger'),
  ('faggot'),
  ('kike'),
  ('spic'),
  ('wetback'),
  ('beaner'),
  ('gook'),
  ('raghead'),
  ('towelhead'),
  ('tranny'),
  ('kill yourself'),
  ('kys')
on conflict (term) do nothing;

create or replace function private.text_blocked(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text;
  v_norm    text;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;

  select '\m(?:' || string_agg(replace(t.term, ' ', '\s+'), '|') || ')(?:s|es)?\M'
    into v_pattern
    from private.blocked_terms t;

  if v_pattern is null then
    return false;
  end if;

  -- Drop zero-width and soft-hyphen characters used to split a word invisibly.
  v_norm := lower(regexp_replace(p_text, '[\u200B-\u200D\u2060\uFEFF\u00AD]', '', 'g'));

  return v_norm ~ v_pattern
      or translate(v_norm, '013457@$', 'oieastas') ~ v_pattern;
end;
$$;

comment on function private.text_blocked(text) is
  'True when p_text contains a private.blocked_terms entry as a whole word (case-insensitive, optional plural, common digit/symbol swaps undone).';

-- Usernames are [a-z0-9_]; "_" and digits are word characters, so a handle is
-- also checked with them turned into spaces.
create or replace function private.username_blocked(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_username, '') <> ''
     and (
       private.text_blocked(replace(p_username, '_', ' '))
       or private.text_blocked(regexp_replace(p_username, '[0-9_]+', ' ', 'g'))
     );
$$;

create or replace function private.is_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.suspended_at is not null from public.users u where u.id = p_user_id),
    false
  );
$$;

-- Trigger functions below run as the caller, so the caller needs EXECUTE.
-- These return a boolean only; the term list itself stays unreadable.
revoke all on function private.text_blocked(text)     from public;
revoke all on function private.username_blocked(text) from public;
revoke all on function private.is_suspended(uuid)     from public;
grant execute on function private.text_blocked(text)     to anon, authenticated, service_role;
grant execute on function private.username_blocked(text) to anon, authenticated, service_role;
grant execute on function private.is_suspended(uuid)     to anon, authenticated, service_role;

-- Pre-flight for screens that must not round-trip a failed write first
-- (sign-up: a blocked handle would otherwise fail inside the auth insert as a
-- generic "Database error saving new user"). The triggers stay the authority.
create or replace function public.text_allowed(p_text text, p_kind text default 'text')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not case
    when p_kind = 'username' then private.username_blocked(p_text)
    else private.text_blocked(p_text)
  end;
$$;

revoke all on function public.text_allowed(text, text) from public;
grant execute on function public.text_allowed(text, text) to anon, authenticated, service_role;


-- ============================================================
-- 3. Generic user-text guard (every UGC table except users)
-- ============================================================
-- TG_ARGV = the text columns to check. Only values that are new or changed and
-- non-blank are checked, so an unrelated update (read_at on a DM, a rating
-- change, a blank-body diary row from a session) is never rejected because of
-- older text, and a suspended user can still do non-text actions.
--
-- Errors the app recognizes:
--   message 'content_blocked'   (SQLSTATE 23514)  detail = table.column
--   message 'account_suspended' (SQLSTATE 42501)

create or replace function private.ugc_text_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new     jsonb  := to_jsonb(new);
  v_old     jsonb  := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col     text;
  v_val     text;
  v_changed text[] := '{}';
begin
  foreach v_col in array tg_argv loop
    v_val := v_new ->> v_col;
    if nullif(btrim(coalesce(v_val, '')), '') is not null
       and (v_old is null or v_val is distinct from (v_old ->> v_col)) then
      v_changed := v_changed || v_col;
    end if;
  end loop;

  if cardinality(v_changed) = 0 then
    return new;
  end if;

  if current_user in ('authenticated', 'anon') and private.is_suspended(auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'account_suspended',
      hint    = 'This account cannot post right now.';
  end if;

  foreach v_col in array v_changed loop
    if private.text_blocked(v_new ->> v_col) then
      raise exception using
        errcode = '23514',
        message = 'content_blocked',
        detail  = format('%s.%s', tg_table_name, v_col),
        hint    = 'Edit the text and try again.';
    end if;
  end loop;

  return new;
end;
$$;

-- Named ugc_* so it fires after the qa_*_guard triggers (BEFORE triggers run in
-- name order), which trim title/body first.
drop trigger if exists ugc_text_guard on public.reviews;
create trigger ugc_text_guard before insert or update on public.reviews
  for each row execute function private.ugc_text_guard('body');

drop trigger if exists ugc_text_guard on public.review_comments;
create trigger ugc_text_guard before insert or update on public.review_comments
  for each row execute function private.ugc_text_guard('body');

drop trigger if exists ugc_text_guard on public.list_comments;
create trigger ugc_text_guard before insert or update on public.list_comments
  for each row execute function private.ugc_text_guard('body');

-- Legacy review comments table: unused by the app, but its insert policy is
-- live, so it is closed too.
drop trigger if exists ugc_text_guard on public.comments;
create trigger ugc_text_guard before insert or update on public.comments
  for each row execute function private.ugc_text_guard('body');

drop trigger if exists ugc_text_guard on public.lists;
create trigger ugc_text_guard before insert or update on public.lists
  for each row execute function private.ugc_text_guard('name', 'description');

drop trigger if exists ugc_text_guard on public.journal_entries;
create trigger ugc_text_guard before insert or update on public.journal_entries
  for each row execute function private.ugc_text_guard('title', 'body');

-- Session notes are readable by followers (play_sessions_select_visible_to_followers).
drop trigger if exists ugc_text_guard on public.play_sessions;
create trigger ugc_text_guard before insert or update on public.play_sessions
  for each row execute function private.ugc_text_guard('note');

drop trigger if exists ugc_text_guard on public.direct_messages;
create trigger ugc_text_guard before insert or update on public.direct_messages
  for each row execute function private.ugc_text_guard('body');

drop trigger if exists ugc_text_guard on public.qa_questions;
create trigger ugc_text_guard before insert or update on public.qa_questions
  for each row execute function private.ugc_text_guard('title', 'body', 'location');

drop trigger if exists ugc_text_guard on public.qa_answers;
create trigger ugc_text_guard before insert or update on public.qa_answers
  for each row execute function private.ugc_text_guard('body');


-- ============================================================
-- 4. users guard: profile text + suspended_at / terms_accepted_at fence
-- ============================================================
-- Checks display_name, username, bio, and the free-text "why" note on each
-- favorite_games card. Fires for every role, including the sign-up trigger
-- (handle_new_user) -- a blocked handle there rolls back the auth insert the
-- same way username_taken does.

create or replace function private.users_safety_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client   boolean := current_user in ('authenticated', 'anon');
  v_new_why  text;
  v_old_why  text;
  v_fields   text[]  := '{}';
  v_field    text;
begin
  if v_client then
    if tg_op = 'INSERT' then
      new.suspended_at      := null;
      new.terms_accepted_at := null;
    elsif new.suspended_at      is distinct from old.suspended_at
       or new.terms_accepted_at is distinct from old.terms_accepted_at then
      raise exception using
        errcode = '42501',
        message = 'users: suspended_at and terms_accepted_at are not client-writable';
    end if;
  end if;

  select string_agg(e ->> 'why', ' ')
    into v_new_why
    from jsonb_array_elements(
           case when jsonb_typeof(new.favorite_games) = 'array'
                then new.favorite_games else '[]'::jsonb end) e;

  if tg_op = 'UPDATE' then
    select string_agg(e ->> 'why', ' ')
      into v_old_why
      from jsonb_array_elements(
             case when jsonb_typeof(old.favorite_games) = 'array'
                  then old.favorite_games else '[]'::jsonb end) e;
  end if;

  if nullif(btrim(coalesce(new.display_name, '')), '') is not null
     and (tg_op = 'INSERT' or new.display_name is distinct from old.display_name) then
    v_fields := v_fields || 'display_name'::text;
  end if;
  if nullif(btrim(coalesce(new.username, '')), '') is not null
     and (tg_op = 'INSERT' or new.username is distinct from old.username) then
    v_fields := v_fields || 'username'::text;
  end if;
  if nullif(btrim(coalesce(new.bio, '')), '') is not null
     and (tg_op = 'INSERT' or new.bio is distinct from old.bio) then
    v_fields := v_fields || 'bio'::text;
  end if;
  if nullif(btrim(coalesce(v_new_why, '')), '') is not null
     and (tg_op = 'INSERT' or v_new_why is distinct from v_old_why) then
    v_fields := v_fields || 'favorite_games'::text;
  end if;

  if cardinality(v_fields) = 0 then
    return new;
  end if;

  if v_client and private.is_suspended(auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'account_suspended',
      hint    = 'This account cannot post right now.';
  end if;

  foreach v_field in array v_fields loop
    if (v_field = 'display_name'   and private.text_blocked(new.display_name))
    or (v_field = 'username'       and private.username_blocked(new.username))
    or (v_field = 'bio'            and private.text_blocked(new.bio))
    or (v_field = 'favorite_games' and private.text_blocked(v_new_why)) then
      raise exception using
        errcode = '23514',
        message = 'content_blocked',
        detail  = format('users.%s', v_field),
        hint    = 'Edit the text and try again.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists ugc_users_safety_guard on public.users;
create trigger ugc_users_safety_guard before insert or update on public.users
  for each row execute function private.users_safety_guard();


-- ============================================================
-- 5. Terms consent RPCs
-- ============================================================

create or replace function public.accept_terms()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_at  timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;

  update public.users
     set terms_accepted_at = coalesce(terms_accepted_at, now())
   where id = v_uid
  returning terms_accepted_at into v_at;

  if v_at is null then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  return v_at;
end;
$$;

comment on function public.accept_terms() is
  'Records that the caller agreed to the Terms of Use and Privacy Policy. Idempotent: keeps the first acceptance time.';

-- The caller's own consent + suspension state. Neither column is client-readable.
create or replace function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'terms_accepted_at', u.terms_accepted_at,
           'suspended',         u.suspended_at is not null
         )
    from public.users u
   where u.id = auth.uid();
$$;

revoke all on function public.accept_terms()      from public, anon;
revoke all on function public.my_account_status() from public, anon;
grant execute on function public.accept_terms()      to authenticated, service_role;
grant execute on function public.my_account_status() to authenticated, service_role;


-- ============================================================
-- 6. Soft-remove for reviews, comments, lists and DMs
-- ============================================================
-- Same contract as Q&A's removed_at: only moderators set it, the author still
-- sees their own row, everyone else does not, and a removed row is frozen
-- (no edits). The author may still delete it. Implemented as RESTRICTIVE
-- policies so the existing permissive policies are untouched.

alter table public.reviews         add column if not exists removed_at timestamptz;
alter table public.review_comments add column if not exists removed_at timestamptz;
alter table public.list_comments   add column if not exists removed_at timestamptz;
alter table public.lists           add column if not exists removed_at timestamptz;
alter table public.direct_messages add column if not exists removed_at timestamptz;

create or replace function private.ugc_removed_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.removed_at := null;
    elsif new.removed_at is distinct from old.removed_at then
      raise exception using
        errcode = '42501',
        message = format('%s: removed_at is set by moderators only', tg_table_name);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ugc_removed_guard on public.reviews;
create trigger ugc_removed_guard before insert or update on public.reviews
  for each row execute function private.ugc_removed_guard();
drop trigger if exists ugc_removed_guard on public.review_comments;
create trigger ugc_removed_guard before insert or update on public.review_comments
  for each row execute function private.ugc_removed_guard();
drop trigger if exists ugc_removed_guard on public.list_comments;
create trigger ugc_removed_guard before insert or update on public.list_comments
  for each row execute function private.ugc_removed_guard();
drop trigger if exists ugc_removed_guard on public.lists;
create trigger ugc_removed_guard before insert or update on public.lists
  for each row execute function private.ugc_removed_guard();
drop trigger if exists ugc_removed_guard on public.direct_messages;
create trigger ugc_removed_guard before insert or update on public.direct_messages
  for each row execute function private.ugc_removed_guard();

drop policy if exists reviews_hide_removed on public.reviews;
create policy reviews_hide_removed on public.reviews
  as restrictive for select
  using (removed_at is null or user_id = auth.uid());
drop policy if exists reviews_freeze_removed on public.reviews;
create policy reviews_freeze_removed on public.reviews
  as restrictive for update
  using (removed_at is null);

drop policy if exists review_comments_hide_removed on public.review_comments;
create policy review_comments_hide_removed on public.review_comments
  as restrictive for select
  using (removed_at is null or user_id = auth.uid());
drop policy if exists review_comments_freeze_removed on public.review_comments;
create policy review_comments_freeze_removed on public.review_comments
  as restrictive for update
  using (removed_at is null);

drop policy if exists list_comments_hide_removed on public.list_comments;
create policy list_comments_hide_removed on public.list_comments
  as restrictive for select
  using (removed_at is null or user_id = auth.uid());
drop policy if exists list_comments_freeze_removed on public.list_comments;
create policy list_comments_freeze_removed on public.list_comments
  as restrictive for update
  using (removed_at is null);

drop policy if exists lists_hide_removed on public.lists;
create policy lists_hide_removed on public.lists
  as restrictive for select
  using (removed_at is null or user_id = auth.uid());
drop policy if exists lists_freeze_removed on public.lists;
create policy lists_freeze_removed on public.lists
  as restrictive for update
  using (removed_at is null);

drop policy if exists dm_hide_removed on public.direct_messages;
create policy dm_hide_removed on public.direct_messages
  as restrictive for select
  using (removed_at is null or sender_id = auth.uid());
drop policy if exists dm_freeze_removed on public.direct_messages;
create policy dm_freeze_removed on public.direct_messages
  as restrictive for update
  using (removed_at is null);


-- ============================================================
-- 7. Admin flag
-- ============================================================
-- allow_user_ids only. The CHECK makes it impossible to flip 'admin' on for
-- everyone with enabled = true by mistake.

insert into public.app_flags (key, enabled, allow_user_ids)
values ('admin', false, array['6c88ae0e-29c7-44bf-9d42-72a67962bd17']::uuid[])
on conflict (key) do update
  set enabled        = false,
      allow_user_ids = excluded.allow_user_ids;

alter table public.app_flags drop constraint if exists app_flags_admin_never_global;
alter table public.app_flags
  add constraint app_flags_admin_never_global check (key <> 'admin' or enabled = false);


-- ============================================================
-- 8. Moderation audit log (private)
-- ============================================================

create table if not exists private.moderation_actions (
  id             uuid        primary key default gen_random_uuid(),
  admin_id       uuid        not null,
  report_id      uuid        not null,
  action         text        not null
                   constraint moderation_actions_action_check
                   check (action in ('dismiss', 'remove_content', 'suspend_user')),
  content_type   text        not null,
  content_id     uuid        not null,
  target_user_id uuid,
  snapshot       jsonb,
  created_at     timestamptz not null default now()
);

revoke all on table private.moderation_actions from public, anon, authenticated;

comment on table private.moderation_actions is
  'One row per admin_resolve_report call, with a snapshot of the reported content as it was before the action. Service role / SQL Editor only.';


-- ============================================================
-- 9. Admin helpers (private, called only from the admin RPCs)
-- ============================================================

create or replace function private.admin_user_card(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id',           u.id,
           'username',     u.username,
           'display_name', u.display_name,
           'avatar_url',   u.avatar_url,
           'suspended',    u.suspended_at is not null,
           'deleted',      u.deleted_at is not null
         )
    from public.users u
   where u.id = p_user_id;
$$;

-- What a report points at: kind, author, a title line, a 280-char preview,
-- and whether it is already removed. {exists:false} when the row is gone.
create or replace function private.admin_report_target(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  case p_type
    when 'review' then
      select jsonb_build_object(
               'kind', 'review', 'author_id', r.user_id, 'title', r.game_title,
               'preview', left(r.body, 280), 'rating', r.rating,
               'removed', r.removed_at is not null, 'created_at', r.created_at)
        into v from public.reviews r where r.id = p_id;

    when 'comment' then
      select jsonb_build_object(
               'kind', 'review_comment', 'author_id', c.user_id, 'title', null,
               'preview', left(c.body, 280),
               'removed', c.removed_at is not null, 'created_at', c.created_at)
        into v from public.review_comments c where c.id = p_id;
      if v is null then
        select jsonb_build_object(
                 'kind', 'list_comment', 'author_id', c.user_id, 'title', null,
                 'preview', left(c.body, 280),
                 'removed', c.removed_at is not null, 'created_at', c.created_at)
          into v from public.list_comments c where c.id = p_id;
      end if;

    when 'message' then
      select jsonb_build_object(
               'kind', 'message', 'author_id', m.sender_id, 'title', null,
               'preview', left(m.body, 280), 'has_attachment', m.attachment is not null,
               'removed', m.removed_at is not null, 'created_at', m.created_at)
        into v from public.direct_messages m where m.id = p_id;

    when 'profile' then
      select jsonb_build_object(
               'kind', 'profile', 'author_id', u.id, 'title', u.display_name,
               'preview', left(u.bio, 280),
               'removed', false, 'created_at', u.created_at)
        into v from public.users u where u.id = p_id;

    when 'list' then
      select jsonb_build_object(
               'kind', 'list', 'author_id', l.user_id, 'title', l.name,
               'preview', left(l.description, 280),
               'removed', l.removed_at is not null, 'created_at', l.created_at)
        into v from public.lists l where l.id = p_id;

    when 'question' then
      select jsonb_build_object(
               'kind', 'question', 'author_id', q.user_id, 'title', q.title,
               'preview', left(q.body, 280), 'game_title', q.game_title,
               'removed', q.removed_at is not null, 'created_at', q.created_at)
        into v from public.qa_questions q where q.id = p_id;

    when 'answer' then
      select jsonb_build_object(
               'kind', 'answer', 'author_id', a.user_id, 'title', q.title,
               'preview', left(a.body, 280), 'game_title', q.game_title,
               'removed', a.removed_at is not null, 'created_at', a.created_at)
        into v
        from public.qa_answers a
        join public.qa_questions q on q.id = a.question_id
       where a.id = p_id;

    else
      v := null;
  end case;

  if v is null then
    return jsonb_build_object('exists', false);
  end if;

  return v || jsonb_build_object(
    'exists', true,
    'author', private.admin_user_card((v ->> 'author_id')::uuid)
  );
end;
$$;

-- Soft-removes the target the way each surface already hides content:
-- removed_at on reviews / comments / lists / DMs / Q&A; for a profile, the
-- public-facing text and images are cleared (handle kept unless it is itself
-- blocked). Returns false when there was nothing to remove.
create or replace function private.admin_remove_content(p_type text, p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
begin
  case p_type
    when 'review' then
      update public.reviews set removed_at = now()
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;

    when 'comment' then
      update public.review_comments set removed_at = now()
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        update public.list_comments set removed_at = now()
         where id = p_id and removed_at is null;
        get diagnostics v_n = row_count;
      end if;

    when 'message' then
      update public.direct_messages set removed_at = now()
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;

    when 'list' then
      update public.lists set removed_at = now()
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;

    when 'question' then
      update public.qa_questions set removed_at = now(), removed_reason = 'moderator'
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;

    when 'answer' then
      update public.qa_answers set removed_at = now(), removed_reason = 'moderator'
       where id = p_id and removed_at is null;
      get diagnostics v_n = row_count;

    when 'profile' then
      update public.users u
         set username     = case when private.username_blocked(u.username) then null else u.username end,
             display_name = case
                              when u.username is not null and not private.username_blocked(u.username)
                                then u.username
                              else 'Player'
                            end,
             bio          = null,
             avatar_url   = null,
             banner_url   = null,
             current_obsessions = null,
             favorite_games = case
                                when jsonb_typeof(u.favorite_games) = 'array' then
                                  coalesce((select jsonb_agg(e - 'why')
                                              from jsonb_array_elements(u.favorite_games) e), '[]'::jsonb)
                                else u.favorite_games
                              end
       where u.id = p_id and u.deleted_at is null;
      get diagnostics v_n = row_count;

    else
      v_n := 0;
  end case;

  return v_n > 0;
end;
$$;

revoke all on function private.admin_user_card(uuid)            from public, anon, authenticated;
revoke all on function private.admin_report_target(text, uuid)  from public, anon, authenticated;
revoke all on function private.admin_remove_content(text, uuid) from public, anon, authenticated;


-- ============================================================
-- 10. Admin RPCs (each checks flag_enabled('admin') server-side)
-- ============================================================

-- Reports for one status (default: open = 'pending'), newest first, max 200.
create or replace function public.admin_reports(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.flag_enabled('admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if p_status is not null and p_status not in ('pending', 'reviewed', 'actioned', 'dismissed') then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  return coalesce((
    select jsonb_agg(x.item order by x.created_at desc)
      from (
        select r.created_at,
               jsonb_build_object(
                 'id',             r.id,
                 'content_type',   r.content_type,
                 'content_id',     r.content_id,
                 'reason',         r.reason,
                 'details',        r.details,
                 'status',         r.status,
                 'created_at',     r.created_at,
                 'reviewed_at',    r.reviewed_at,
                 'reviewer_notes', r.reviewer_notes,
                 'reporter',       private.admin_user_card(r.reporter_id),
                 'target',         private.admin_report_target(r.content_type, r.content_id),
                 'open_reports_on_target', (
                   select count(*) from public.reports r2
                    where r2.content_type = r.content_type
                      and r2.content_id   = r.content_id
                      and r2.status       = 'pending')
               ) as item
          from public.reports r
         where p_status is null or r.status = p_status
         order by r.created_at desc
         limit 200
      ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_open_report_count()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.flag_enabled('admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  return (select count(*)::int from public.reports where status = 'pending');
end;
$$;

-- p_action:
--   dismiss         -> every pending report on the same target becomes 'dismissed'
--                      (which also lifts any report auto-hide).
--   remove_content  -> soft-removes the target, reports become 'actioned'.
--   suspend_user    -> soft-removes the target AND suspends its author,
--                      reports become 'actioned'.
create or replace function public.admin_resolve_report(p_report_id uuid, p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid := auth.uid();
  v_report  public.reports%rowtype;
  v_target  jsonb;
  v_author  uuid;
  v_status  text;
  v_removed boolean := false;
  v_n       int;
begin
  if not public.flag_enabled('admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if p_action is null or p_action not in ('dismiss', 'remove_content', 'suspend_user') then
    raise exception using errcode = '22023', message = 'invalid_action';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'report_not_found';
  end if;
  if v_report.status <> 'pending' then
    raise exception using errcode = '55000', message = 'report_already_resolved';
  end if;

  v_target := private.admin_report_target(v_report.content_type, v_report.content_id);
  v_author := nullif(v_target ->> 'author_id', '')::uuid;

  if p_action = 'suspend_user' then
    if v_author is null then
      raise exception using errcode = '22023', message = 'no_author_to_suspend';
    end if;
    if v_author = v_admin then
      raise exception using errcode = '22023', message = 'cannot_suspend_self';
    end if;
  end if;

  if p_action in ('remove_content', 'suspend_user') then
    v_removed := private.admin_remove_content(v_report.content_type, v_report.content_id);
  end if;

  if p_action = 'suspend_user' then
    update public.users
       set suspended_at = coalesce(suspended_at, now())
     where id = v_author;
  end if;

  v_status := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;

  update public.reports
     set status         = v_status,
         reviewed_at    = now(),
         reviewer_notes = p_action
   where content_type = v_report.content_type
     and content_id   = v_report.content_id
     and status       = 'pending';
  get diagnostics v_n = row_count;

  insert into private.moderation_actions
    (admin_id, report_id, action, content_type, content_id, target_user_id, snapshot)
  values
    (v_admin, v_report.id, p_action, v_report.content_type, v_report.content_id, v_author, v_target);

  return jsonb_build_object(
    'status',           v_status,
    'action',           p_action,
    'reports_resolved', v_n,
    'content_removed',  v_removed
  );
end;
$$;

revoke all on function public.admin_reports(text)                from public, anon;
revoke all on function public.admin_open_report_count()          from public, anon;
revoke all on function public.admin_resolve_report(uuid, text)   from public, anon;
grant execute on function public.admin_reports(text)              to authenticated;
grant execute on function public.admin_open_report_count()        to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;


notify pgrst, 'reload schema';

commit;


-- ============================================================
-- VERIFY (read-only; run after the block above)
-- ============================================================

-- 1. New columns exist.
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'users' and column_name in ('terms_accepted_at', 'suspended_at'))
     or (column_name = 'removed_at'
         and table_name in ('reviews', 'review_comments', 'list_comments', 'lists', 'direct_messages'))
   )
 order by table_name, column_name;
-- expect 7 rows

-- 2. Text / removed / users triggers are in place.
select c.relname as table_name, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal
   and t.tgname in ('ugc_text_guard', 'ugc_removed_guard', 'ugc_users_safety_guard')
 order by 1, 2;
-- expect ugc_text_guard on comments, direct_messages, journal_entries,
-- list_comments, lists, play_sessions, qa_answers, qa_questions,
-- review_comments, reviews; ugc_removed_guard on direct_messages,
-- list_comments, lists, review_comments, reviews; ugc_users_safety_guard on users.

-- 3. Restrictive hide/freeze policies.
select tablename, policyname, permissive, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and policyname ~ '_(hide|freeze)_removed$'
 order by 1, 2;
-- expect 10 rows, all RESTRICTIVE

-- 4. Matcher behaves (true / false / false / true).
select
  private.text_blocked('you are a ' || (select term from private.blocked_terms order by term limit 1)) as blocked_word,
  private.text_blocked('Assassin''s Creed is a classic, Scunthorpe approves')                         as normal_text,
  private.text_blocked(null)                                                                          as null_text,
  not public.text_allowed('x_' || (select term from private.blocked_terms where term !~ ' ' order by term limit 1) || '_9', 'username') as blocked_handle;

-- 5. Admin flag: Ry only, global switch off.
select key, enabled, allow_user_ids from public.app_flags where key = 'admin';
select exists (select 1 from public.users where id = '6c88ae0e-29c7-44bf-9d42-72a67962bd17') as ry_profile_exists;

-- 6. Grants: admin RPCs not callable by anon; private helpers not callable by clients.
select routine_schema, routine_name, grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name in ('admin_reports', 'admin_open_report_count', 'admin_resolve_report',
                        'accept_terms', 'my_account_status', 'text_allowed',
                        'admin_report_target', 'admin_remove_content', 'admin_user_card')
   and grantee in ('anon', 'authenticated', 'PUBLIC')
 order by 1, 2, 3;
-- expect: admin_*/accept_terms/my_account_status -> authenticated only;
-- text_allowed -> anon + authenticated; private admin_* -> no rows.

-- 7. Private tables have no client grants.
select table_schema, table_name, grantee, privilege_type
  from information_schema.table_privileges
 where table_schema = 'private'
   and table_name in ('blocked_terms', 'moderation_actions')
   and grantee in ('anon', 'authenticated', 'PUBLIC');
-- expect 0 rows

-- 8. Existing content that already matches the list (left as-is; these are
--    only re-checked if edited). Counts only.
select 'reviews' as t, count(*) from public.reviews where private.text_blocked(body)
union all select 'review_comments', count(*) from public.review_comments where private.text_blocked(body)
union all select 'list_comments',   count(*) from public.list_comments   where private.text_blocked(body)
union all select 'lists',           count(*) from public.lists           where private.text_blocked(name) or private.text_blocked(description)
union all select 'journal_entries', count(*) from public.journal_entries where private.text_blocked(title) or private.text_blocked(body)
union all select 'play_sessions',   count(*) from public.play_sessions   where private.text_blocked(note)
union all select 'direct_messages', count(*) from public.direct_messages where private.text_blocked(body)
union all select 'qa_questions',    count(*) from public.qa_questions    where private.text_blocked(title) or private.text_blocked(body)
union all select 'qa_answers',      count(*) from public.qa_answers      where private.text_blocked(body)
union all select 'users',           count(*) from public.users           where private.text_blocked(display_name) or private.username_blocked(username) or private.text_blocked(bio);

-- 9. Nobody has accepted terms yet (everyone sees the one-time popup), nobody suspended.
select count(*) filter (where terms_accepted_at is not null) as accepted,
       count(*) filter (where suspended_at is not null)      as suspended,
       count(*)                                              as total
  from public.users;
