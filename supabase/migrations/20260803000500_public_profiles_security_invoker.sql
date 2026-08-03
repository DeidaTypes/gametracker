-- Turn public.public_profiles into a SECURITY INVOKER view.
--
-- 20260803000100 created it with security_invoker = false, which makes it run as
-- its owner and therefore bypass RLS on public.users entirely. Supabase's
-- database linter flags that as an ERROR (0010_security_definer_view), and it is
-- right to: a definer view is a standing RLS bypass whose only guard is the
-- correctness of its own WHERE clause. Get that clause wrong once and every
-- profile row is exposed with no policy left to catch it.
--
-- The definer mode was never actually needed. It would be, if anon had no
-- privilege on the base table — but anon deliberately keeps column-level SELECT
-- on the twelve safe columns, because PostgREST foreign-key embeds on shared
-- review links resolve the author against public.users directly. Since the
-- privilege is already there, an invoker view works and gives two independent
-- gates instead of one:
--
--   1. the view's projection — privacy columns are not in it,
--   2. the base table's column grants and RLS — which now still apply, so
--      users_select_public_profile's block check is enforced underneath.
--
-- The WHERE clause stays as a matter of intent, not because it is the only thing
-- standing between anon and the table.
--
-- DEPENDENCY, stated so it is not discovered by breakage: this view now requires
-- anon and authenticated to retain column-level SELECT on the columns it
-- projects. Revoking those grants to "fully lock down" the base table will make
-- this view return 403 instead of rows, and shared profile links will stop
-- rendering for logged-out visitors. Lock the base table down further only by
-- also moving the FK embeds off it.

begin;

alter view public.public_profiles set (security_invoker = true);

commit;
