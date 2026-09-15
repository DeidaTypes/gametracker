-- private.is_username_reserved(text) backs the username_not_reserved CHECK
-- constraint on public.users. CHECK constraints are evaluated with the
-- privileges of the role performing the write (see the comment on
-- 20260804183621_username_reserved_check_execute_grant.sql), and Postgres's
-- ACL check happens at plan time for every branch of the expression, not
-- just the one that ends up true at runtime -- so `username IS NULL OR NOT
-- is_username_reserved(username)` still needs EXECUTE even when username is
-- NULL and the right-hand side never actually runs.
--
-- 20260804183621 granted EXECUTE to anon and authenticated but not
-- service_role, because at the time nothing running as service_role ever
-- wrote to public.users. The delete-account Edge Function (service_role)
-- now does -- and every such UPDATE failed with 42501: permission denied
-- for function is_username_reserved, discovered live while testing the
-- account-deletion fix.

grant execute on function private.is_username_reserved(text) to service_role;
