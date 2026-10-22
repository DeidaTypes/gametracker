-- Push (N-2): device tokens, push-send dispatch on notifications and DMs,
-- and badge sync when things are read.
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   public.notifications (+ payload), user_notification_prefs,
--   private.push_enabled                                        (20261022171000)
--     -> NOT applied on the live project as of 2026-10-22. Run that file
--        first; section 0 below refuses to continue without it.
--   public.direct_messages (+ removed_at)                       (supabase/direct_messages.sql, 20261022143000)
--   private.is_blocked_between                                  (20260801010205)
--   users.deleted_at                                            (20260915161157)
--   pg_net + supabase_vault (both installed)
--
-- BEFORE RUNNING
--   1. Deploy the function:  supabase functions deploy push-send --no-verify-jwt
--   2. Pick one random value and store it twice:
--        supabase secrets set PUSH_SEND_SECRET=<value>
--        select vault.create_secret('<value>', 'push_send_secret');
--      Until the Vault secret exists, private.push_dispatch is a no-op, so
--      nothing is called and nothing fails.
--
-- HOW IT FLOWS
--   notifications INSERT  -> push_dispatch('notification', id)
--   direct_messages INSERT -> push_dispatch('message', id)
--   notifications read / direct_messages read_at or removed_at (per statement)
--                          -> push_dispatch('badge', recipient)
--   push-send calls public.push_context(source, id), which decides
--   everything: self, deleted users, blocks, push prefs, previews, unread
--   count, tokens. The request body carries ids only, never message text.
--   Dispatch only happens when the recipient has at least one device token,
--   so users without push cost nothing.
--
-- A push failure never blocks the write that caused it: every trigger
-- swallows its own errors with a WARNING (private.notify relies on this too,
-- since an error inside its insert would roll that notification back).


begin;

-- ============================================================
-- 0. Guard: N-1 must be applied
-- ============================================================

do $$
begin
  if to_regclass('public.user_notification_prefs') is null
     or to_regprocedure('private.push_enabled(uuid, public.notification_type)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'notifications'
                       and column_name = 'payload') then
    raise exception 'Run 20261022171000_notifications_v2.sql before this file.';
  end if;
end $$;

create extension if not exists pg_net with schema extensions;


-- ============================================================
-- 1. Message push prefs
-- ============================================================
-- No row = on. push_message_previews off -> "New message from {name}".

alter table public.user_notification_prefs
  add column if not exists push_messages         boolean not null default true,
  add column if not exists push_message_previews boolean not null default true;

grant insert (push_messages, push_message_previews)
  on public.user_notification_prefs to authenticated;
grant update (push_messages, push_message_previews)
  on public.user_notification_prefs to authenticated;


-- ============================================================
-- 2. device_tokens
-- ============================================================
-- One row per APNs token. A token belongs to one user at a time: signing
-- into another account on the same phone moves it (register_device_token).

create table if not exists public.device_tokens (
  token      text        primary key check (token ~ '^[0-9a-f]{64,200}$'),
  user_id    uuid        not null references public.users (id) on delete cascade,
  platform   text        not null default 'ios' check (platform in ('ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

comment on table public.device_tokens is
  'APNs device tokens. Written via register_device_token / unregister_device_token; read by push-send through push_context.';

alter table public.device_tokens enable row level security;

revoke all on public.device_tokens from anon, authenticated;
grant select, delete on public.device_tokens to authenticated;
grant insert (token, user_id, platform) on public.device_tokens to authenticated;
grant all on public.device_tokens to service_role;

drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists device_tokens_insert_own on public.device_tokens;
create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());


-- ============================================================
-- 3. Register / unregister
-- ============================================================

-- Called after iOS hands the app a token (every launch with permission).
-- Upserts, moves a token that was registered to another account, and keeps
-- at most 10 tokens per user (newest first).
create or replace function public.register_device_token(p_token text, p_platform text default 'ios')
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text := lower(btrim(coalesce(p_token, '')));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_token !~ '^[0-9a-f]{64,200}$' then
    raise exception 'invalid_device_token' using errcode = '22023';
  end if;
  if coalesce(p_platform, '') <> 'ios' then
    raise exception 'unsupported_platform' using errcode = '22023';
  end if;
  if exists (select 1 from public.users u where u.id = v_uid and u.deleted_at is not null) then
    return;
  end if;

  insert into public.device_tokens (token, user_id, platform, updated_at)
  values (v_token, v_uid, p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  delete from public.device_tokens d
   where d.user_id = v_uid
     and d.token not in (
       select k.token from public.device_tokens k
        where k.user_id = v_uid
        order by k.updated_at desc
        limit 10);
end;
$$;

-- Called on sign-out, before the session is dropped.
create or replace function public.unregister_device_token(p_token text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  delete from public.device_tokens
   where token = lower(btrim(coalesce(p_token, '')))
     and user_id = auth.uid();
$$;

-- Account deletion keeps the users row (delete-account anonymises it), so
-- the FK cascade never fires. Drop tokens when deleted_at is stamped.
create or replace function private.device_tokens_on_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.device_tokens where user_id = new.id;
  return null;
end;
$$;

drop trigger if exists device_tokens_on_user_deleted on public.users;
create trigger device_tokens_on_user_deleted
  after update of deleted_at on public.users
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.device_tokens_on_user_deleted();


-- ============================================================
-- 4. What push-send needs to know
-- ============================================================

-- App icon badge: unread bell rows + unread DMs. DMs from a blocked partner
-- are excluded because the inbox hides that thread, so they could never be
-- read and the badge would stick.
create or replace function private.push_unread_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    (select count(*) from public.notifications n
      where n.recipient_user_id = p_user and n.read = false)
    +
    (select count(*) from public.direct_messages m
      where m.recipient_id = p_user
        and m.read_at is null
        and m.removed_at is null
        and not private.is_blocked_between(p_user, m.sender_id))
  )::integer;
$$;

create or replace function private.push_has_tokens(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.device_tokens d where d.user_id = p_user);
$$;

-- The single decision point. service_role only (push-send).
--   p_source 'notification' -> p_id = notifications.id
--   p_source 'message'      -> p_id = direct_messages.id
--   p_source 'badge'        -> p_id = recipient user id
-- Returns { send: false, reason } or
--   { send: true, source, type, recipient_id, actor, entity_id, payload,
--     preview, badge, tokens }
-- preview is the first 61 chars of the DM body (61 so the caller can tell
-- it was cut), and only when the recipient allows previews.
create or replace function public.push_context(p_source text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient uuid;
  v_actor     uuid;
  v_type      public.notification_type;
  v_type_text text;
  v_entity    text;
  v_payload   jsonb := '{}'::jsonb;
  v_read      boolean;
  v_body      text;
  v_removed   timestamptz;
  v_preview   text;
  v_prefs     public.user_notification_prefs%rowtype;
  v_tokens    jsonb;
  v_actor_obj jsonb;
begin
  if p_id is null then
    return jsonb_build_object('send', false, 'reason', 'no_id');
  end if;

  if p_source = 'notification' then
    select n.recipient_user_id, n.actor_user_id, n.type, n.entity_id, n.payload, n.read
      into v_recipient, v_actor, v_type, v_entity, v_payload, v_read
      from public.notifications n
     where n.id = p_id;
    if not found then
      return jsonb_build_object('send', false, 'reason', 'not_found');
    end if;
    if v_read then
      return jsonb_build_object('send', false, 'reason', 'already_read');
    end if;
    v_type_text := v_type::text;
    if not private.push_enabled(v_recipient, v_type) then
      return jsonb_build_object('send', false, 'reason', 'pref_off');
    end if;

  elsif p_source = 'message' then
    select m.recipient_id, m.sender_id, m.body, m.removed_at, (m.read_at is not null)
      into v_recipient, v_actor, v_body, v_removed, v_read
      from public.direct_messages m
     where m.id = p_id;
    if not found or v_removed is not null then
      return jsonb_build_object('send', false, 'reason', 'not_found');
    end if;
    if v_read then
      return jsonb_build_object('send', false, 'reason', 'already_read');
    end if;
    v_type_text := 'message';
    select * into v_prefs from public.user_notification_prefs p where p.user_id = v_recipient;
    if not coalesce(v_prefs.push_messages, true) then
      return jsonb_build_object('send', false, 'reason', 'pref_off');
    end if;
    if coalesce(v_prefs.push_message_previews, true) and v_body is not null then
      v_preview := left(regexp_replace(btrim(v_body), '\s+', ' ', 'g'), 61);
    end if;

  elsif p_source = 'badge' then
    v_recipient := p_id;
    v_type_text := 'badge';

  else
    return jsonb_build_object('send', false, 'reason', 'bad_source');
  end if;

  if not exists (select 1 from public.users u
                  where u.id = v_recipient and u.deleted_at is null) then
    return jsonb_build_object('send', false, 'reason', 'recipient_gone');
  end if;

  if p_source <> 'badge' then
    if v_actor is not null and v_actor = v_recipient then
      return jsonb_build_object('send', false, 'reason', 'self');
    end if;
    -- admin_report ignores blocks on purpose (same rule as the bell row).
    if v_actor is not null and v_type_text <> 'admin_report' then
      if private.is_blocked_between(v_recipient, v_actor) then
        return jsonb_build_object('send', false, 'reason', 'blocked');
      end if;
      if not exists (select 1 from public.users u
                      where u.id = v_actor and u.deleted_at is null) then
        return jsonb_build_object('send', false, 'reason', 'actor_gone');
      end if;
    end if;
    -- Anonymous types never carry the actor, not even to push-send.
    if v_actor is not null and v_type_text not in ('qa_stuck_answered', 'admin_report') then
      select jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name)
        into v_actor_obj
        from public.users u where u.id = v_actor;
    end if;
  end if;

  select jsonb_agg(d.token order by d.updated_at desc)
    into v_tokens
    from public.device_tokens d
   where d.user_id = v_recipient;
  if v_tokens is null then
    return jsonb_build_object('send', false, 'reason', 'no_tokens');
  end if;

  return jsonb_build_object(
    'send',         true,
    'source',       p_source,
    'type',         v_type_text,
    'recipient_id', v_recipient,
    'actor',        v_actor_obj,
    'entity_id',    v_entity,
    'payload',      coalesce(v_payload, '{}'::jsonb),
    'preview',      v_preview,
    'badge',        private.push_unread_count(v_recipient),
    'tokens',       v_tokens
  );
end;
$$;


-- ============================================================
-- 5. Dispatch (pg_net -> push-send)
-- ============================================================

create or replace function private.push_dispatch(p_source text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s
   where s.name = 'push_send_secret'
   limit 1;
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := 'https://kxypykesyicetabrksfs.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-push-secret', v_secret),
    body    := jsonb_build_object('source', p_source, 'id', p_id),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'private.push_dispatch(%): % (%)', p_source, sqlerrm, sqlstate;
end;
$$;

create or replace function private.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.actor_user_id is distinct from new.recipient_user_id
       and private.push_has_tokens(new.recipient_user_id) then
      perform private.push_dispatch('notification', new.id);
    end if;
  exception when others then
    raise warning 'private.push_on_notification: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification
  after insert on public.notifications
  for each row execute function private.push_on_notification();

create or replace function private.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.removed_at is null
       and new.sender_id is distinct from new.recipient_id
       and private.push_has_tokens(new.recipient_id) then
      perform private.push_dispatch('message', new.id);
    end if;
  exception when others then
    raise warning 'private.push_on_message: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists push_on_message on public.direct_messages;
create trigger push_on_message
  after insert on public.direct_messages
  for each row execute function private.push_on_message();

-- Badge sync. Per statement, so "mark these 30 rows read" is one push per
-- recipient, not 30. Transition tables cannot be combined with UPDATE OF,
-- hence the old/new join.
create or replace function private.push_badge_on_notifications_read()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  begin
    for v_uid in
      select distinct n.recipient_user_id
        from new_rows n
        join old_rows o on o.id = n.id
       where o.read = false and n.read = true
    loop
      if private.push_has_tokens(v_uid) then
        perform private.push_dispatch('badge', v_uid);
      end if;
    end loop;
  exception when others then
    raise warning 'private.push_badge_on_notifications_read: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists push_badge_on_read on public.notifications;
create trigger push_badge_on_read
  after update on public.notifications
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.push_badge_on_notifications_read();

create or replace function private.push_badge_on_messages_read()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  begin
    for v_uid in
      select distinct n.recipient_id
        from new_rows n
        join old_rows o on o.id = n.id
       where (o.read_at is null and n.read_at is not null)
          or (o.removed_at is null and n.removed_at is not null)
    loop
      if private.push_has_tokens(v_uid) then
        perform private.push_dispatch('badge', v_uid);
      end if;
    end loop;
  exception when others then
    raise warning 'private.push_badge_on_messages_read: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

drop trigger if exists push_badge_on_read on public.direct_messages;
create trigger push_badge_on_read
  after update on public.direct_messages
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.push_badge_on_messages_read();


-- ============================================================
-- 6. Function grants
-- ============================================================

revoke all on function public.register_device_token(text, text)   from public, anon;
revoke all on function public.unregister_device_token(text)       from public, anon;
grant execute on function public.register_device_token(text, text) to authenticated;
grant execute on function public.unregister_device_token(text)     to authenticated;

revoke all on function public.push_context(text, uuid) from public, anon, authenticated;
grant execute on function public.push_context(text, uuid) to service_role;

revoke all on function private.device_tokens_on_user_deleted()     from public, anon, authenticated;
revoke all on function private.push_unread_count(uuid)              from public, anon, authenticated;
revoke all on function private.push_has_tokens(uuid)                from public, anon, authenticated;
revoke all on function private.push_dispatch(text, uuid)            from public, anon, authenticated;
revoke all on function private.push_on_notification()               from public, anon, authenticated;
revoke all on function private.push_on_message()                    from public, anon, authenticated;
revoke all on function private.push_badge_on_notifications_read()   from public, anon, authenticated;
revoke all on function private.push_badge_on_messages_read()        from public, anon, authenticated;


notify pgrst, 'reload schema';

commit;


-- ============================================================
-- VERIFY (read-only; run after the block above)
-- ============================================================

-- 1. Table, policies, client privileges.
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'device_tokens' order by 1;
-- expect device_tokens_delete_own (DELETE), _insert_own (INSERT), _select_own (SELECT)
select grantee, privilege_type from information_schema.table_privileges
 where table_schema = 'public' and table_name = 'device_tokens'
   and grantee in ('anon', 'authenticated') order by 1, 2;
-- expect authenticated DELETE, SELECT only (INSERT is column-level); no anon rows

-- 2. Triggers in place.
select c.relname as table_name, t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal
   and (t.tgname like 'push_%' or t.tgname = 'device_tokens_on_user_deleted')
 order by 1, 2;
-- expect direct_messages: push_badge_on_read, push_on_message;
--        notifications: push_badge_on_read, push_on_notification;
--        users: device_tokens_on_user_deleted

-- 3. push_context is service_role only.
select grantee from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'push_context'
   and grantee in ('anon', 'authenticated', 'PUBLIC');
-- expect 0 rows

-- 4. Dispatch is armed (true once the Vault secret exists).
select exists (select 1 from vault.secrets where name = 'push_send_secret') as push_armed;

-- 5. push_context on a random id says no, without error.
select public.push_context('notification', gen_random_uuid());
-- expect {"send": false, "reason": "not_found"}
