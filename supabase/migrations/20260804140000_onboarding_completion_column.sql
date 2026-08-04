-- Onboarding completion flag — the column the app has always read.
--
-- supabase/onboarding.sql (Sprint 7.6) introduced users.onboarded_at, but it
-- was never applied to this project: the column does not exist, so
-- completeOnboarding()'s UPDATE fails with 42703 for every account that
-- finishes or skips onboarding, and App.jsx's `profile?.onboarded_at != null`
-- gate is permanently false. The localStorage mirror has been carrying the
-- gate alone, which means clearing app data or reinstalling walks a returning
-- user back through onboarding.
--
-- The column-level grants matter as much as the column itself: the API roles
-- hold per-column privileges on public.users (see 20260803000050), so a new
-- column with no grant is unreadable and unwritable even by its owner.

alter table public.users
  add column if not exists onboarded_at timestamptz;

-- Every row that predates this column belongs to someone who is already past
-- onboarding, so backfill before the gate goes live — otherwise switching it
-- on sends the entire existing beta back to step 0.
update public.users
   set onboarded_at = coalesce(created_at, now())
 where onboarded_at is null;

-- Read for both API roles, matching the rest of the profile column set that
-- auth.fetchProfile selects (it runs as `authenticated` once a session
-- exists, and as `anon` in the window right after signUp before the session
-- attaches). Write for the owner only: users_update_own already constrains
-- UPDATE to auth.uid() = id, and this is the only column that grant needs to
-- cover for onboarding.
grant select (onboarded_at) on public.users to anon, authenticated;
grant update (onboarded_at) on public.users to authenticated;
