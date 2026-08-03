-- Public profile view — separates the shareable profile from the private settings.
--
-- MANUAL RUN. Apply after 20260803000050_revoke_anon_select_grants.sql.
--
-- DEPLOY COUPLING: src/services/auth.js must ship with this migration. It drops
-- streak_share_opt_in from PROFILE_COLUMNS and reads it from get_my_settings()
-- instead. Shipping the migration without the client change makes the own-profile
-- fetch 403.
--
-- The finding: every read of public.users returned all 16 columns, including
-- activity_privacy, presence_opt_in and streak_share_opt_in. RLS is row-level and
-- cannot hide a column, so the fix is two-part — a view that projects only the
-- safe columns, and column privileges that keep the settings columns off the API
-- roles entirely.
--
-- COLUMN CLASSIFICATION
--
--   Safe — projected by public.public_profiles, granted to anon + authenticated.
--   These are what a profile card, profile hero and author byline render:
--     id, username, display_name, bio, avatar_url, banner_url,
--     genre_badge, platform_badge, favorite_games, showcase_badges,
--     current_obsessions, created_at
--
--   Private — not in the view, revoked from anon and authenticated, reachable
--   only by the row's owner through get_my_settings():
--     activity_privacy      (who may see my activity)
--     presence_opt_in       (am I broadcasting "playing now")
--     streak_share_opt_in   (am I in other people's streak circles)
--
--   Internal — kept on the base table for the owner's own read, not in the view:
--     updated_at            (last profile edit; nothing public renders it)
--
-- There is no email column on public.users, and auth.users is not exposed
-- through PostgREST, so no credential or contact data was ever in scope here.


-- ============================================================
-- 1. users — profiles stay public, but blocks now apply
-- ============================================================
-- Was: users_select_all  FOR SELECT  USING (true)
--
-- Row visibility is deliberately NOT narrowed to the owner. Profiles are one of
-- the two shareable units, a logged-out visitor must be able to open a shared
-- profile link, and ~45 PostgREST author embeds across the app
-- (users!reviews_user_id_fkey and friends) resolve against this table.
--
-- What changes is that blocking is now enforced here: with A blocking B, B can no
-- longer read A's profile row at all, so A's name and avatar stop resolving on
-- every surface that embeds an author. Anonymous callers have a null auth.uid(),
-- for which is_blocked_between() is false, so shared links keep working.

drop policy if exists users_select_all on public.users;

create policy users_select_public_profile on public.users
  for select
  using (
    auth.uid() = id
    or not private.is_blocked_between(auth.uid(), id)
  );


-- ============================================================
-- 2. Column privileges — settings columns off the API roles
-- ============================================================
-- 20260801010205 already revoked the table-level grant and re-granted 14 columns.
-- This narrows that grant: streak_share_opt_in joins the other two settings
-- columns as owner-only, and anon additionally loses updated_at.
--
-- Column privileges are role-based, not row-based, which is exactly why the
-- settings columns cannot simply be left granted and fenced off by RLS: any
-- authenticated caller would still read them off every other user's row.

revoke select on public.users from anon, authenticated;

grant select (
  id,
  username,
  display_name,
  bio,
  avatar_url,
  banner_url,
  genre_badge,
  platform_badge,
  favorite_games,
  showcase_badges,
  current_obsessions,
  created_at
) on public.users to anon;

-- authenticated additionally gets updated_at so the own-profile fetch in
-- auth.js can keep reading it. RLS still applies on top of these grants.
grant select (
  id,
  username,
  display_name,
  bio,
  avatar_url,
  banner_url,
  genre_badge,
  platform_badge,
  favorite_games,
  showcase_badges,
  current_obsessions,
  created_at,
  updated_at
) on public.users to authenticated;

-- The owner's own settings, including the third opt-in that just lost its column
-- grant. Takes no arguments and is scoped to auth.uid(), so it cannot be turned
-- into an oracle for anyone else's row.
create or replace function public.get_my_settings()
returns table(
  activity_privacy    activity_privacy_level,
  presence_opt_in     boolean,
  streak_share_opt_in boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select u.activity_privacy, u.presence_opt_in, u.streak_share_opt_in
  from users u
  where u.id = auth.uid();
$$;

revoke execute on function public.get_my_settings() from anon, public;
grant execute on function public.get_my_settings() to authenticated;


-- ============================================================
-- 3. public.public_profiles — the sanctioned public read surface
-- ============================================================
-- Safe columns only, with the same block check as the base-table policy.
--
-- security_invoker = false (the default) is load-bearing: the view executes as
-- its owner, so it is unaffected by the column privileges above and by any future
-- tightening of the users row policy. That makes it the stable contract for
-- public profile reads — and it is why the block filter has to be written into
-- the view body itself rather than inherited from the base table.

drop view if exists public.public_profiles;

create view public.public_profiles
with (security_invoker = false)
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
  u.created_at
from public.users u
where not private.is_blocked_between(auth.uid(), u.id);

comment on view public.public_profiles is
  'Safe-column projection of public.users for public/anon profile reads. '
  'Excludes activity_privacy, presence_opt_in, streak_share_opt_in (owner-only, '
  'via get_my_settings()) and updated_at. Enforces the bidirectional block check.';

revoke all on public.public_profiles from public;
grant select on public.public_profiles to anon, authenticated;
