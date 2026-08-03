-- Half-provisioned accounts — reliable signup provisioning + backfill.
--
-- MANUAL RUN. Apply after 20260803000200_blocking_write_enforcement.sql.
--
-- DEPLOY COUPLING: src/services/auth.js must ship with this migration. signUp()
-- has to start passing display_name/username through options.data, and its
-- post-signup insert has to become a reconciliation update. Without that change
-- the trigger still has no chosen name to work with.
--
--
-- DIAGNOSIS
--
-- 13 of 34 auth.users rows had no public.users row. Every user foreign key in the
-- schema points at public.users(id), so those accounts could not follow, message,
-- post or write anything — they could sign in and then silently fail at every
-- write, with no indication why.
--
-- The trigger does exist and is correct in shape: on_auth_user_created, AFTER
-- INSERT ON auth.users FOR EACH ROW, enabled, calling a SECURITY DEFINER
-- handle_new_user() that inserts (id, display_name) ON CONFLICT (id) DO NOTHING.
-- It cannot be the cause of the orphans: it runs inside the auth.users insert, so
-- if it raised, the auth user would roll back too and there would be no orphan to
-- find. The orphans are all dated on or before 2026-07-04 04:57, and every account
-- created after that date does have a profile — including one orphan literally
-- named raw.trigger.check.1783139289483@example.com, created 2026-07-04 04:28,
-- which has no profile. The trigger was installed between 2026-07-04 and the next
-- signup on 2026-07-14, and the orphans all predate it.
--
-- The trigger was also never committed as a migration — it was applied
-- out-of-band — so it does not exist in a fresh environment. It is recreated here
-- so provisioning is reproducible rather than an artifact of this one database.
--
-- INTERACTION WITH THE SWALLOWED PK CONFLICT
--
-- The trigger fires inside the auth.users insert, so it always wins the race
-- against the client. By the time insertProfileRowWithRetry() in auth.js runs, the
-- row exists, so its INSERT returns 23505 on users_pkey. That code inspects the
-- error, decides it is not a username conflict, and returns as if it had
-- succeeded. The user's chosen values are dropped on the floor.
--
-- This is why chosen usernames never persist — and it is worse than usernames
-- alone. Because supabase.auth.signUp() was called with no options.data, the
-- trigger had no display_name to read either and fell through to
-- split_part(email, '@', 1). Every profile created since the trigger landed has
-- username = NULL and display_name = the user's email local-part:
--
--   2026-07-17  display_name '1242168240'      username NULL
--   2026-07-14  display_name 'cursortest42'    username NULL
--   2026-07-01  display_name 'woolly_redhead6q' username NULL
--
-- FIX
--
--   1. The trigger reads display_name and username out of raw_user_meta_data, so
--      the values the user actually typed land on the row it creates.
--   2. The trigger can no longer fail. display_name falls through a COALESCE chain
--      ending in a literal, and a username that is malformed or already taken is
--      stored as NULL instead of raising — a unique violation here would roll back
--      the auth.users insert and make signup impossible rather than merely lossy.
--   3. auth.js stops treating a PK conflict as success and reconciles instead.
--   4. The 13 existing orphans are backfilled below.


-- ============================================================
-- 1. Provisioning trigger
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_username     text;
begin
  -- Ends in a literal, so this can never violate display_name NOT NULL — including
  -- for a phone or OAuth signup where email is null.
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Player'
  );

  -- Same normalisation as normalizeUsername() + USERNAME_PATTERN in
  -- src/services/auth.js: lowercase, [a-z0-9_] only, 3-20 characters.
  v_username := nullif(
    regexp_replace(lower(btrim(coalesce(new.raw_user_meta_data->>'username', ''))),
                   '[^a-z0-9_]', '', 'g'),
    ''
  );

  if v_username is not null
     and (
       char_length(v_username) < 3
       or char_length(v_username) > 20
       or exists (select 1 from public.users u where u.username = v_username)
     )
  then
    -- Drop the handle rather than raise. Raising would roll back the auth.users
    -- insert and the account would not be created at all.
    v_username := null;
  end if;

  insert into public.users (id, display_name, username)
  values (new.id, v_display_name, v_username)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Recreated here because the trigger was originally applied out-of-band and is
-- absent from a freshly-migrated database.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from anon, authenticated, public;


-- ============================================================
-- 2. Backfill the existing orphans
-- ============================================================
-- All 13 get a profile. display_name is derived the same way the trigger derives
-- it, so a backfilled account is indistinguishable from a freshly-provisioned one.
--
-- username stays NULL on purpose. The chosen handle was never persisted anywhere,
-- so there is nothing to recover; deriving one from the email address would squat
-- a handle the user never picked and burn it against the unique index. They set it
-- in Edit Profile, which already works.
--
-- created_at is carried over from auth.users so the profile does not claim to be
-- newer than the account.
--
-- User B (50e66848, theantifail@gmail.com) is excluded. Its profile row was
-- created by the pentest and 20260803000400 removes it to restore the pre-test
-- state; without this exclusion, re-running this migration after that one would
-- put it straight back.

insert into public.users (id, display_name, username, created_at)
select
  au.id,
  coalesce(
    nullif(btrim(au.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(au.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(au.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(au.email, ''), '@', 1), ''),
    'Player'
  ),
  null,
  au.created_at
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null
  and au.id <> '50e66848-e744-40bf-af07-0152597e1144'::uuid
on conflict (id) do nothing;
