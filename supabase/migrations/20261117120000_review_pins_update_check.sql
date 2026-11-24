-- Pins can only point at your own reviews, and logged-out visitors lose
-- write rights they never needed.
--
-- Why: pins_update_self checked only that the pin is yours, so a user could
-- point their pin at someone else's review (insert already required your own
-- review; update didn't). The app never updates pins, so normal use is
-- unaffected. The anon revokes are Supabase defaults that RLS already blocked;
-- removing them is belt and braces. TRUNCATE is never reachable through the
-- API but has no reason to exist for app roles.
--
-- Run once: Supabase → SQL Editor → paste ALL → Run. Safe to re-run.
-- Expected result: pins_update_self = fixed, logged-out write rights left = 0.

begin;

drop policy if exists pins_update_self on public.review_pins;
create policy pins_update_self on public.review_pins
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
        from public.reviews r
       where r.id = review_pins.review_id
         and r.user_id = auth.uid()
    )
  );

revoke insert, update, delete, truncate on public.review_pins from anon;
revoke insert, update, delete, truncate on public.users from anon;
revoke truncate on public.review_pins, public.users from authenticated;

commit;

select 'pins_update_self' as check_name,
       case when with_check like '%reviews%' then 'fixed' else 'NOT FIXED' end as result
  from pg_policies
 where schemaname = 'public' and tablename = 'review_pins' and policyname = 'pins_update_self'
union all
select 'logged-out write rights left',
       count(*)::text
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('review_pins', 'users')
   and grantee = 'anon'
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
