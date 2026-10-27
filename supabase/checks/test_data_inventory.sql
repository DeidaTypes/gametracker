-- READ-ONLY. Lists content that looks like test data before launch.
-- Nothing here changes the database. Paste into the Supabase SQL Editor,
-- run it, and send Claude the result (or a screenshot of it).
--
-- `mine` = written by Ry's own account (6c88ae0e-...). Real activity of
-- Ry's stays; only rows that are obviously test text get deleted later.

with me as (select '6c88ae0e-29c7-44bf-9d42-72a67962bd17'::uuid as id),
pattern as (select '(\mqa\M|\mtest|audit|lorem|asdf|qwerty|should show|placeholder|dummy)'::text as re)
select 'review' as kind, r.id::text as id, r.created_at::date as created,
       coalesce(nullif(u.username, ''), '[deleted user]') as author,
       (r.user_id = (select id from me)) as mine,
       r.game_title as about, left(r.body, 100) as text
  from public.reviews r
  left join public.users u on u.id = r.user_id
 where r.body ~* (select re from pattern)
union all
select 'review_comment', c.id::text, c.created_at::date,
       coalesce(nullif(u.username, ''), '[deleted user]'),
       (c.user_id = (select id from me)), null, left(c.body, 100)
  from public.review_comments c
  left join public.users u on u.id = c.user_id
 where c.body ~* (select re from pattern)
union all
select 'list', l.id::text, l.created_at::date,
       coalesce(nullif(u.username, ''), '[deleted user]'),
       (l.user_id = (select id from me)), l.name, left(coalesce(l.description, ''), 100)
  from public.lists l
  left join public.users u on u.id = l.user_id
 where l.name ~* (select re from pattern)
    or coalesce(l.description, '') ~* (select re from pattern)
union all
select 'qa_question', q.id::text, q.created_at::date,
       coalesce(nullif(u.username, ''), '[deleted user]'),
       (q.user_id = (select id from me)), q.game_title, left(q.title || ' / ' || q.body, 100)
  from public.qa_questions q
  left join public.users u on u.id = q.user_id
 where q.title ~* (select re from pattern)
    or q.body ~* (select re from pattern)
union all
select 'qa_answer', a.id::text, a.created_at::date,
       coalesce(nullif(u.username, ''), '[deleted user]'),
       (a.user_id = (select id from me)), null, left(a.body, 100)
  from public.qa_answers a
  left join public.users u on u.id = a.user_id
 where a.body ~* (select re from pattern)
union all
select 'account', u.id::text, u.created_at::date,
       coalesce(nullif(u.username, ''), '[deleted user]'),
       (u.id = (select id from me)),
       case when u.deleted_at is not null then 'deleted account' else 'active account' end,
       null
  from public.users u
 where coalesce(u.username, '') ~* '(\mtest|\mqa|demo|tmp|dummy)'
    or u.deleted_at is not null
 order by kind, created desc;
