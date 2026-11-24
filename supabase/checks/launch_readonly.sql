-- LAUNCH CHECK · READ-ONLY. Changes nothing.
-- Supabase → SQL Editor → New query → paste ALL of this → Run.
-- It returns ONE grid. Export it (Results → Export → CSV) or screenshot it,
-- and send it to Claude.
--
-- What it answers:
--   policy     who may read and write review_pins, users and device_tokens
--   rls        row level security switched on for those three tables
--   col grant  what app users (anon, authenticated) may do to users.favorite_games
--   tbl grant  what app users (anon, authenticated) may do to review_pins
--   tokens     push tokens still attached to deleted accounts (should be 0)

select 'policy' as section,
       tablename || ' · ' || policyname as item,
       cmd || ' to ' || array_to_string(roles, ',') as detail,
       coalesce(qual, '-') || '  |  check: ' || coalesce(with_check, '-') as rule
  from pg_policies
 where schemaname = 'public'
   and tablename in ('review_pins', 'users', 'device_tokens')
union all
select 'rls',
       c.relname,
       case when c.relrowsecurity then 'on' else 'OFF' end,
       case when c.relforcerowsecurity then 'forced' else '' end
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('review_pins', 'users', 'device_tokens')
union all
select 'col grant',
       'users.favorite_games',
       grantee,
       privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'users'
   and column_name = 'favorite_games'
   and grantee in ('anon', 'authenticated')
union all
select 'tbl grant',
       'review_pins',
       grantee,
       privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'review_pins'
   and grantee in ('anon', 'authenticated')
union all
select 'tokens',
       'on deleted accounts',
       count(*)::text,
       ''
  from public.device_tokens dt
  join public.users u on u.id = dt.user_id
 where u.deleted_at is not null
 order by 1, 2, 3;
