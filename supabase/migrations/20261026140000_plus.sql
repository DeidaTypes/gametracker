-- Checkpoint Plus — server-owned entitlement columns on public.users.
--
-- MANUAL RUN. Paste this file into the Supabase SQL Editor and run it.
-- Do not apply it from the app, the CLI, or a migration runner.
--
-- Depends on:
--   public.public_profiles (security_invoker)   (20260803000100, 20260803000500)
--   pg_cron                                      (already enabled; see new_notable_schedule.sql)
--
-- WHAT THIS FILE RELIES ON (live facts, not assumptions)
--
--   * anon/authenticated hold TABLE-level INSERT and UPDATE on public.users
--     (see 20261022143000_ugc_safety.sql). A column-level REVOKE cannot narrow
--     a table-level grant, so plus_active / plus_expires_at are fenced by a
--     BEFORE trigger, exactly like suspended_at / terms_accepted_at.
--   * SELECT on public.users is column-level. plus_active gets a SELECT grant
--     for anon + authenticated (the badge renders on other people's names via
--     PostgREST author embeds, same as highest_streak_milestone).
--     plus_expires_at gets no SELECT grant; the owner reads it through
--     public.my_plus_status().
--   * public.public_profiles is security_invoker, so it can only project
--     columns the caller is granted. plus_active is appended to it.
--
-- WHO WRITES THESE COLUMNS
--   Only the revenuecat-webhook Edge Function (service_role) and the hourly
--   expiry sweep below (runs as the cron owner). Any write from anon or
--   authenticated that changes either column raises 42501.


begin;

create schema if not exists private;


-- ============================================================
-- 1. Columns
-- ============================================================

alter table public.users
  add column if not exists plus_active     boolean not null default false,
  add column if not exists plus_expires_at timestamptz;

comment on column public.users.plus_active is
  'True while the user holds the RevenueCat "plus" entitlement. Written only by the revenuecat-webhook Edge Function (service_role) and private.plus_expire_sweep(). Readable by everyone (Plus badge).';
comment on column public.users.plus_expires_at is
  'When the current Plus entitlement ends, including any billing grace period. Null for a one-time (lifetime) purchase or when the user never had Plus. Owner-only; read via public.my_plus_status().';


-- ============================================================
-- 2. Write fence — clients can never set Plus
-- ============================================================

create or replace function private.users_plus_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.plus_active     := false;
      new.plus_expires_at := null;
    elsif new.plus_active     is distinct from old.plus_active
       or new.plus_expires_at is distinct from old.plus_expires_at then
      raise exception using
        errcode = '42501',
        message = 'users: plus_active and plus_expires_at are not client-writable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.users_plus_guard() from public, anon, authenticated;

drop trigger if exists users_plus_guard on public.users;
create trigger users_plus_guard before insert or update on public.users
  for each row execute function private.users_plus_guard();


-- ============================================================
-- 3. Read grants
-- ============================================================

grant select (plus_active) on public.users to anon, authenticated;

create or replace function public.my_plus_status()
returns table (plus_active boolean, plus_expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.plus_active, u.plus_expires_at
  from public.users u
  where u.id = auth.uid();
$$;

revoke execute on function public.my_plus_status() from public, anon;
grant execute on function public.my_plus_status() to authenticated;


-- ============================================================
-- 4. public_profiles — append plus_active (column order otherwise unchanged)
-- ============================================================

create or replace view public.public_profiles
with (security_invoker = true)
as
select
  u.id,
  u.username,
  u.display_name,
  u.bio,
  u.avatar_url,
  u.banner_url,
  u.genre_badge,
  u.platform_badge,
  u.favorite_games,
  u.showcase_badges,
  u.current_obsessions,
  u.created_at,
  u.plus_active
from public.users u
where not private.is_blocked_between(auth.uid(), u.id);


-- ============================================================
-- 5. Expiry sweep — backstop for a lost EXPIRATION webhook
-- ============================================================
-- RevenueCat retries failed deliveries, so this should almost never change a
-- row. The hour of slack covers a RENEWAL / SUBSCRIPTION_EXTENDED webhook that
-- lands a little after the old expiry. plus_expires_at already includes any
-- billing grace period (the webhook stores the later of the two dates), and
-- lifetime purchases (null) are never touched.

create or replace function private.plus_expire_sweep()
returns integer
language sql
volatile
set search_path = public, pg_temp
as $$
  with expired as (
    update public.users
       set plus_active = false
     where plus_active
       and plus_expires_at is not null
       and plus_expires_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::int from expired;
$$;

revoke all on function private.plus_expire_sweep() from public, anon, authenticated;

commit;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'plus-expire-sweep') then
    perform cron.unschedule('plus-expire-sweep');
  end if;
end $$;

select cron.schedule(
  'plus-expire-sweep',
  '23 * * * *',
  $$ select private.plus_expire_sweep(); $$
);


-- ============================================================
-- VERIFY (run after the file above)
-- ============================================================
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'users'
--      and column_name in ('plus_active', 'plus_expires_at');
--   -- EXPECT 2 rows: plus_active boolean false NO, plus_expires_at timestamptz null YES
--
--   select grantee, column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'users'
--      and column_name in ('plus_active', 'plus_expires_at') and privilege_type = 'SELECT'
--      and grantee in ('anon', 'authenticated');
--   -- EXPECT 2 rows, both plus_active (anon, authenticated). No plus_expires_at.
--
--   select tgname from pg_trigger where tgname = 'users_plus_guard' and not tgisinternal;
--   -- EXPECT 1 row
--
--   select jobname, schedule from cron.job where jobname = 'plus-expire-sweep';
--   -- EXPECT 1 row: '23 * * * *'
--
--   -- Client write is refused (simulates the app's authenticated role):
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', (select id from public.users limit 1), 'role', 'authenticated')::text, true);
--     update public.users set plus_active = true where id = auth.uid();
--   rollback;
--   -- EXPECT: ERROR 42501 users: plus_active and plus_expires_at are not client-writable
