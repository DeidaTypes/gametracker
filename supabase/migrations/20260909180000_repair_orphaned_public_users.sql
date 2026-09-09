-- Repair auth.users rows with no matching public.users row.
--
-- MANUAL RUN. Same convention as 20260803000300 / 20260803000600: these are
-- one-time data repairs, not part of the ordinary migration flow, and are
-- committed for review + reproducibility rather than pushed automatically.
--
-- TRIGGER: TURNED OUT NOT TO BE THE CAUSE
-- ------------------------------------------------------------------------
-- on_auth_user_created / handle_new_user() (installed by 20260803000300,
-- hardened by 20260804000100) is present, enabled, and correct today:
--
--   select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger
--     where tgname = 'on_auth_user_created';
--   -> tgenabled = 'O' (enabled), AFTER INSERT ON auth.users, calling
--      handle_new_user()
--
-- It cannot itself have produced an orphan: it is AFTER INSERT and now
-- RAISEs on a malformed/taken handle, so a trigger failure rolls back the
-- whole auth.users insert row and all — there is no half-made auth user left
-- over for it to explain. handle_new_user()'s own INSERT also ends in
-- `on conflict (id) do nothing`, so it can't lose a race either.
--
-- DIAGNOSIS — why these 4 accounts have no row anyway
-- ------------------------------------------------------------------------
-- 4 auth.users rows currently have no public.users row:
--
--   90ad1a94-ad0b-43ce-8943-e05cac03a3e7  rdeida180@gmail.com          2026-05-18  (App Store reviewer)
--   c8121556-ca8e-4b20-81ef-ed81e79889b8  woolly_redhead6q@icloud.com  2026-07-01
--   4d8f977c-f567-4834-9d37-bcb40f359b85  rdeida@gmail.com             2026-07-04
--   4ed19080-0278-449c-a39d-f59d227b43bb  cursortest42@example.com     2026-07-14
--
-- All 4 predate (or straddle) the trigger's installation window, so at some
-- point each of them WAS one of the accounts with no profile row. But none
-- of the 4 are among the 13 rows 20260803000300 backfilled for exactly that
-- reason — those 13 are verifiably all June-2026-dated (plus one 2026-07-02
-- row), by a different set of ids/emails, still sitting with username IS
-- NULL today, untouched since the backfill:
--
--   select id, display_name, created_at from public.users
--     where username is null order by created_at;
--   -> 13 rows, all created_at in June 2026 (+ one 2026-07-02), none of the
--      4 ids/emails above among them.
--
-- So these 4 were NOT orphans at backfill time (2026-08-03) — the backfill's
-- own WHERE clause (`left join public.users ... where pu.id is null`, with
-- only one explicit exclusion) would otherwise have caught them. The most
-- consistent live evidence is that each of them got a row at some point
-- (either from the app's own pre-trigger signup path, for the ones that
-- predate the trigger, or from the trigger itself once it existed) and that
-- row was later removed by something outside this app's code paths:
--
--   select schemaname, relname, n_tup_ins, n_tup_del, n_live_tup
--     from pg_stat_user_tables where relname = 'users';
--   -> public.users: n_tup_ins = 111, n_tup_del = 44, n_live_tup = 25
--
-- 44 lifetime deletes on a table that has exactly one documented, in-repo
-- delete (20260803000600, a single pentest-artifact row) means at least
-- ~43 other deletes happened via untracked/manual SQL, not via any code
-- path in this repo. The app's own delete-account Edge Function
-- (supabase/functions/delete-account) cannot be the cause either: its only
-- write to public.users is an UPDATE (soft-delete columns deleted_at /
-- deletion_reason), and those columns were never actually migrated onto the
-- live table (supabase/account_deletion.sql, which adds them, has no
-- matching entry in supabase_migrations.schema_migrations and the columns
-- are absent from information_schema.columns today) — so that function 500s
-- on its very first statement and never reaches a delete. There is no WAL
-- or query-log retention available here to identify the exact statement;
-- this is the most that live introspection can establish.
--
-- None of the 4 own any reviews or game_trackers rows, so this is not (yet)
-- a live user's history being repaired — but rdeida180@gmail.com is the App
-- Store reviewer account, which is the actual blocker this migration exists
-- to close.
--
-- FIX
-- ------------------------------------------------------------------------
-- Backfill exactly the current orphans. display_name derives the same way
-- handle_new_user() derives it for a signup with no chosen name. username
-- is derived from the email's local part and only kept if it independently
-- satisfies the live format/reserved/uniqueness rules (same predicate
-- is_username_available() uses) — otherwise NULL, same fallback the trigger
-- itself uses for a handle it can't grant. onboarded_at is set to now(): all
-- 4 of these are pre-existing accounts being repaired after the fact, not
-- brand-new signups that should see the onboarding flow, so this is a
-- deliberate difference from the generic self-heal guard shipped alongside
-- this migration (src/services/auth.js, ensureProfileExists /
-- selfHealProfileRow) which leaves onboarded_at unset for that reason.
--
-- Idempotent: only touches auth.users rows with no public.users match, so
-- re-running it after new legitimate orphans appear only backfills those,
-- and running it again with none present is a no-op.

insert into public.users (id, display_name, username, created_at, onboarded_at)
select
  au.id,
  coalesce(
    nullif(btrim(au.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(au.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(au.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(au.email, ''), '@', 1), ''),
    'Player'
  ) as display_name,
  case
    when c.candidate is not null
     and c.candidate ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'
     and c.candidate !~ '__'
     and not private.is_username_reserved(c.candidate)
     and not exists (
       select 1 from public.users u2 where lower(u2.username) = c.candidate
     )
    then c.candidate
    else null
  end as username,
  au.created_at,
  now() as onboarded_at
from auth.users au
left join public.users pu on pu.id = au.id
cross join lateral (
  select nullif(
    regexp_replace(lower(split_part(coalesce(au.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g'),
    ''
  ) as candidate
) c
where pu.id is null
on conflict (id) do nothing;
