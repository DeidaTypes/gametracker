-- Fix-up: grant SELECT on users.highest_streak_milestone.
--
-- public.users has been column-privilege-locked down since
-- 20260801010205_rls_high_severity_fixes.sql / 20260803000100_public_profile_view.sql
-- — SELECT is revoked at the table level and re-granted per-column to anon/
-- authenticated. ALTER TABLE ... ADD COLUMN in
-- 20260914190000_streak_milestone_persistence.sql did NOT add
-- highest_streak_milestone to either column grant list, so every
-- `users!..._fkey(..., highest_streak_milestone)` embed added for profile
-- flair (reviewService.js, communityService.js) started failing outright
-- with 42501 "permission denied for table users" — confirmed live against
-- the running app during this task's self-check (see chat transcript).
--
-- highest_streak_milestone is a "safe" profile column in the same sense as
-- avatar_url/username (task 5: flair must be visible on OTHER users'
-- reviews/Pulse cards, including to anon via shared review links), so it
-- gets the same anon + authenticated grant those columns already have.

grant select (highest_streak_milestone) on public.users to anon;
grant select (highest_streak_milestone) on public.users to authenticated;
