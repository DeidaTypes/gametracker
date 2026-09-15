-- Account deletion — repair (App Store blocker fix)
--
-- supabase/account_deletion.sql existed in the repo but was never
-- registered as a migration and never ran: public.users has no
-- deleted_at / deletion_reason columns, so the delete-account Edge
-- Function's first UPDATE failed with 42703 for every real deletion
-- attempt. This migration is the properly-registered replacement.
--
-- Scope: two nullable columns on public.users. Everything else the
-- deletion flow needs (RLS, grants, other tables) already exists or is
-- intentionally left alone — see the audit + design notes in the PR /
-- commit description for the full per-table breakdown.
--
-- ── Grants: deliberately NONE for anon/authenticated ────────────────
-- Per the lesson in 20260803000050_revoke_anon_select_grants and
-- 20260804175851_onboarding_completion_column ("a new column with no
-- grant is unreadable and unwritable even by its owner"): here that is
-- exactly the desired behavior. Both columns are internal bookkeeping
-- written and read only by the delete-account Edge Function running as
-- service_role, which bypasses column grants entirely. The client never
-- needs to read deleted_at — there is no in-app "pending deletion,
-- restore?" flow (removed; see commit message for why a client-visible
-- restore window is not Apple-compliant) and no other UI surfaces it.
--
-- ── RLS: no change ───────────────────────────────────────────────────
-- users_select_public_profile already returns every row that isn't
-- blocked, regardless of column values. After deletion the row is
-- anonymized (display_name/username/bio/avatar/banner cleared) rather
-- than hidden, so it continues to satisfy every existing
-- users!<fk>(*) embed used by reviews/comments/lists/activity feeds —
-- they simply render "[deleted user]" instead of erroring on a missing
-- join target. Hiding the row instead would break those embeds for
-- every other user who ever interacted with the deleted account.

alter table public.users
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_reason text;

comment on column public.users.deleted_at is
  'Set once, permanently, by the delete-account Edge Function (service_role only) when the user completes in-app account deletion. No anon/authenticated grant by design -- not client-readable. NULL = active account.';

comment on column public.users.deletion_reason is
  'Optional free-text churn reason captured at deletion time (from the Settings deletion sheet). service_role only, used for internal analytics.';
