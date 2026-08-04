-- Username uniqueness — case-insensitive, rule-enforced, no silent NULL fallback.
--
-- MANUAL RUN. Apply after 20260803000600_remove_pentest_userb_profile.sql.
--
-- DEPLOY COUPLING: src/services/usernameRules.js and src/services/auth.js must
-- ship with this migration. The rules encoded in the CHECK constraints below are
-- mirrored there character for character; auth.js also has to start calling the
-- public.is_username_available() RPC added here instead of selecting from
-- public_profiles, and has to map the trigger's new unique_violation onto a
-- user-facing "just taken" error. Applying this migration without that client
-- change turns the race-loser's error into an opaque 500.
--
--
-- DIAGNOSIS
--
-- Uniqueness was NOT missing. public.users already carried:
--
--   users_username_key   UNIQUE (username)
--   username_format      CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,20}$')
--
-- Three real defects sat behind that, none of which the constraint covered:
--
--   1. CASE. The unique index is a plain btree on username, so 'Hayakawa' and
--      'hayakawa' are two different handles. Sign-up happens to lowercase its
--      input, but EditProfileModal.jsx validates against [a-zA-Z0-9_] and writes
--      username.trim() with no lowercasing — and the CHECK above explicitly
--      permits uppercase. Edit Profile is therefore a live path to a
--      case-variant collision, and it is the one users reach after signup.
--
--   2. SILENT NULL FALLBACK. handle_new_user() (20260803000300) resolves a
--      malformed or taken handle to NULL and inserts the row anyway, so a
--      collision produces an account with no handle and no error. That was a
--      deliberate trade at the time — the comment there is correct that raising
--      rolls back the auth.users insert — but "account silently has no username"
--      is the worse failure, and the client now pre-flights availability so the
--      raise is a race backstop rather than the common path.
--
--   3. NO CONTENT RULES. '___' , '_bob', 'a__b' and 'admin' were all accepted.
--
-- DATA STATE AT TIME OF WRITING (verified against production)
--
--   total public.users rows ................ 18
--   username IS NULL ....................... 13
--   username IS NOT NULL ................... 5
--   case-insensitive duplicate groups ...... 0
--   usernames containing uppercase ......... 0
--
-- So there are NO duplicates to resolve: the case-insensitive index below can be
-- built directly. The 13 NULLs are the June orphan cohort backfilled by
-- 20260803000300, which deliberately left username NULL rather than squatting a
-- handle the user never chose. They must keep working, so NULL stays legal in
-- the constraint — a partial/expression unique index ignores NULLs anyway. New
-- signups no longer produce NULL because the trigger now raises instead.
--
-- The 5 existing handles (carlos, theempress, blackoutx215, airwrecka,
-- hayakawa) were each checked against the stricter rules below and all pass, so
-- the new CHECK constraints validate without exceptions or grandfathering.
--
-- FIX
--
--   1. Replace the case-sensitive unique constraint with a unique index on
--      lower(username).
--   2. Tighten username_format to the shared rule set (lowercase only, no
--      leading/trailing underscore, no doubled underscore).
--   3. Add a reserved-word CHECK.
--   4. handle_new_user() raises unique_violation on a taken handle instead of
--      nulling it, and raises check_violation on a malformed one.
--   5. Add is_username_available() so the client can check case-insensitively
--      without the blocked-user blind spot in public_profiles.


-- ============================================================
-- 0. Preflight — refuse to run against dirty data
-- ============================================================
-- Production is clean (0 duplicate groups, verified above), but this migration
-- is also the thing that provisions a fresh environment, and a restored dump or
-- a staging database may not be. Failing loudly here is better than failing
-- opaquely on CREATE UNIQUE INDEX, because the message names the offenders.

do $$
declare
  v_dupes text;
  v_invalid text;
begin
  select string_agg(format('%s (x%s)', lu, n), ', ')
    into v_dupes
  from (
    select lower(username) as lu, count(*) as n
    from public.users
    where username is not null
    group by 1
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception using
      errcode = 'data_exception',
      message = 'Cannot add a case-insensitive unique index: duplicate usernames exist',
      detail  = v_dupes,
      hint    = 'Resolve the duplicates (keep the oldest row''s handle, NULL the rest) and re-run.';
  end if;

  select string_agg(username, ', ')
    into v_invalid
  from public.users
  where username is not null
    and (
      username <> lower(username)
      or username !~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'
      or username ~ '__'
    );

  if v_invalid is not null then
    raise exception using
      errcode = 'data_exception',
      message = 'Existing usernames violate the new format rules',
      detail  = v_invalid,
      hint    = 'Lowercase/repair these handles before applying the stricter CHECK.';
  end if;
end $$;


-- ============================================================
-- 1. Reserved handles
-- ============================================================
-- IMMUTABLE + a literal array rather than a lookup table, because a CHECK
-- constraint may only call immutable functions and a table read is not one. The
-- trade-off is that adding a reserved word needs a migration; that is
-- acceptable for a list that changes roughly never, and it keeps the rule
-- reviewable in version control instead of hidden in a row.
--
-- Mirrors RESERVED_USERNAMES in src/services/usernameRules.js. Same order, so
-- the two lists diff cleanly.

create or replace function private.is_username_reserved(candidate text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(coalesce(candidate, '')) = any (array[
    'about','account','admin','administrator','api','auth','billing',
    'checkpoint','contact','discover','explore','feed','game','games','help',
    'home','legal','library','list','lists','login','logout','mail','me',
    'messages','mod','moderator','notifications','null','official',
    'onboarding','password','privacy','profile','review','reviews','root',
    'search','security','settings','signin','signup','staff','support',
    'system','team','terms','undefined','user','users','www'
  ]);
$$;

revoke execute on function private.is_username_reserved(text) from anon, authenticated, public;


-- ============================================================
-- 2. Case-insensitive uniqueness
-- ============================================================
-- lower(username) rather than citext: no extension dependency, and the
-- expression index is what PostgREST/PostgreSQL will use for the availability
-- lookup in is_username_available() below.
--
-- NULLs are exempt automatically — a btree unique index treats every NULL as
-- distinct — which is exactly what the 13 orphan-era rows need.

alter table public.users
  drop constraint if exists users_username_key;

create unique index if not exists users_username_lower_key
  on public.users (lower(username));

comment on index public.users_username_lower_key is
  'Case-insensitive uniqueness for handles. NULL is exempt (orphan-era rows, '
  'see 20260803000300). This index is the source of truth that decides who wins '
  'when two signups race for the same handle.';


-- ============================================================
-- 3. Format + reserved-word rules
-- ============================================================
-- Mirrors validateUsername() in src/services/usernameRules.js:
--   3-20 chars, [a-z0-9_], alphanumeric first and last character, no '__'.
-- The bookend classes in the regex are what forbid a leading/trailing
-- underscore, and the {1,18} middle is what pins the length range.

alter table public.users
  drop constraint if exists username_format;

alter table public.users
  add constraint username_format check (
    username is null
    or (
      username ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'
      and username !~ '__'
    )
  );

alter table public.users
  drop constraint if exists username_not_reserved;

alter table public.users
  add constraint username_not_reserved check (
    username is null or not private.is_username_reserved(username)
  );


-- ============================================================
-- 4. Availability check (RPC)
-- ============================================================
-- Replaces the client's previous `public_profiles ... ilike(username)` lookup,
-- which had two defects:
--
--   a. public_profiles filters out users blocked in either direction
--      (WHERE NOT private.is_blocked_between(auth.uid(), id)). A handle held by
--      someone who blocked you therefore read as AVAILABLE, and the user only
--      found out when the insert failed.
--   b. it used .maybeSingle(), which errors when more than one row matches —
--      and the caller soft-fails open on error, so any such case also read as
--      available.
--
-- SECURITY DEFINER so it can read public.users regardless of the caller's
-- grants (anon holds only column-level SELECT, and the signup screen runs
-- anonymously). It returns one boolean and takes the handle as an argument, so
-- it discloses nothing the signup form does not already display.
--
-- Reserved and malformed handles report as unavailable: from the caller's point
-- of view "you cannot have this" is the same answer, and the client validates
-- format separately to render the more specific message.

create or replace function public.is_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when nullif(btrim(lower(coalesce(candidate, ''))), '') is null then false
      when private.is_username_reserved(candidate) then false
      when btrim(lower(candidate)) !~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$' then false
      when btrim(lower(candidate)) ~ '__' then false
      else not exists (
        select 1
        from public.users u
        where lower(u.username) = btrim(lower(candidate))
      )
    end;
$$;

revoke execute on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

comment on function public.is_username_available(text) is
  'Case-insensitive handle availability for the signup/edit-profile forms. '
  'SECURITY DEFINER so it sees every row (public_profiles hides blocked users, '
  'which made their handles read as available). Advisory only — '
  'users_username_lower_key is the authority.';


-- ============================================================
-- 5. Provisioning trigger — no more silent NULL fallback
-- ============================================================
-- 20260803000300 resolved a taken or malformed handle to NULL so the insert
-- could not fail, on the reasoning that raising would roll back the auth.users
-- insert and no account would be created at all. That reasoning is
-- mechanically correct and the outcome is still wrong: the user asked for a
-- handle, got an account without one, and was told nothing.
--
-- Rolling back is now the DESIRED behaviour. No auth user is created, the
-- client surfaces "that username was just taken", and the user retries with a
-- different handle — instead of owning a half-configured account. This is only
-- reachable as a race: auth.js checks availability before calling signUp(), so
-- getting here means someone claimed the handle in the intervening
-- milliseconds.
--
-- display_name keeps its COALESCE-to-literal chain. It must never raise: it is
-- derived, not chosen, and there is no user error to report.

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
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Player'
  );

  -- Same normalisation as normalizeUsername() in usernameRules.js: lowercase,
  -- strip a leading @, drop everything outside [a-z0-9_].
  v_username := nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(new.raw_user_meta_data->>'username', ''))), '^@+', ''),
      '[^a-z0-9_]', '', 'g'
    ),
    ''
  );

  -- A signup with no username at all stays legal (OAuth/phone paths, and the
  -- orphan-era rows). What is no longer legal is asking for a handle and
  -- silently not getting it.
  if v_username is not null then
    if v_username !~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'
       or v_username ~ '__'
       or private.is_username_reserved(v_username)
    then
      raise exception using
        errcode = 'check_violation',
        message = 'username_invalid',
        detail  = format('Requested handle %L does not satisfy the username rules.', v_username);
    end if;

    if exists (
      select 1 from public.users u where lower(u.username) = v_username
    ) then
      raise exception using
        errcode = 'unique_violation',
        message = 'username_taken',
        detail  = format('Handle %L is already registered.', v_username);
    end if;
  end if;

  insert into public.users (id, display_name, username)
  values (new.id, v_display_name, v_username)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Recreated for the same reason as in 20260803000300: the trigger was
-- originally applied out-of-band and must exist in a freshly-migrated database.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from anon, authenticated, public;
